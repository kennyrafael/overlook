// Install guide tabs (ARIA tabs pattern). Without JavaScript the guides show one after the other;
// with it, the visitor's system is selected first, ← → / Home / End move between tabs, and a link to
// #install, #install-mac or #install-linux (the download buttons' fallback) opens the matching tab.
import { isLinux, isMac, type NavLike } from './download.ts';

export function initInstallTabs(root: ParentNode = document, nav: NavLike = navigator as NavLike): void {
  const list = root.querySelector<HTMLElement>('.install [role="tablist"]');
  if (!list) return;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls') ?? ''));
  if (panels.some((p) => !p)) return;

  const select = (i: number, focus = false) => {
    tabs.forEach((t, k) => {
      const on = k === i;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      panels[k]!.hidden = !on;
    });
    if (focus) tabs[i].focus();
  };

  list.hidden = false;
  list.closest('.install')?.classList.add('has-tabs');
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(i));
    t.addEventListener('keydown', (e) => {
      const n = tabs.length;
      const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (next < 0) return;
      e.preventDefault();
      select(next, true);
    });
  });

  // A link to a guide selects its tab and scrolls to it (the panel may have been hidden when the
  // browser first tried to scroll there).
  const fromHash = () => {
    const i = panels.findIndex((p) => `#${p!.id}` === location.hash);
    if (i >= 0) {
      select(i);
      panels[i]!.scrollIntoView({ block: 'start' });
    }
    return i >= 0;
  };
  if (!fromHash()) {
    const own = isMac(nav) ? 'tab-mac' : isLinux(nav) ? 'tab-linux' : 'tab-win';
    select(Math.max(0, tabs.findIndex((t) => t.id === own)));
  }
  window.addEventListener('hashchange', fromHash);
  // Clicking a link to the current hash does not fire hashchange; catch those too.
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#install"]');
    if (a) setTimeout(fromHash, 0);
  });
}
