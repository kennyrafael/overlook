// Loads each live demo when its section comes near the screen (so the first visit only downloads the
// hero), and the command palette on first use. The fallback screenshot stays until the demo mounts.
import { whenNear } from '../motion/motion.ts';

type Mount = (root: HTMLElement) => void;
const DEMOS: Record<string, () => Promise<{ mount: Mount }>> = {
  discovery: () => import('./discovery.ts'),
  board: () => import('./board.ts'),
  usage: () => import('./usage.ts'),
  git: () => import('./git.ts'),
  privacy: () => import('./privacy.ts'),
};

export function initDemos(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-demo]')) {
    const load = DEMOS[el.dataset.demo ?? ''];
    if (!load) continue;
    let started = false;
    // Watch the section, not the demo: sections use content-visibility: auto, and WebKit does not report
    // intersections for elements inside content it is still skipping.
    const target = el.closest('section') ?? el;
    const stop = whenNear(target, (near) => {
      // Load when near, or once scrolled past (so it is ready if the visitor scrolls back up).
      if (started || (!near && target.getBoundingClientRect().top > 0)) return;
      started = true;
      stop();
      load()
        .then(({ mount }) => {
          el.querySelector('.demo-fallback')?.remove();
          el.querySelector('.net-static')?.remove();
          mount(el);
          el.classList.add('is-live');
        })
        .catch((e) => { console.error(`Overlook demo "${el.dataset.demo}" failed to load`, e); }); // the screenshot stays
    }, '60%');
  }

  // Command palette: Ctrl+K / ⌘K anywhere, or the buttons marked data-open-palette.
  const mac = /mac/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '');
  for (const k of document.querySelectorAll('[data-mod]')) k.textContent = mac ? '⌘' : 'Ctrl';
  const open = () => import('./palette.ts').then((m) => m.openPalette()).catch(() => {});
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      void open();
    }
  });
  for (const b of document.querySelectorAll('[data-open-palette]')) b.addEventListener('click', () => void open());
}
