// Main demo: a plan file next to its board. Moving a card (drag with a mouse, tap then pick a column,
// or ← → on a focused card) ticks the checkbox in the file, moves the progress bars and the burnup,
// and offers Undo, like the app. Clicking a checkbox in the file works the other way round.
import type { TaskState } from '../demo/data.ts';
import { announce, appWindow, h, reducedMotion, s } from './dom.ts';
import { boardModel, boardProgress, burnup, moveTask, planLines, type BoardModel, type BoardTask } from './board-model.ts';

const COLUMNS: { state: TaskState; title: string }[] = [
  { state: 'todo', title: 'To do' },
  { state: 'doing', title: 'In progress' },
  { state: 'done', title: 'Done' },
];
const TITLE: Record<TaskState, string> = { todo: 'To do', doing: 'In progress', done: 'Done' };

export function mount(root: HTMLElement): void {
  const initial = boardModel();
  let model: BoardModel = initial;
  let undoModel: BoardModel | null = null;
  let toastTimer = 0;
  let openMenu: string | null = null;
  let hinted = false;
  const file = initial.project.planFile;
  // The board hides milestones that were already reached when the demo starts (like "Hide reached").
  const shown = new Set(boardProgress(initial).milestones.filter((m) => !m.reached).map((m) => m.title));

  const code = h('ol', { class: 'code', 'aria-label': `${file} contents` });
  const codeScroll = h('div', { class: 'code-scroll' }, code);
  const cols = h('div', { class: 'board-cols' });
  const progressEl = h('div', { class: 'board-progress' });
  const toast = h('div', { class: 'toast', role: 'status', hidden: true });

  root.append(
    h('div', { class: 'board-demo' },
      h('div', { class: 'plan-pane' }, appWindow(`${initial.project.name}/${file}`, codeScroll)),
      h('div', { class: 'board-pane' },
        appWindow('Overlook · Board',
          h('div', { class: 'board-toolbar' },
            h('span', { class: 'chip chip-project' }, initial.project.name),
            h('span', { class: 'board-hint' }, 'Drag a card, tap it, or use the arrow keys'),
            h('span', { class: 'sr-only', id: 'board-help' }, 'Left or right arrow moves the card to the previous or next column. Enter shows the columns to move it to.')),
          cols,
          progressEl)),
      toast));

  // ---- plan file ----
  const renderPlan = (changed?: string) => {
    code.replaceChildren(...planLines(model).map((l) => {
      const li = h('li', { class: l.heading ? 'ln-heading' : l.taskId ? 'ln-task' : 'ln' }, h('span', { class: 'ln-n', 'aria-hidden': 'true' }, l.n));
      if (l.taskId) {
        const t = model.tasks.find((x) => x.id === l.taskId)!;
        const mark = l.text.slice(2, 5);
        li.dataset.task = t.id;
        li.append(h('span', { class: 'ln-text' }, '- ',
          h('button', { class: `ck ck-${t.state}`, type: 'button', onclick: () => move(t.id, t.state === 'done' ? 'todo' : 'done') },
            h('span', { 'aria-hidden': 'true' }, mark), h('span', { class: 'sr-only' }, `${t.text}: ${TITLE[t.state]}. Toggle done`)),
          ' ' + t.text));
        if (t.id === changed) li.classList.add('flash');
      } else {
        li.append(h('span', { class: 'ln-text' }, l.text || '​'));
      }
      return li;
    }));
    if (changed) {
      const li = code.querySelector<HTMLElement>(`[data-task="${changed}"]`);
      if (li) {
        // Scroll the file view (not the page) so the changed line is visible.
        const top = li.offsetTop - codeScroll.clientHeight / 2 + li.offsetHeight / 2;
        codeScroll.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    }
  };

  // ---- board ----
  const lineOf = (id: string) => planLines(model).find((l) => l.taskId === id)!.n;
  const card = (t: BoardTask) => {
    const c = h('button', {
      class: `card${openMenu === t.id ? ' is-open' : ''}`, type: 'button', 'data-id': t.id,
      'aria-describedby': 'board-help',
    },
      h('span', { class: 'chip chip-ms' }, t.milestone.replace(/^Phase \d+: /, '')),
      h('span', { class: 'card-text' }, t.text),
      h('span', { class: 'card-file' }, `${file}:${lineOf(t.id)}`));
    if (!hinted && t.state === 'doing') c.classList.add('hint');
    c.addEventListener('keydown', (e) => {
      const i = COLUMNS.findIndex((x) => x.state === t.state);
      if (e.key === 'ArrowRight' && i < 2) { e.preventDefault(); move(t.id, COLUMNS[i + 1].state, true); }
      if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); move(t.id, COLUMNS[i - 1].state, true); }
      if (e.key === 'Escape' && openMenu) { openMenu = null; renderBoard(); focusCard(t.id); }
    });
    c.addEventListener('pointerdown', (e) => startDrag(e, t, c));
    c.addEventListener('click', () => {
      if (dragged) return;
      openMenu = openMenu === t.id ? null : t.id;
      renderBoard();
      (cols.querySelector<HTMLElement>(`.card-menu[data-for="${t.id}"] button`) ?? cols.querySelector<HTMLElement>(`[data-id="${t.id}"]`))?.focus();
    });
    const wrap = h('li', { class: 'card-wrap' }, c);
    if (openMenu === t.id) {
      wrap.append(h('div', { class: 'card-menu', 'data-for': t.id, role: 'group', 'aria-label': 'Move to' },
        h('span', null, 'Move to'),
        ...COLUMNS.filter((x) => x.state !== t.state).map((x) =>
          h('button', { type: 'button', onclick: () => { openMenu = null; move(t.id, x.state, true); } }, x.title))));
    }
    return wrap;
  };

  const renderBoard = () => {
    const before = new Map([...cols.querySelectorAll<HTMLElement>('.card')].map((c) => [c.dataset.id!, c.getBoundingClientRect()]));
    cols.replaceChildren(...COLUMNS.map((col) => {
      const tasks = model.tasks.filter((t) => t.state === col.state && shown.has(t.milestone));
      return h('section', { class: `col col-${col.state}`, 'data-state': col.state, 'aria-label': `${col.title}, ${tasks.length} cards` },
        h('header', null, h('span', { class: 'col-dot', 'aria-hidden': 'true' }), col.title, h('span', { class: 'count' }, tasks.length)),
        h('ul', { class: 'col-list' }, ...tasks.map(card)));
    }));
    // FLIP: cards glide from where they were.
    if (reducedMotion()) return;
    for (const c of cols.querySelectorAll<HTMLElement>('.card')) {
      const was = before.get(c.dataset.id!);
      if (!was) continue;
      const now = c.getBoundingClientRect();
      const dx = was.left - now.left, dy = was.top - now.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
  };
  const focusCard = (id: string) => cols.querySelector<HTMLElement>(`.card[data-id="${id}"]`)?.focus();

  // ---- progress + burnup ----
  const renderProgress = () => {
    const p = boardProgress(model);
    const series = burnup(model);
    const W = 220, H = 56, max = p.total;
    const x = (i: number) => (i / (series.length - 1)) * W;
    const y = (v: number) => H - 4 - (v / max) * (H - 8);
    const line = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
    progressEl.replaceChildren(
      h('div', { class: 'ms-list' }, ...p.milestones.map((m) =>
        h('div', { class: `ms${m.reached ? ' is-reached' : ''}` },
          h('div', { class: 'ms-head' }, h('span', null, m.title), h('span', { class: 'ms-count' }, m.reached ? 'Reached' : `${m.done}/${m.total}`)),
          h('div', { class: 'bar', role: 'progressbar', 'aria-label': m.title, 'aria-valuemin': 0, 'aria-valuemax': m.total, 'aria-valuenow': m.done },
            h('i', { style: { width: `${(m.done / m.total) * 100}%` } }))))),
      h('div', { class: 'burnup' },
        h('div', { class: 'burnup-head' }, h('strong', null, `${p.done}/${p.total}`), ' tasks · ', h('strong', null, `${p.reached}/${p.milestones.length}`), ' milestones'),
        s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'burnup-chart', role: 'img', 'aria-label': `Burnup: ${p.done} of ${p.total} tasks done, last 90 days` },
          s('line', { x1: 0, x2: W, y1: y(max), y2: y(max), class: 'scope' }),
          s('path', { d: `${line}L${W} ${H}L0 ${H}Z`, class: 'area' }),
          s('path', { d: line, class: 'line' }),
          s('circle', { cx: x(series.length - 1), cy: y(series[series.length - 1]), r: 3.5, class: 'dot' })),
        h('span', { class: 'burnup-caption' }, 'Last 90 days, from the plan file’s git history')));
  };

  // ---- moves ----
  const move = (id: string, state: TaskState, keepFocus = false) => {
    const t = model.tasks.find((x) => x.id === id);
    if (!t || t.state === state) return;
    hinted = true;
    undoModel = model;
    model = moveTask(model, id, state);
    renderAll(id);
    if (keepFocus) focusCard(id);
    const n = lineOf(id);
    const reached = boardProgress(model).milestones.find((m) => m.title === t.milestone && m.reached) && !boardProgress(undoModel).milestones.find((m) => m.title === t.milestone)!.reached;
    showToast(`Moved “${t.text}” to ${TITLE[state]}. ${file} line ${n} updated.${reached ? ` Milestone reached: ${t.milestone}.` : ''}`);
  };

  const showToast = (text: string) => {
    clearTimeout(toastTimer);
    toast.hidden = false;
    toast.replaceChildren(h('span', null, text), h('button', { type: 'button', class: 'toast-undo', onclick: undo }, 'Undo'));
    toast.classList.remove('is-in');
    void toast.offsetWidth;
    toast.classList.add('is-in');
    announce(text);
    toastTimer = window.setTimeout(() => { toast.classList.remove('is-in'); toast.hidden = true; }, 6000);
  };

  const undo = () => {
    if (!undoModel) return;
    const changed = undoModel.tasks.find((t, i) => t.state !== model.tasks[i].state)?.id;
    model = undoModel;
    undoModel = null;
    renderAll(changed);
    clearTimeout(toastTimer);
    toast.hidden = true;
    announce('Undone. The plan file is back as it was.');
    if (changed) focusCard(changed);
  };

  const renderAll = (changed?: string) => { renderBoard(); renderPlan(changed); renderProgress(); };

  // ---- drag (mouse and pen; touch uses tap + "Move to") ----
  let dragged = false;
  const startDrag = (e: PointerEvent, t: BoardTask, c: HTMLElement) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    e.preventDefault(); // no text selection or native drag; keep focus on the card ourselves
    c.focus({ preventScroll: true });
    dragged = false;
    const x0 = e.clientX, y0 = e.clientY;
    let over: HTMLElement | null = null;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      if (!dragged) { dragged = true; hinted = true; c.classList.add('is-dragging'); c.classList.remove('hint'); openMenu = null; }
      c.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.max(-4, Math.min(4, dx / 40))}deg)`;
      c.style.pointerEvents = 'none';
      const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.col') ?? null;
      if (col !== over) { over?.classList.remove('is-over'); col?.classList.add('is-over'); over = col; }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      over?.classList.remove('is-over');
      c.style.pointerEvents = '';
      if (dragged) {
        // Re-render while the card is still where it was dropped, so it glides into place from there.
        const target = over?.dataset.state as TaskState | undefined;
        if (target && target !== t.state) move(t.id, target);
        else renderBoard();
        setTimeout(() => { dragged = false; }, 0);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  renderAll();
}
