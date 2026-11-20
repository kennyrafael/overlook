/**
 * Preload for the Overlook window. Runs sandboxed with context isolation.
 * Exposes one function per desktop action; the main process checks that every call comes from
 * the app's own page and validates every argument. Keep this list short.
 */
import { contextBridge, ipcRenderer } from 'electron';

interface Prefs { closeToTray: boolean; autoUpdate: boolean; notifyWaiting: boolean; mutedProjects: string[] }

contextBridge.exposeInMainWorld('overlook', Object.freeze({
  desktop: true,
  platform: process.platform,
  /** Native folder picker; resolves to the chosen absolute paths (empty when cancelled). */
  pickFolders: (): Promise<string[]> => ipcRenderer.invoke('overlook:pick-folders'),
  getPrefs: (): Promise<Prefs | null> => ipcRenderer.invoke('overlook:get-prefs'),
  setPrefs: (patch: Partial<Prefs>): Promise<Prefs | null> => ipcRenderer.invoke('overlook:set-prefs', patch),
  /** Commands from the macOS app menu (About, Settings). Only known commands are passed on. */
  onCommand: (cb: (cmd: 'about' | 'settings') => void): void => {
    ipcRenderer.on('overlook:command', (_event, cmd: unknown) => {
      if (cmd === 'about' || cmd === 'settings') cb(cmd);
    });
  },
  /** Shows a native notification ("Claude is waiting"); resolves to whether it was shown. */
  notify: (n: { title: string; body: string; projectId: string }): Promise<boolean> => ipcRenderer.invoke('overlook:notify', n),
  /** A notification was clicked: the window is shown and the page should open this project. */
  onOpenProject: (cb: (projectId: string) => void): void => {
    ipcRenderer.on('overlook:open-project', (_event, id: unknown) => {
      if (typeof id === 'string' && /^[\w-]{1,128}$/.test(id)) cb(id);
    });
  },
}));
