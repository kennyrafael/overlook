/**
 * Windows auto-update (electron-updater, generic provider) from the release feed on Cloudflare R2
 * (URL set at build time in scripts/build.mjs, stored in resources/app-update.yml).
 *
 * The only outbound call Overlook makes: it reads the release feed at start-up and once
 * a day, downloads a newer installer in the background and offers to restart. Turned off with the
 * "Check for updates automatically" setting; "Check for updates" in the tray always works.
 * Builds are unsigned, so there is no publisher check; the feed's SHA-512 is verified.
 *
 * macOS: unsigned apps cannot update themselves, so the same feed (latest.yml carries the release
 * version for every platform) is only compared with the running version, and a newer release shows a
 * "Download" prompt that opens the download page.
 */
import { app, dialog, net, shell, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { readFileSync } from 'fs';
import { join } from 'path';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const DOWNLOAD_PAGE = 'https://overlook.agenthub.pt';
const DEFAULT_FEED = 'https://overlook-downloads.kennyrafael-cg.workers.dev/overlook';
const supported = () => app.isPackaged && (IS_WIN || IS_MAC);

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

async function macCheck(manualCheck: boolean) {
  try {
    const res = await net.fetch(`${feedUrl()}/latest.yml`, { cache: 'no-cache' });
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
      detail: `You have ${app.getVersion()}. Download the new version and drag it to Applications to replace this one.`,
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
  if (!app.isPackaged || !IS_WIN) return;
  // x64 and arm64 installers are published as separate feeds (latest.yml, latest-arm64.yml).
  autoUpdater.channel = process.arch === 'arm64' ? 'latest-arm64' : 'latest';
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
  const check = () => (IS_MAC ? void macCheck(false) : void autoUpdater.checkForUpdates().catch(() => undefined));
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
  if (IS_MAC) { void macCheck(true); return; }
  manual = true;
  void autoUpdater.checkForUpdates().catch(() => undefined);
}
