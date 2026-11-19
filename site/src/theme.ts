// Light/dark toggle. With no saved choice the page follows the system theme; a click saves the
// opposite of what is showing. public/theme-init.js applies a saved choice before first paint.
const KEY = 'overlook-theme';
type Theme = 'light' | 'dark';

const systemDark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return systemDark?.matches ? 'dark' : 'light';
}

/** <picture> sources pick dark screenshots by media query; point them at the chosen theme instead. */
function syncPictures(theme: Theme | null): void {
  for (const s of document.querySelectorAll<HTMLSourceElement>('picture source[media*="prefers-color-scheme"], picture source[data-scheme-media]')) {
    if (s.dataset.schemeMedia === undefined) s.dataset.schemeMedia = s.media;
    const original = s.dataset.schemeMedia;
    const wantsDark = original.includes('dark');
    s.media = theme === null ? original : (theme === 'dark') === wantsDark ? 'all' : 'not all';
  }
}

function syncButtons(): void {
  const theme = currentTheme();
  for (const b of document.querySelectorAll<HTMLButtonElement>('.theme-toggle')) {
    b.dataset.showing = theme;
    b.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    b.title = b.getAttribute('aria-label') ?? '';
  }
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* not saved; still applies to this visit */ }
  syncPictures(theme);
  syncButtons();
}

export function toggleTheme(): void {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme(): void {
  const saved = document.documentElement.dataset.theme;
  if (saved === 'light' || saved === 'dark') syncPictures(saved);
  syncButtons();
  for (const b of document.querySelectorAll<HTMLButtonElement>('.theme-toggle')) b.addEventListener('click', toggleTheme);
  // Without a saved choice, follow the system if it changes while the page is open.
  systemDark?.addEventListener('change', () => { if (!document.documentElement.dataset.theme) syncButtons(); });
}
