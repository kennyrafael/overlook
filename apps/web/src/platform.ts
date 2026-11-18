/** True on macOS (desktop app or browser), where shortcuts use ⌘ instead of Ctrl. */
export const isMac: boolean = (() => {
  const g = globalThis as { overlook?: { platform?: string }; navigator?: Navigator & { userAgentData?: { platform?: string } } };
  if (g.overlook?.platform) return g.overlook.platform === 'darwin';
  const nav = g.navigator;
  return /mac/i.test(nav?.userAgentData?.platform ?? nav?.platform ?? '');
})();

/** The modifier key's label: "⌘" on macOS, "Ctrl" elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl';
