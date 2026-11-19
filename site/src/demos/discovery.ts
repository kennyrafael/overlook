// Discovery demo: a scattered folder of stuff assembles into the project grid as the section scrolls
// through the screen. Folders that are not projects fade away. Reduced motion shows the grid directly.
import { DAYS, PROJECTS, rng, type DemoProject } from '../demo/data.ts';
import { easeInOutCubic } from '../hero/frame.ts';
import { range } from '../motion/math.ts';
import { scrollProgress } from '../motion/motion.ts';
import { appWindow, h, reducedMotion } from './dom.ts';
import { boardModel, boardProgress } from './board-model.ts';

type Status = 'active' | 'paused' | 'done';

export function projectStatus(p: DemoProject): Status {
  const prog = boardProgress(boardModel(p));
  if (prog.reached === prog.milestones.length) return 'done';
  return p.quietSince >= 14 ? 'paused' : 'active';
}

export function lastActivity(daysAgo: number): string {
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo < 14) return `${daysAgo} days ago`;
  return `${Math.round(daysAgo / 7)} weeks ago`;
}

const NOISE = ['Downloads', 'old-photos', 'notes.txt', 'tax-2025.pdf', 'scratch'];

export function mount(root: HTMLElement): void {
  const rand = rng(7);
  const counter = h('strong', null, '0');
  const grid = h('ul', { class: 'disc-grid' });
  const noise = h('div', { class: 'disc-noise', 'aria-hidden': 'true' });
  const cards = PROJECTS.map((p, i) => {
    const prog = boardProgress(boardModel(p));
    const status = projectStatus(p);
    const pct = Math.round((prog.done / prog.total) * 100);
    const markers = ['.git', p.planFile, ...(p.claudeWeight ? ['Claude Code'] : [])];
    const el = h('li', { class: 'disc-card', style: { '--dx': `${(rand() - 0.5) * 340}px`, '--dy': `${(rand() - 0.5) * 220}px`, '--rot': `${(rand() - 0.5) * 24}deg` } },
      h('div', { class: 'disc-top' },
        h('span', { class: 'disc-name' }, p.name),
        h('span', { class: `status status-${status}` }, status)),
      h('span', { class: 'disc-path' }, `~/code/${p.name}`),
      h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${p.name} progress`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
        h('i', { style: { width: `calc(${pct}% * var(--t, 1))` } })),
      h('div', { class: 'disc-meta' },
        h('span', null, `${pct}% · ${prog.reached}/${prog.milestones.length} milestones`),
        h('span', null, lastActivity(p.quietSince))),
      h('div', { class: 'disc-markers' }, ...markers.map((m) => h('span', { class: 'marker' }, m))));
    grid.append(el);
    return { el, i };
  });
  NOISE.forEach((n, i) => noise.append(h('span', { class: 'disc-file', style: { left: `${8 + ((i * 19) % 80)}%`, top: `${12 + ((i * 37) % 70)}%`, '--rot': `${(rand() - 0.5) * 30}deg` } }, n)));

  root.append(appWindow('Overlook · Projects',
    h('div', { class: 'disc-head' }, h('span', { class: 'scan-dot', 'aria-hidden': 'true' }), 'Scanning ', h('code', null, '~/code'), h('span', { class: 'disc-count' }, counter, ' projects found')),
    h('div', { class: 'disc-stage' }, noise, grid),
    h('p', { class: 'disc-foot' }, `Status: active, paused after 14 quiet days, done when every milestone is reached. History: last ${DAYS} days.`)));

  const apply = (t: number) => {
    let found = 0;
    for (const { el, i } of cards) {
      const ti = easeInOutCubic(range(t, i * 0.09, i * 0.09 + 0.55));
      el.style.setProperty('--t', ti.toFixed(3));
      if (ti > 0.98) found++;
    }
    noise.style.setProperty('--t', range(t, 0, 0.6).toFixed(3));
    counter.textContent = String(found);
  };

  if (reducedMotion()) { apply(1); return; }
  apply(0);
  scrollProgress(root, (p) => apply(range(p, 0.12, 0.5)), { cssVar: null });
}
