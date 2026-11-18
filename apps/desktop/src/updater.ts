/**
 * Windows auto-update from GitHub Releases (electron-updater).
 *
 * The only outbound call Overlook makes: it reads the release feed on github.com at start-up and once
 * a day, downloads a newer installer in the background and offers to restart. Turned off with the
 * "Check for updates automatically" setting; "Check for updates" in the tray always works.
 * Builds are unsigned, so there is no publisher check; the feed's SHA-512 is verified.
 */
import { app, dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

const DAY_MS = 24 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let manual = false;
let prompted = false;

export function initUpdater(getWindow: () => BrowserWindow | null, log: (msg: string) => void) {
  if (!app.isPackaged || process.platform !== 'win32') return;
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
  if (!app.isPackaged || process.platform !== 'win32') return;
  if (timer) { clearInterval(timer); timer = null; }
  if (!enabled) return;
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 10_000);
  timer = setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), DAY_MS);
  timer.unref();
}

/** Tray → "Check for updates": reports the result even when nothing is new. */
export function checkNow() {
  if (!app.isPackaged || process.platform !== 'win32') {
    void dialog.showMessageBox({ type: 'info', title: 'Overlook', message: 'Updates are only available in the installed Windows app.' });
    return;
  }
  manual = true;
  void autoUpdater.checkForUpdates().catch(() => undefined);
}
