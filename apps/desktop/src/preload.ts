/**
 * Preload for the Overlook window. Runs sandboxed with context isolation.
 * Exposes one function per desktop action; the main process checks that every call comes from
 * the app's own page and validates every argument. Keep this list short.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('overlook', Object.freeze({
  desktop: true,
  platform: process.platform,
  /** Native folder picker; resolves to the chosen absolute paths (empty when cancelled). */
  pickFolders: (): Promise<string[]> => ipcRenderer.invoke('overlook:pick-folders'),
  getPrefs: (): Promise<{ closeToTray: boolean; autoUpdate: boolean } | null> => ipcRenderer.invoke('overlook:get-prefs'),
  setPrefs: (patch: { closeToTray?: boolean; autoUpdate?: boolean }): Promise<{ closeToTray: boolean; autoUpdate: boolean } | null> =>
    ipcRenderer.invoke('overlook:set-prefs', patch),
}));
