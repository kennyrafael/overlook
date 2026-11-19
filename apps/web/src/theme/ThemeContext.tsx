import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { initialMode, STORAGE_KEY, themeHref, type Mode } from './themeMode';

interface ThemeState {
  mode: Mode;
  toggle: () => void;
  /** Increments each time a theme stylesheet finishes loading; charts re-read CSS tokens on change. */
  version: number;
}

const ThemeCtx = createContext<ThemeState>({ mode: 'dark', toggle: () => {}, version: 0 });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const link = document.getElementById('theme-link') as HTMLLinkElement;
    const href = themeHref(mode);
    const onLoad = () => setVersion((v) => v + 1);
    link.addEventListener('load', onLoad);
    // The boot loader (src/boot/loader.ts) already points the link at this theme before React starts.
    // Setting the same href again would not fire 'load', so an already-loaded sheet counts as loaded now.
    if (link.href === new URL(href, location.href).href) {
      if (link.sheet) onLoad();
    } else {
      link.href = href;
    }
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
    return () => link.removeEventListener('load', onLoad);
  }, [mode]);

  // First stylesheet loaded and the app mounted: the boot loader can go.
  useEffect(() => {
    if (version > 0) window.dispatchEvent(new Event('overlook:ready'));
  }, [version]);

  return (
    <ThemeCtx.Provider value={{ mode, version, toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')) }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
