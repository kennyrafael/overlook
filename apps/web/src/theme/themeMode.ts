import lightTheme from 'primereact/resources/themes/lara-light-indigo/theme.css?url';
import darkTheme from 'primereact/resources/themes/lara-dark-indigo/theme.css?url';

export type Mode = 'light' | 'dark';
export const STORAGE_KEY = 'cpd-theme';

/** Saved choice, else the OS preference. */
export function initialMode(): Mode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export const themeHref = (mode: Mode) => (mode === 'dark' ? darkTheme : lightTheme);
