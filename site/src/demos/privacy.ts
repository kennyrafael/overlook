// Privacy demo: as the section scrolls in, the lens ring closes around a laptop ("your machine"), and
// a copy of Settings → Network activity lists the only call the app can make, with its switch.
import { range } from '../motion/math.ts';
import { scrollProgress } from '../motion/motion.ts';
import { drawContours } from '../textures/contours.ts';
import { announce, h, reducedMotion, s } from './dom.ts';

export function mount(root: HTMLElement): void {
  const section = root.closest('section');
  const contours = section?.querySelector<SVGSVGElement>('.contours');
  if (contours) drawContours(contours);

  let on = true;
  const ring = s('circle', { cx: 160, cy: 118, r: 112, class: 'seal-ring' });
  const scene = s('svg', { viewBox: '0 -4 320 244', class: 'seal', role: 'img', 'aria-label': 'Your computer, with everything Overlook reads kept inside it' },
    // Laptop
    s('rect', { x: 92, y: 62, width: 136, height: 88, rx: 8, class: 'lp-screen' }),
    s('rect', { x: 100, y: 70, width: 120, height: 72, rx: 3, class: 'lp-glass' }),
    ...[0, 1, 2].map((i) => s('rect', { x: 108, y: 80 + i * 18, width: 104 * [0.82, 0.55, 1][i], height: 8, rx: 4, class: `lp-bar lp-bar-${i}` })),
    s('path', { d: 'M78 150 H242 L254 164 H66 Z', class: 'lp-base' }),
    // Files that stay inside
    ...[['PLAN.md', 116, 42], ['.git', 206, 42], ['.claude', 116, 184], ['src/', 206, 184]].map(([t, x, y]) =>
      s('g', { class: 'lp-file' }, s('rect', { x: Number(x) - 24, y: Number(y) - 12, width: 48, height: 20, rx: 6 }), s('text', { x, y: Number(y) + 2, 'text-anchor': 'middle' }, String(t)))),
    ring);

  const sw = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'true', 'aria-label': 'Check for updates' }, h('i'));
  const state = h('span', { class: 'net-state' });
  const row = h('li', { class: 'net-row' },
    h('div', null, h('strong', null, 'Update check'), h('span', { class: 'net-host' }, 'overlook-downloads.kennyrafael-cg.workers.dev'), h('span', { class: 'net-when' }, 'At start-up and once a day. Sends nothing about you or your projects.')),
    sw);
  const render = () => {
    sw.setAttribute('aria-checked', String(on));
    row.classList.toggle('is-off', !on);
    state.textContent = on ? '1 network call possible' : 'Offline: no network calls at all';
  };
  sw.addEventListener('click', () => {
    on = !on;
    render();
    announce(on ? 'Update check on.' : 'Update check off. Overlook now makes no network calls.');
  });

  root.append(
    h('div', { class: 'privacy-demo' },
      scene,
      h('div', { class: 'net-panel' },
        h('div', { class: 'net-head' }, h('span', null, 'Settings → Network activity'), state),
        h('ul', { class: 'net-list' }, row),
        h('p', { class: 'net-never' }, 'Never sent: your code, plan files, prompts, token usage, file paths.'))));
  render();

  if (reducedMotion()) { ring.style.setProperty('--seal', '1'); return; }
  scrollProgress(root, (p) => ring.style.setProperty('--seal', range(p, 0.15, 0.5).toFixed(3)), { cssVar: null });
}
