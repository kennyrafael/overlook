// A copy of the app's command palette (Ctrl+K / ⌘K): jump to a section, download, or try the quick
// actions (which here only explain what they do in the app). Combobox + listbox, keyboard first.
import { announce, h } from './dom.ts';
import { rank } from './palette-model.ts';

interface Item { group: string; label: string; run: () => void }

let dialog: HTMLDialogElement | null = null;

const go = (id: string) => () => {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth', block: 'start' });
  el?.querySelector<HTMLElement>('h2, h1')?.setAttribute('tabindex', '-1');
  setTimeout(() => el?.querySelector<HTMLElement>('h2, h1')?.focus({ preventScroll: true }), 400);
};
const explain = (text: string) => () => showNote(text);

const ITEMS: Item[] = [
  { group: 'Go to', label: 'Projects found for you', run: go('discover') },
  { group: 'Go to', label: 'Plans become a board', run: go('plans') },
  { group: 'Go to', label: 'Claude Code usage', run: go('usage') },
  { group: 'Go to', label: 'Git at a glance', run: go('git') },
  { group: 'Go to', label: 'Nothing leaves your machine', run: go('privacy') },
  { group: 'Go to', label: 'Download', run: go('download') },
  { group: 'Go to', label: 'Install on Windows', run: go('install') },
  { group: 'Go to', label: 'Install on macOS', run: go('install-mac') },
  { group: 'Go to', label: 'FAQ', run: go('faq') },
  { group: 'Action', label: 'Download Overlook', run: () => document.getElementById('dl-main')?.click() },
  { group: 'trailmap', label: 'Start Claude Code', run: explain('In the app, this opens a terminal in ~/code/trailmap and starts Claude Code there.') },
  { group: 'trailmap', label: 'Open in VS Code', run: explain('In the app, this opens ~/code/trailmap in VS Code.') },
  { group: 'View', label: 'Paused projects', run: explain('In the app, this filters the project list to paused projects.') },
  { group: 'Link', label: 'Source code on GitHub', run: () => { location.href = 'https://github.com/kennyrafael/overlook'; } },
];

function showNote(text: string) {
  const note = h('div', { class: 'page-note', role: 'status' }, text);
  document.body.append(note);
  announce(text);
  setTimeout(() => note.classList.add('is-in'), 10);
  setTimeout(() => { note.classList.remove('is-in'); setTimeout(() => note.remove(), 400); }, 4200);
}

export function openPalette(): void {
  if (dialog?.open) { dialog.querySelector('input')?.focus(); return; }
  dialog ??= build();
  const input = dialog.querySelector('input')!;
  input.value = '';
  input.dispatchEvent(new Event('input'));
  dialog.showModal();
  input.focus();
}

function build(): HTMLDialogElement {
  let results: Item[] = ITEMS;
  let active = 0;
  const list = h('ul', { class: 'pal-list', role: 'listbox', id: 'pal-list', 'aria-label': 'Commands' });
  const input = h('input', {
    class: 'pal-input', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list',
    'aria-autocomplete': 'list', placeholder: 'Jump to a section or try an action…', autocomplete: 'off', spellcheck: 'false',
  });
  const d = h('dialog', { class: 'palette', 'aria-label': 'Command palette' },
    h('div', { class: 'pal-box' },
      h('div', { class: 'pal-search' }, input, h('kbd', null, 'Esc')),
      list,
      h('p', { class: 'pal-foot' }, '↑ ↓ to move · Enter to run · a copy of the app’s palette')));

  const render = () => {
    list.replaceChildren(...results.map((it, i) => h('li', {
      id: `pal-${i}`, role: 'option', 'aria-selected': String(i === active), class: i === active ? 'is-active' : '',
      onclick: () => run(i), onpointermove: () => { if (active !== i) { active = i; render(); } },
    }, h('span', { class: 'pal-group' }, it.group), it.label)));
    if (!results.length) list.append(h('li', { class: 'pal-empty', role: 'presentation' }, 'Nothing matches.'));
    input.setAttribute('aria-activedescendant', results.length ? `pal-${active}` : '');
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };
  const run = (i: number) => {
    const it = results[i];
    if (!it) return;
    d.close();
    it.run();
  };
  input.addEventListener('input', () => {
    results = rank(ITEMS, input.value, (it) => `${it.group}: ${it.label}`);
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    if (e.key === 'Enter') { e.preventDefault(); run(active); }
  });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // backdrop
  document.body.append(d);
  render();
  return d;
}
