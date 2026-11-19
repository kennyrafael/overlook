/** True on macOS (desktop app or browser), where shortcuts use ⌘ instead of Ctrl. */
export const isMac: boolean = (() => {
  const g = globalThis as { overlook?: { platform?: string }; navigator?: Navigator & { userAgentData?: { platform?: string } } };
  if (g.overlook?.platform) return g.overlook.platform === 'darwin';
  const nav = g.navigator;
  return /mac/i.test(nav?.userAgentData?.platform ?? nav?.platform ?? '');
})();

/** True on Linux (desktop app or browser), where folders open in the desktop's file manager. */
export const isLinux: boolean = (() => {
  const g = globalThis as { overlook?: { platform?: string }; navigator?: Navigator & { userAgentData?: { platform?: string } } };
  if (g.overlook?.platform) return g.overlook.platform === 'linux';
  const nav = g.navigator;
  const p = nav?.userAgentData?.platform ?? nav?.platform ?? '';
  return /linux/i.test(p) && !/android/i.test(nav?.userAgent ?? '');
})();

/** The modifier key's label: "⌘" on macOS, "Ctrl" elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl';
