/** Functions the desktop app's preload exposes (apps/desktop/src/preload.ts). Absent in a browser. */
export interface DesktopBridge {
  desktop: true;
  platform: string;
  pickFolders(): Promise<string[]>;
  getPrefs(): Promise<DesktopPrefs | null>;
  setPrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs | null>;
}

export interface DesktopPrefs {
  /** Closing the window keeps Overlook running in the tray. */
  closeToTray: boolean;
}

/** The desktop bridge, or null when running in a normal browser tab. */
export const desktop: DesktopBridge | null =
  (globalThis as { overlook?: DesktopBridge }).overlook?.desktop ? (globalThis as { overlook?: DesktopBridge }).overlook! : null;
