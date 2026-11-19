/**
 * Windows and Linux AppImage auto-update (electron-updater, generic provider) from the release feed on Cloudflare R2
 * (URL set at build time in scripts/build.mjs, stored in resources/app-update.yml).
 *
 * The only outbound call Overlook makes: it reads the release feed at start-up and once
 * a day, downloads a newer installer in the background and offers to restart. Turned off with the
 * "Check for updates automatically" setting; "Check for updates" in the tray always works.
 * Builds are unsigned, so there is no publisher check; the feed's SHA-512 is verified.
 *
 * Linux AppImage: the same updater, from latest-linux.yml (latest-linux-arm64.yml on arm64); it replaces
 * the AppImage file in place.
 *
 * macOS and the Linux .deb: unsigned macOS apps cannot update themselves, and a .deb is installed with
 * apt (root), so the release feed (latest.yml, latest-linux.yml) is only compared with the running
 * version, and a newer release shows a "Download" prompt that opens the download page.
 */
import { app, dialog, net, shell, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
/** Running from an AppImage (its runtime sets APPIMAGE to the file's path); a .deb install does not. */
const IS_APPIMAGE = IS_LINUX && !!process.env.APPIMAGE;
/** The platforms that only get a "new version available" prompt. */
const NOTICE_ONLY = IS_MAC || (IS_LINUX && !IS_APPIMAGE);
const DOWNLOAD_PAGE = 'https://overlook.agenthub.pt';
const DEFAULT_FEED = 'https://overlook-downloads.kennyrafael-cg.workers.dev/overlook';
const supported = () => app.isPackaged && (IS_WIN || IS_MAC || IS_LINUX);

/** The feed a notice-only install compares with: the Linux one proves a Linux build exists for this arch. */
const noticeFeed = () => (IS_LINUX ? `latest-linux${process.arch === 'arm64' ? '-arm64' : ''}.yml` : 'latest.yml');
const noticeDetail = (current: string) => IS_LINUX
  ? `You have ${current}. Download the new .deb and install it over this one with: sudo apt install ./Overlook-<version>-<arch>.deb`
  : `You have ${current}. Download the new version and drag it to Applications to replace this one.`;

/** The feed URL baked in at build time (resources/app-update.yml), or the default. */
function feedUrl(): string {
  try {
    const url = /^url:\s*(\S+)\s*$/m.exec(readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8'))?.[1];
    if (url && /^https:\/\//.test(url)) return url.replace(/\/+$/, '');
  } catch { /* use the default */ }
  return DEFAULT_FEED;
}

/** a > b for x.y.z versions (pre-release suffixes ignored). */
function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).slice(0, 3).map(Number);
  const pb = b.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

let notifiedVersion = '';
let getWin: () => BrowserWindow | null = () => null;

async function noticeCheck(manualCheck: boolean) {
  try {
    const res = await net.fetch(`${feedUrl()}/${noticeFeed()}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const latest = /^version:\s*'?([\w.-]+)'?\s*$/m.exec(await res.text())?.[1];
    if (!latest) throw new Error('No version in the release feed');
    if (!newer(latest, app.getVersion())) {
      if (manualCheck) void dialog.showMessageBox({ type: 'info', title: 'Overlook', message: `You have the latest version (${app.getVersion()}).` });
      return;
    }
    if (!manualCheck && notifiedVersion === latest) return;
    notifiedVersion = latest;
    const opts = {
      type: 'info' as const,
      title: 'Update available',
      message: `Overlook ${latest} is available.`,
      detail: noticeDetail(app.getVersion()),
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    };
    const win = getWin();
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (response === 0) void shell.openExternal(DOWNLOAD_PAGE);
  } catch (e) {
    if (manualCheck) void dialog.showMessageBox({ type: 'warning', title: 'Overlook', message: 'Could not check for updates.', detail: String(e) });
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let manual = false;
let prompted = false;

export function initUpdater(getWindow: () => BrowserWindow | null, log: (msg: string) => void) {
  getWin = getWindow;
  if (!app.isPackaged || !(IS_WIN || IS_APPIMAGE)) return;
  // The updater config is written here instead of relying on resources/app-update.yml: installers
  // built with `publish: 'never'` shipped without that file (0.1.0), and electron-updater then fails
  // every check with ENOENT. It also reads the cache folder name from this file.
  // Windows x64 and arm64 installers are published as separate feeds (latest.yml, latest-arm64.yml).
  // On Linux electron-updater adds "-linux" and the arch itself (latest-linux.yml, latest-linux-arm64.yml).
  const channel = IS_WIN && process.arch === 'arm64' ? 'latest-arm64' : 'latest';
  const feedFile = IS_LINUX ? `latest-linux${process.arch === 'arm64' ? '-arm64' : ''}.yml` : `${channel}.yml`;
  try {
    const configPath = join(app.getPath('userData'), 'app-update.yml');
    writeFileSync(configPath, `provider: generic\nurl: ${feedUrl()}\nchannel: ${channel}\nupdaterCacheDirName: overlook-updater\n`);
    autoUpdater.updateConfigPath = configPath;
  } catch (e) {
    log(`Could not write the updater config: ${String(e)}`);
  }
  autoUpdater.channel = channel;
  log(`Version ${app.getVersion()} (${process.platform} ${process.arch}), feed ${feedUrl()}/${feedFile}`);
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => undefined };

  autoUpdater.on('update-not-available', () => {
    if (!manual) return;
    manual = false;
    void dialog.showMessageBox({ type: 'info', title: 'Overlook', message: `You have the latest version (${app.getVersion()}).` });
  });
  autoUpdater.on('error', (err) => {
    log(`Update check failed: ${err.message}`);
    if (!manual) return;
    manual = false;
    void dialog.showMessageBox({ type: 'warning', title: 'Overlook', message: 'Could not check for updates.', detail: err.message });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    manual = false;
    if (prompted) return;
    prompted = true;
    const win = getWindow();
    const opts = {
      type: 'info' as const,
      title: 'Update ready',
      message: `Overlook ${info.version} is ready to install.`,
      detail: 'Restart now to update, or it installs the next time you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    };
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (response === 0) autoUpdater.quitAndInstall();
  });
}

/** Starts or stops the background check (at start-up, then daily). */
export function setAutoCheck(enabled: boolean) {
  if (!supported()) return;
  if (timer) { clearInterval(timer); timer = null; }
  if (!enabled) return;
  // Errors are reported through autoUpdater's 'error' event (logged there); the catch only stops an unhandled rejection.
  const check = () => (NOTICE_ONLY ? void noticeCheck(false) : void autoUpdater.checkForUpdates().catch(() => undefined));
  setTimeout(check, 10_000);
  timer = setInterval(check, DAY_MS);
  timer.unref();
}

/** Tray → "Check for updates": reports the result even when nothing is new. */
export function checkNow() {
  if (!supported()) {
    void dialog.showMessageBox({ type: 'info', title: 'Overlook', message: 'Updates are only available in the installed app.' });
    return;
  }
  if (NOTICE_ONLY) { void noticeCheck(true); return; }
  manual = true;
  void autoUpdater.checkForUpdates().catch(() => undefined);
}
