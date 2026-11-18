/**
 * Overlook desktop shell.
 *
 * Starts the local Nest server in an Electron utilityProcess on a free port, protects it with a
 * per-launch token (sent as an httpOnly cookie only this window has), and shows the UI in a
 * locked-down BrowserWindow. Nothing here talks to the internet.
 */
import { app, BrowserWindow, dialog, Menu, session, shell, utilityProcess, type UtilityProcess } from 'electron';
import { randomBytes } from 'crypto';
import { createServer } from 'net';
import { join } from 'path';

const TOKEN_COOKIE = 'cpd_token';
const READY_TIMEOUT_MS = 30_000;

// Layout inside the packaged app (and the staging folder): desktop/, api/dist/, web/dist/.
// In development (`npm start` in apps/desktop) the same paths resolve inside the monorepo.
const appRoot = app.isPackaged ? app.getAppPath() : join(__dirname, '..', '..');
const desktopDir = app.isPackaged ? join(appRoot, 'desktop') : __dirname;
const serverEntry = join(appRoot, 'api', 'dist', 'main.js');
const webDist = join(appRoot, 'web', 'dist');

let server: UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;

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

/** Starts the server and resolves once it reports that it is listening. */
function startServer(port: number, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      CPD_PORT: String(port),
      CPD_TOKEN: token,
      CPD_WEB_DIST: webDist,
      // Tests may point the app at a fixture; otherwise keep data in the per-user app folder.
      CPD_DATA_DIR: process.env.CPD_DATA_DIR || app.getPath('userData'),
    };
    const child = utilityProcess.fork(serverEntry, [], { env, stdio: 'pipe', serviceName: 'Overlook server' });
    server = child;
    child.stdout?.on('data', (d) => process.stdout.write(d));
    child.stderr?.on('data', (d) => process.stderr.write(d));
    const timer = setTimeout(() => reject(new Error('The local server did not start in time.')), READY_TIMEOUT_MS);
    child.on('message', (m: { type?: string }) => {
      if (m?.type === 'ready') { clearTimeout(timer); resolve(); }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      server = null;
      reject(new Error(`The local server stopped (exit code ${code}).`));
    });
  });
}

/** Security settings for every window and web contents the app creates. */
function harden(origin: string) {
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

async function createWindow(origin: string) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 380,
    minHeight: 500,
    title: 'Overlook',
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
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(origin + '/');
}

async function boot() {
  Menu.setApplicationMenu(null);
  const port = await freePort();
  const token = randomBytes(32).toString('hex');
  const origin = `http://127.0.0.1:${port}`;

  harden(origin);
  // The token travels as an httpOnly cookie, so the UI (fetch, EventSource) sends it without any code change
  // and page scripts cannot read it.
  await session.defaultSession.cookies.set({
    url: origin, name: TOKEN_COOKIE, value: token, httpOnly: true, sameSite: 'strict',
  });

  await startServer(port, token);
  await createWindow(origin);
}

app.setAppUserModelId('eu.agenthub.overlook');
app.enableSandbox();

app.whenReady().then(boot).catch((err: Error) => {
  dialog.showErrorBox('Overlook could not start', err.message);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  // Graceful stop: the server's shutdown hooks close watchers and the database.
  server?.kill();
  server = null;
});
