// Tiny DOM helpers for the demos (no framework: the page budget is small).
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

function apply(el: Element, attrs: Attrs | null | undefined) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.setAttribute('class', String(v));
    else if (k === 'style' && typeof v === 'object') for (const [p, sv] of Object.entries(v as Record<string, string>)) (el as HTMLElement).style.setProperty(p, sv);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el: Element, children: Child[]) {
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

let live: HTMLElement | null = null;
/** Says `text` to screen readers (one polite live region for the page). */
export function announce(text: string): void {
  live ??= document.body.appendChild(h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' }));
  live.textContent = '';
  requestAnimationFrame(() => { if (live) live.textContent = text; });
}

export const reducedMotion = () => document.documentElement.dataset.motion === 'reduced';

/** A small window frame around a demo, like the app's own window. */
export function appWindow(title: string, ...children: Child[]): HTMLElement {
  return h('div', { class: 'app-window' },
    h('div', { class: 'app-titlebar', 'aria-hidden': 'true' }, h('span', { class: 'app-dots' }, h('i'), h('i'), h('i')), h('span', { class: 'app-title' }, title)),
    h('div', { class: 'app-body' }, ...children));
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const dayLabel = (d: Date) => `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const daysAgoDate = (n: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); return new Date(d.getTime() - n * 86_400_000); };
