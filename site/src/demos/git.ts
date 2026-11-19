// Git demo: a 90-day commit heatmap that ripples in, with a project filter, a tooltip for each day
// (mouse, tap, or arrow keys once the grid has focus), and each repo's uncommitted and unpushed work.
import { PROJECTS } from '../demo/data.ts';
import { appWindow, dayLabel, h, MONTHS } from './dom.ts';
import { heatmap, repos, type HeatCell } from './git-model.ts';
import { lastActivity } from './discovery.ts';

export function mount(root: HTMLElement): void {
  let selected = new Set(PROJECTS.map((p) => p.name));
  let cells: HeatCell[] = [];
  let active = -1;

  const grid = h('div', { class: 'heat', role: 'group', 'aria-label': 'Commits per day, last 90 days. Use the arrow keys to read each day.', tabindex: 0 });
  const months = h('div', { class: 'heat-months', 'aria-hidden': 'true' });
  const tip = h('p', { class: 'heat-tip', 'aria-live': 'polite' }, 'Hover a day, or focus the grid and use the arrow keys.');
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Projects' });
  const kpis = h('div', { class: 'kpis kpis-3' });
  const list = h('ul', { class: 'repo-list' });

  root.append(appWindow('Overlook · Git',
    kpis,
    h('div', { class: 'heat-wrap' },
      h('div', { class: 'heat-days', 'aria-hidden': 'true' }, h('span', null, 'Mon'), h('span'), h('span', null, 'Wed'), h('span'), h('span', null, 'Fri'), h('span'), h('span')),
      h('div', { class: 'heat-main' }, months, grid)),
    h('div', { class: 'heat-legend', 'aria-hidden': 'true' }, 'Less', ...[0, 1, 2, 3, 4].map((l) => h('i', { class: `lv-${l}` })), 'More'),
    tip,
    chips,
    list));

  const renderKpis = () => {
    const r = repos();
    const dirty = r.filter((x) => x.uncommitted);
    kpis.replaceChildren(
      kpi('Uncommitted', String(dirty.reduce((a, x) => a + x.uncommitted, 0)), `in ${dirty.length} repos`),
      kpi('Unpushed commits', String(r.reduce((a, x) => a + x.unpushed, 0)), 'to push'),
      kpi('Commits (30 days)', String(r.reduce((a, x) => a + x.commits30, 0)), 'on checked-out branches'));
  };

  const renderChips = () => {
    chips.replaceChildren(
      h('button', { type: 'button', 'aria-pressed': String(selected.size === PROJECTS.length), onclick: () => { selected = new Set(PROJECTS.map((p) => p.name)); renderHeat(); renderChips(); } }, 'All'),
      ...PROJECTS.map((p) => h('button', {
        type: 'button', 'aria-pressed': String(selected.size === 1 && selected.has(p.name)),
        onclick: () => { selected = new Set([p.name]); renderHeat(); renderChips(); },
      }, p.name)));
  };

  const renderHeat = () => {
    cells = heatmap([...selected]);
    const cols = Math.max(...cells.map((c) => c.col)) + 1;
    grid.style.setProperty('--cols', String(cols));
    months.style.setProperty('--cols', String(cols));
    const fresh = grid.childElementCount === 0;
    grid.replaceChildren(...cells.map((c, i) => h('span', {
      class: `cell lv-${c.level}${i === active ? ' is-active' : ''}`, 'data-i': i, title: `${dayLabel(c.date)}: ${c.count} commits`,
      style: { 'grid-column': String(c.col + 1), 'grid-row': String(c.row + 1), '--d': `${(c.col + c.row) * 16}ms` },
    })));
    // Month labels over the first column of each month.
    const seen = new Set<number>();
    months.replaceChildren(...cells.filter((c) => !seen.has(c.date.getMonth()) && c.date.getDate() <= 7 && seen.add(c.date.getMonth()))
      .map((c) => h('span', { style: { 'grid-column': String(c.col + 1) } }, MONTHS[c.date.getMonth()])));
    if (fresh) requestAnimationFrame(() => grid.classList.add('is-in'));
    else grid.classList.add('is-in');
    const total = cells.reduce((a, c) => a + c.count, 0);
    tip.textContent = `${total} commits in 90 days${selected.size === 1 ? ` in ${[...selected][0]}` : ' across 5 repos'}.`;
  };

  const show = (i: number) => {
    active = i;
    for (const el of grid.children) el.classList.toggle('is-active', Number((el as HTMLElement).dataset.i) === i);
    const c = cells[i];
    if (!c) return;
    const who = c.byProject.map((p) => `${p.project} ${p.count}`).join(', ');
    tip.textContent = `${dayLabel(c.date)}: ${c.count} commit${c.count === 1 ? '' : 's'}${who ? ` (${who})` : ''}`;
  };

  grid.addEventListener('pointerover', (e) => {
    const i = Number((e.target as HTMLElement).dataset?.i);
    if (Number.isInteger(i)) show(i);
  });
  grid.addEventListener('click', (e) => {
    const i = Number((e.target as HTMLElement).dataset?.i);
    if (Number.isInteger(i)) show(i);
  });
  grid.addEventListener('keydown', (e) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    const cur = cells[active] ?? cells[cells.length - 1];
    const next = cells.findIndex((c) => c.col === cur.col + m[0] && c.row === cur.row + m[1]);
    show(next >= 0 ? next : cells.indexOf(cur));
  });

  list.replaceChildren(...repos().map((r) => h('li', null,
    h('span', { class: 'repo-name' }, r.project, h('span', { class: 'repo-branch' }, r.branch)),
    r.uncommitted ? h('span', { class: 'badge badge-warn' }, `${r.uncommitted} uncommitted`) : h('span', { class: 'badge badge-ok' }, 'clean'),
    r.unpushed ? h('span', { class: 'badge badge-info' }, `${r.unpushed} to push`) : h('span', { class: 'badge badge-ok' }, 'in sync'),
    h('span', { class: 'repo-last' }, lastActivity(r.lastCommitDaysAgo)))));

  renderKpis(); renderChips(); renderHeat();
}

function kpi(label: string, value: string, sub: string) {
  return h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, label), h('strong', { class: 'kpi-value' }, value), h('span', { class: 'kpi-sub' }, sub));
}
