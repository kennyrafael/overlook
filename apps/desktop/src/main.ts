/**
 * Overlook desktop shell.
 *
 * Starts the local Nest server in an Electron utilityProcess on a free port, protects it with a
 * per-launch token (sent as an httpOnly cookie only this window has), and shows the UI in a
 * locked-down BrowserWindow. The only internet access is the update check (updater.ts).
 */
import {
  app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray, utilityProcess,
  type IpcMainInvokeEvent, type UtilityProcess,
} from 'electron';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { homedir } from 'os';
import { delimiter, join } from 'path';
import { checkNow, initUpdater, setAutoCheck } from './updater';

const TOKEN_COOKIE = 'cpd_token';
const READY_TIMEOUT_MS = 30_000;
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const SHUTDOWN_TIMEOUT_MS = 4_000;

// Layout inside the packaged app (and the staging folder): desktop/, api/dist/, web/dist/.
// In development (`npm start` in apps/desktop) the same paths resolve inside the monorepo.
const appRoot = app.isPackaged ? app.getAppPath() : join(__dirname, '..', '..');
const desktopDir = app.isPackaged ? join(appRoot, 'desktop') : __dirname;
const serverEntry = join(appRoot, 'api', 'dist', 'main.js');
const webDist = join(appRoot, 'web', 'dist');
const iconPath = app.isPackaged ? join(desktopDir, 'icon.png') : join(__dirname, '..', 'resources', 'icon.png');

let server: UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let origin = '';
let quitting = false;

// ---------------------------------------------------------------------------------------------
// Desktop preferences (stored next to the database in the per-user app folder)
// ---------------------------------------------------------------------------------------------

interface DesktopPrefs {
  /** Closing the window keeps Overlook running in the tray (live updates continue). */
  closeToTray: boolean;
  /** Check the release feed for a new version at start-up and once a day. */
  autoUpdate: boolean;
}
const DEFAULT_PREFS: DesktopPrefs = { closeToTray: false, autoUpdate: true };
const prefsFile = () => join(app.getPath('userData'), 'desktop.json');

function readPrefs(): DesktopPrefs {
  try {
    const raw = JSON.parse(readFileSync(prefsFile(), 'utf8'));
    return { closeToTray: raw?.closeToTray === true, autoUpdate: raw?.autoUpdate !== false };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
let prefs = DEFAULT_PREFS;

// ---------------------------------------------------------------------------------------------
// Server process
// ---------------------------------------------------------------------------------------------

/** Asks the OS for a free port on 127.0.0.1. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Apps opened from Finder or the Dock get a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), and apps started
 * from a Linux desktop launcher get the session's PATH without what ~/.bashrc or ~/.zshrc add (often
 * ~/.local/bin, where Claude Code installs), so git, claude and code would not be found. Ask the user's
 * login shell for its PATH (fixed command, 4 s limit) and add the usual install folders as a fallback.
 */
function loginShellPath(): Promise<string> {
  const home = homedir();
  const extras = [
    ...(IS_MAC ? ['/opt/homebrew/bin'] : ['/home/linuxbrew/.linuxbrew/bin', join(home, '.linuxbrew', 'bin'), '/snap/bin']),
    '/usr/local/bin', join(home, '.local', 'bin'), join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'), join(home, '.volta', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ];
  const merge = (...lists: string[][]) => [...new Set(lists.flat().filter(Boolean))].join(delimiter);
  const current = (process.env.PATH ?? '').split(delimiter);
  const shellPath = process.env.SHELL && /^\/[\w/.-]+$/.test(process.env.SHELL) ? process.env.SHELL : IS_MAC ? '/bin/zsh' : '/bin/bash';
  return new Promise((resolve) => {
    execFile(shellPath, ['-ilc', 'printf "__OVERLOOK_PATH__%s__OVERLOOK_PATH__" "$PATH"'], { timeout: 4000 }, (err, out) => {
      const found = /__OVERLOOK_PATH__(.*?)__OVERLOOK_PATH__/s.exec(out ?? '')?.[1];
      resolve(merge(found && !err ? found.split(delimiter) : [], current, extras));
    });
  });
}

/** Starts the server and resolves once it reports that it is listening. */
async function startServer(port: number, token: string): Promise<void> {
  const path = IS_MAC || IS_LINUX ? await loginShellPath() : process.env.PATH ?? '';
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PATH: path,
      CPD_PORT: String(port),
      CPD_TOKEN: token,
      CPD_WEB_DIST: webDist,
      // Tests may point the app at a fixture; otherwise keep data in the per-user app folder.
      CPD_DATA_DIR: process.env.CPD_DATA_DIR || app.getPath('userData'),
    };
    const child = utilityProcess.fork(serverEntry, [], { env, stdio: 'pipe', serviceName: 'Overlook server' });
    server = child;
    child.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
    child.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
    const timer = setTimeout(() => reject(new Error('The local server did not start in time.')), READY_TIMEOUT_MS);
    child.on('message', (m: { type?: string }) => {
      if (m?.type === 'ready') { clearTimeout(timer); resolve(); }
    });
    child.once('exit', (code: number) => {
      clearTimeout(timer);
      server = null;
      if (!quitting) {
        dialog.showErrorBox('Overlook stopped', `The local server stopped unexpectedly (exit code ${code}).`);
        app.exit(1);
      }
      reject(new Error(`The local server stopped (exit code ${code}).`));
    });
  });
}

/** Asks the server to close its watchers and database, then waits (killing it after a timeout). */
function stopServer(): Promise<void> {
  const child = server;
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, SHUTDOWN_TIMEOUT_MS);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.postMessage({ type: 'shutdown' });
  });
}

// ---------------------------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------------------------

function harden() {
  const ses = session.defaultSession;

  // Content Security Policy for our own pages. PrimeReact sets inline styles, so styles allow 'unsafe-inline'.
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (details.url.startsWith(origin)) {
      headers['Content-Security-Policy'] = [
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      ];
    }
    callback({ responseHeaders: headers });
  });

  // No camera, microphone, notifications, geolocation, etc.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_event, contents) => {
    // Stay on the app origin; anything else opens in the user's browser (http/https only).
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith(origin + '/') && url !== origin) {
        event.preventDefault();
        openExternal(url);
      }
    });
    contents.on('will-redirect', (event, url) => {
      if (!url.startsWith(origin + '/')) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

function openExternal(url: string) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(url);
  } catch { /* ignore malformed URLs */ }
}

// ---------------------------------------------------------------------------------------------
// IPC (one handler per action; every call is checked to come from our own page)
// ---------------------------------------------------------------------------------------------

function fromApp(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return !!mainWindow && event.sender === mainWindow.webContents && (url === origin || url.startsWith(origin + '/'));
}

function registerIpc() {
  ipcMain.handle('overlook:pick-folders', async (event) => {
    if (!fromApp(event) || !mainWindow) return [];
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose folders that contain your projects',
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('overlook:get-prefs', (event) => (fromApp(event) ? { ...prefs } : null));

  ipcMain.handle('overlook:set-prefs', (event, patch: unknown) => {
    if (!fromApp(event) || typeof patch !== 'object' || patch === null) return null;
    const p = patch as Record<string, unknown>;
    if (typeof p.closeToTray === 'boolean') prefs = { ...prefs, closeToTray: p.closeToTray };
    if (typeof p.autoUpdate === 'boolean' && p.autoUpdate !== prefs.autoUpdate) {
      prefs = { ...prefs, autoUpdate: p.autoUpdate };
      setAutoCheck(prefs.autoUpdate);
    }
    try { writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2)); } catch { /* keep in memory */ }
    return { ...prefs };
  });
}

// ---------------------------------------------------------------------------------------------
// Window and tray
// ---------------------------------------------------------------------------------------------

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 380,
    minHeight: 500,
    title: 'Overlook',
    icon: existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#111827',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(desktopDir, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (!quitting && prefs.closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(origin + '/');
}

function createTray() {
  if (!existsSync(iconPath)) return;
  // Linux panels (AppIndicator / StatusNotifier) draw tray icons at about 22 px; Windows uses 16.
  const size = IS_LINUX ? 22 : 16;
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: size, height: size }));
  tray.setToolTip('Overlook');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Overlook', click: showWindow },
    { label: 'Check for updates', click: checkNow },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  // Windows and most Linux panels send clicks; AppIndicator panels (Ubuntu) only open the menu, which has "Open Overlook".
  tray.on('click', showWindow);
}

/** Sends a menu command to the page (the preload only accepts the commands it knows). */
function sendCommand(cmd: 'about' | 'settings') {
  showWindow();
  mainWindow?.webContents.send('overlook:command', cmd);
}

/**
 * macOS needs an application menu: it holds About, Settings (⌘,), Quit (⌘Q) and the Edit roles that make
 * ⌘C / ⌘V / ⌘A work in text fields. Windows and Linux keep no menu bar (Ctrl+C / Ctrl+V work without one).
 */
function setMenu() {
  if (!IS_MAC) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Overlook',
      submenu: [
        { label: 'About Overlook', click: () => sendCommand('about') },
        { label: 'Check for Updates…', click: checkNow },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => sendCommand('settings') },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit Overlook', accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ]));
}

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

async function boot() {
  setMenu();
  prefs = readPrefs();
  const port = await freePort();
  const token = randomBytes(32).toString('hex');
  origin = `http://127.0.0.1:${port}`;

  harden();
  registerIpc();
  // The token travels as an httpOnly cookie, so the UI (fetch, EventSource) sends it without any code change
  // and page scripts cannot read it.
  await session.defaultSession.cookies.set({
    url: origin, name: TOKEN_COOKIE, value: token, httpOnly: true, sameSite: 'strict',
  });

  await startServer(port, token);
  await createWindow();
  createTray();
  initUpdater(() => mainWindow, updaterLog);
  setAutoCheck(prefs.autoUpdate);
}

/** Updater messages go to <userData>/logs/updater.log (next to the server's overlook.log), so a failed update can be diagnosed. */
function updaterLog(msg: string) {
  console.log(`[updater] ${msg}`);
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'updater.log');
    if (existsSync(file) && statSync(file).size > 1_000_000) renameSync(file, `${file}.1`);
    appendFileSync(file, `${new Date().toISOString()} ${msg}
`);
  } catch { /* logging must never break the app */ }
}

// One running copy only: a second launch focuses the existing window instead.
// A run with its own data folder (smoke tests) also gets its own Electron profile, and so its own
// single-instance lock: it neither touches nor is blocked by an installed copy that is running.
if (process.env.CPD_DATA_DIR) app.setPath('userData', join(process.env.CPD_DATA_DIR, 'electron'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  // macOS: clicking the Dock icon shows the window again (or reopens it if it was closed while in the tray).
  app.on('activate', () => {
    if (mainWindow) showWindow();
    else if (origin && server) void createWindow();
  });

  app.setAppUserModelId('eu.agenthub.overlook');
  app.enableSandbox();

  app.whenReady().then(boot).catch((err: Error) => {
    if (quitting) return;
    dialog.showErrorBox('Overlook could not start', err.message);
    app.exit(1);
  });

  app.on('window-all-closed', () => {
    if (!prefs.closeToTray) app.quit();
  });

  // Stop the server cleanly (watchers, database) before exiting.
  let stopped = false;
  app.on('before-quit', (event) => {
    quitting = true;
    if (stopped) return;
    event.preventDefault();
    void stopServer().finally(() => {
      stopped = true;
      tray?.destroy();
      app.quit();
    });
  });
}
