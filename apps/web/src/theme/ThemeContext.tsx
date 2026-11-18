import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import lightTheme from 'primereact/resources/themes/lara-light-indigo/theme.css?url';
import darkTheme from 'primereact/resources/themes/lara-dark-indigo/theme.css?url';

type Mode = 'light' | 'dark';
const STORAGE_KEY = 'cpd-theme';

interface ThemeState {
  mode: Mode;
  toggle: () => void;
  /** Increments each time a theme stylesheet finishes loading; charts re-read CSS tokens on change. */
  version: number;
}

const ThemeCtx = createContext<ThemeState>({ mode: 'dark', toggle: () => {}, version: 0 });

function initialMode(): Mode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const link = document.getElementById('theme-link') as HTMLLinkElement;
    const href = mode === 'dark' ? darkTheme : lightTheme;
    const onLoad = () => setVersion((v) => v + 1);
    link.addEventListener('load', onLoad);
    link.href = href;
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
    return () => link.removeEventListener('load', onLoad);
  }, [mode]);

  return (
    <ThemeCtx.Provider value={{ mode, version, toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')) }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
