// Usage demo: estimated Claude Code cost per day, stacked by model, from the made-up sessions. Filter by
// range, project and model; hover, tap or use the arrow keys on the chart for a day's numbers.
import { MODELS, PROJECTS, type DemoModel } from '../demo/data.ts';
import { appWindow, dayLabel, daysAgoDate, h, s } from './dom.ts';
import { compact, MODEL_LABEL, summarize, usd, type UsageSummary } from './usage-model.ts';

const W = 640, H = 230, PAD_L = 46, PAD_B = 26, PAD_T = 10;

export function mount(root: HTMLElement): void {
  let days = 30;
  let project = '';
  const models = new Set<DemoModel>(MODELS);
  let active = -1;
  let data: UsageSummary = summarize({ days });
  let drawn = false;

  const kpis = h('div', { class: 'kpis' });
  const chart = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'usage-chart', role: 'img', tabindex: 0 });
  const tip = h('div', { class: 'chart-tip', 'aria-live': 'polite', hidden: true });
  const legend = h('div', { class: 'legend', role: 'group', 'aria-label': 'Models' });
  const ranges = h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' });
  const projectSel = h('select', { class: 'select', 'aria-label': 'Project' },
    h('option', { value: '' }, 'All projects'), ...PROJECTS.map((p) => h('option', { value: p.name }, p.name)));
  const byProject = h('ol', { class: 'by-project' });

  root.append(appWindow('Overlook · Claude',
    h('div', { class: 'usage-controls' }, ranges, projectSel),
    kpis,
    h('div', { class: 'chart-wrap' }, chart, tip),
    h('div', { class: 'usage-foot' }, legend, h('p', { class: 'note-small' }, 'Estimates at API list prices, not your subscription bill.')),
    h('div', { class: 'by-project-wrap' }, h('p', { class: 'mini-title' }, 'Cost by project'), byProject)));

  const renderControls = () => {
    ranges.replaceChildren(...[7, 30, 90].map((d) =>
      h('button', { type: 'button', 'aria-pressed': String(d === days), onclick: () => { days = d; update(); } }, `${d} days`)));
    legend.replaceChildren(...MODELS.map((m, i) =>
      h('button', { type: 'button', class: `lg lg-${i}`, 'aria-pressed': String(models.has(m)), onclick: () => {
        if (models.has(m) && models.size === 1) return; // keep at least one
        if (models.has(m)) models.delete(m); else models.add(m);
        update();
      } }, h('i', { 'aria-hidden': 'true' }), MODEL_LABEL[m])));
  };
  projectSel.addEventListener('change', () => { project = projectSel.value; update(); });

  const renderKpis = () => {
    kpis.replaceChildren(
      kpi('Sessions', String(data.sessions), `${data.prompts} prompts`),
      kpi('Output tokens', compact(data.outputTokens), `last ${days} days`),
      kpi('Est. cost', usd(data.cost), 'at list prices'),
      kpi('Per session', usd(data.sessions ? data.cost / data.sessions : 0), 'average'));
  };

  const renderChart = () => {
    const max = Math.max(0.5, ...data.days.map((d) => d.total));
    const step = niceStep(max / 4);
    const top = Math.ceil(max / step) * step;
    const iw = W - PAD_L - 8, ih = H - PAD_T - PAD_B;
    const bw = iw / data.days.length;
    const y = (v: number) => PAD_T + ih - (v / top) * ih;
    const grid = [];
    for (let v = 0; v <= top + 1e-9; v += step) {
      grid.push(s('line', { x1: PAD_L, x2: W - 8, y1: y(v), y2: y(v), class: 'grid' }), s('text', { x: PAD_L - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, `$${v.toFixed(step < 1 ? 1 : 0)}`));
    }
    const labelEvery = days <= 7 ? 1 : days <= 30 ? 5 : 15;
    const bars = data.days.map((d, i) => {
      let acc = 0;
      const x = PAD_L + i * bw + bw * 0.15;
      const g = s('g', { class: `day${i === active ? ' is-active' : ''}`, style: { '--i': String(i) } },
        s('rect', { x: PAD_L + i * bw, y: PAD_T, width: bw, height: ih, class: 'hit' }),
        ...MODELS.map((m, mi) => {
          const v = d.cost[m];
          if (!v) return null;
          const r = s('rect', { x, y: y(acc + v), width: Math.max(1, bw * 0.7), height: Math.max(0, y(acc) - y(acc + v)), class: `bar-${mi}`, rx: bw > 10 ? 2 : 0 });
          acc += v;
          return r;
        }));
      return g;
    });
    const labels = data.days.map((d, i) => (d.daysAgo % labelEvery === 0 || i === data.days.length - 1)
      ? s('text', { x: PAD_L + i * bw + bw / 2, y: H - 8, class: 'axis', 'text-anchor': 'middle' }, d.daysAgo === 0 ? 'Today' : dayLabel(daysAgoDate(d.daysAgo)).slice(4))
      : null);
    chart.replaceChildren(...grid, s('g', { class: `bars${drawn ? '' : ' is-drawing'}` }, ...bars), ...labels.filter((l): l is SVGTextElement => l !== null));
    chart.setAttribute('aria-label', `Estimated cost per day, last ${days} days: ${usd(data.cost)} in total. Use the arrow keys to read each day.`);
    drawn = true;
  };

  const renderByProject = () => {
    const max = Math.max(...data.byProject.map((p) => p.cost), 0.01);
    byProject.replaceChildren(...data.byProject.map((p) =>
      h('li', null, h('span', { class: 'bp-name' }, p.project), h('span', { class: 'bp-bar' }, h('i', { style: { width: `${(p.cost / max) * 100}%` } })), h('span', { class: 'bp-val' }, usd(p.cost)))));
  };

  const showTip = (i: number) => {
    active = i;
    for (const g of chart.querySelectorAll('.day')) g.classList.toggle('is-active', Number((g as SVGGElement).style.getPropertyValue('--i')) === i);
    const d = data.days[i];
    if (!d) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.replaceChildren(
      h('strong', null, d.daysAgo === 0 ? 'Today' : dayLabel(daysAgoDate(d.daysAgo))),
      ...MODELS.filter((m) => models.has(m)).map((m) => h('span', { class: `tip-row lg-${MODELS.indexOf(m)}` }, h('i'), `${MODEL_LABEL[m]} ${usd(d.cost[m])}`)),
      h('span', { class: 'tip-total' }, `${usd(d.total)} · ${d.sessions} sessions · ${compact(d.outputTokens)} output tokens`));
    const frac = (i + 0.5) / data.days.length;
    tip.style.left = `${Math.min(80, Math.max(20, ((PAD_L + frac * (W - PAD_L - 8)) / W) * 100))}%`;
  };

  chart.addEventListener('pointermove', (e) => {
    const r = chart.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.floor(((x - PAD_L) / (W - PAD_L - 8)) * data.days.length);
    if (i >= 0 && i < data.days.length && i !== active) showTip(i);
  });
  chart.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { tip.hidden = true; showTip(-1); } });
  chart.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = data.days.length;
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : active < 0 ? n - 1 : Math.min(n - 1, Math.max(0, active + (e.key === 'ArrowRight' ? 1 : -1)));
    showTip(i);
  });
  chart.addEventListener('blur', () => { tip.hidden = true; showTip(-1); });

  const update = () => {
    data = summarize({ days, project: project || undefined, models });
    active = -1;
    tip.hidden = true;
    renderControls(); renderKpis(); renderChart(); renderByProject();
  };
  update();
}

function kpi(label: string, value: string, sub: string) {
  return h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, label), h('strong', { class: 'kpi-value' }, value), h('span', { class: 'kpi-sub' }, sub));
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
