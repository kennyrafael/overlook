/** Functions the desktop app's preload exposes (apps/desktop/src/preload.ts). Absent in a browser. */
export interface DesktopBridge {
  desktop: true;
  platform: string;
  pickFolders(): Promise<string[]>;
  getPrefs(): Promise<DesktopPrefs | null>;
  setPrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs | null>;
  /** macOS app menu commands. Older builds do not have it. */
  onCommand?(cb: (cmd: 'about' | 'settings') => void): void;
  /** Native notification; clicking it shows the window and calls onOpenProject. Older builds do not have it. */
  notify?(n: { title: string; body: string; projectId: string }): Promise<boolean>;
  onOpenProject?(cb: (projectId: string) => void): void;
  /** Checks for a new version now (tray → Check for updates); the result appears in a native dialog. Older builds do not have it. */
  checkUpdates?(): Promise<boolean>;
}

export interface DesktopPrefs {
  /** Closing the window keeps Overlook running in the tray. */
  closeToTray: boolean;
  /** Check for updates at start-up and once a day (Windows). */
  autoUpdate: boolean;
  /** Notify when a Claude session waits for the user (absent in older builds). */
  notifyWaiting?: boolean;
  /** Project ids that never notify. */
  mutedProjects?: string[];
}

/** The desktop bridge, or null when running in a normal browser tab. */
export const desktop: DesktopBridge | null =
  (globalThis as { overlook?: DesktopBridge }).overlook?.desktop ? (globalThis as { overlook?: DesktopBridge }).overlook! : null;
