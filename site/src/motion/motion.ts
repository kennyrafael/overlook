// The landing page's small motion system. One requestAnimationFrame loop drives every effect; it only
// runs while something on screen needs it and stops while the tab is hidden. Reduced motion turns
// parallax off and lets sections switch to simple fades (CSS reads `html[data-motion='reduced']`).
// Native scrolling is never taken over.
import { damp, pointerOffset, quantize, stickyProgress, viewProgress } from './math.ts';

type Tick = (dt: number) => void;

const ticks = new Set<Tick>();
let frame = 0;
let last = 0;

function loop(now: number) {
  const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 60);
  last = now;
  for (const t of ticks) t(dt);
  frame = ticks.size && !document.hidden ? requestAnimationFrame(loop) : 0;
}

function wake() {
  if (!frame && ticks.size && !document.hidden) {
    last = 0;
    frame = requestAnimationFrame(loop);
  }
}

/** Runs `fn` when the browser is idle (after first paint), or soon on browsers without idle callbacks. */
export function whenIdle(fn: () => void, timeout = 1500): void {
  if ('requestIdleCallback' in window) requestIdleCallback(() => fn(), { timeout });
  else setTimeout(fn, 200);
}

/** Runs `tick` on every frame until the returned function is called. */
export function onFrame(tick: Tick): () => void {
  ticks.add(tick);
  wake();
  return () => ticks.delete(tick);
}

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const finePointerQuery = typeof matchMedia === 'function' ? matchMedia('(hover: hover) and (pointer: fine)') : null;

export const prefersReducedMotion = () => reducedQuery?.matches ?? false;

/** Calls `cb` now and whenever the reduced-motion setting changes. */
export function onReducedMotion(cb: (reduced: boolean) => void): () => void {
  cb(prefersReducedMotion());
  const listener = () => cb(prefersReducedMotion());
  reducedQuery?.addEventListener('change', listener);
  return () => reducedQuery?.removeEventListener('change', listener);
}

/**
 * Call once at start-up. Motion preferences are read by CSS media queries directly, so nothing is written
 * to <html> (a change there would restyle the whole page).
 */
export function initMotion(): void {
  document.addEventListener('visibilitychange', wake);
}

/** Runs `cb(true)` while `el` is within `margin` of the viewport, `cb(false)` when it leaves. */
export function whenNear(el: Element, cb: (near: boolean) => void, margin = '25%'): () => void {
  // Several changes can arrive in one batch (fast scrolling); the last one is the current state.
  const io = new IntersectionObserver((entries) => cb(entries[entries.length - 1].isIntersecting), { rootMargin: `${margin} 0px` });
  io.observe(el);
  return () => io.disconnect();
}

export interface ScrollOptions {
  /** `view`: 0 → 1 as the element crosses the viewport. `sticky`: 0 → 1 while a tall element is pinned. */
  mode?: 'view' | 'sticky';
  /** CSS variable written on the element (default `--progress`); `null` writes none. */
  cssVar?: string | null;
  /** Measure straight away (default). `false` waits for the first frame, so start-up forces no layout. */
  immediate?: boolean;
}

/**
 * Tracks an element's scroll progress (0..1) while it is near the viewport. Writes it to a CSS
 * variable and calls `cb` when it changes. Works in reduced-motion mode too, so sections can still
 * switch state; whether to animate is up to the CSS.
 */
export function scrollProgress(el: HTMLElement, cb?: (p: number) => void, opts: ScrollOptions = {}): () => void {
  const { mode = 'view', cssVar = '--progress', immediate = true } = opts;
  let prev = -1;
  let queued = 0;
  const measure = () => {
    queued = 0;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = quantize(mode === 'sticky' ? stickyProgress(r.top, r.height, vh) : viewProgress(r.top, r.height, vh));
    if (p === prev) return;
    prev = p;
    if (cssVar) el.style.setProperty(cssVar, String(p));
    cb?.(p);
  };
  // Measure once in the frame after a scroll or resize: an idle page does no work at all.
  const request = () => { queued ||= requestAnimationFrame(measure); };
  const listen = (on: boolean) => {
    for (const type of ['scroll', 'resize'] as const) {
      if (on) window.addEventListener(type, request, { passive: true });
      else window.removeEventListener(type, request);
    }
  };
  if (immediate) measure();
  const stopNear = whenNear(el, (near) => {
    listen(near);
    request(); // near: catch up; leaving: settle at 0 or 1
  });
  return () => { stopNear(); listen(false); cancelAnimationFrame(queued); };
}

export interface ParallaxOptions {
  /** How quickly the value follows the pointer (about 1/seconds). */
  lambda?: number;
  /** CSS variables written on the element (default `--px` / `--py`, each -1..1). */
  cssVars?: [string, string];
}

/**
 * Smoothed pointer offset (-1..1 on each axis, from the viewport centre) for parallax. Only on devices
 * with a mouse or trackpad and when motion is allowed; otherwise the values stay at 0.
 */
export function pointerParallax(el: HTMLElement, cb?: (x: number, y: number) => void, opts: ParallaxOptions = {}): () => void {
  const { lambda = 6, cssVars = ['--px', '--py'] } = opts;
  let target = { x: 0, y: 0 };
  let cur = { x: 0, y: 0 };
  let near = false;
  let stopFrame: (() => void) | null = null;
  const enabled = () => !prefersReducedMotion() && (finePointerQuery?.matches ?? false);

  const write = () => {
    el.style.setProperty(cssVars[0], String(quantize(cur.x)));
    el.style.setProperty(cssVars[1], String(quantize(cur.y)));
    cb?.(cur.x, cur.y);
  };
  const tick: Tick = (dt) => {
    cur = { x: damp(cur.x, target.x, lambda, dt), y: damp(cur.y, target.y, lambda, dt) };
    write();
    // Stop the loop once it has settled; the next pointer move starts it again.
    if (Math.abs(cur.x - target.x) < 1e-3 && Math.abs(cur.y - target.y) < 1e-3) { stopFrame?.(); stopFrame = null; }
  };
  const onMove = (e: PointerEvent) => {
    if (!near || !enabled()) return;
    target = pointerOffset(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
    stopFrame ??= onFrame(tick);
  };
  const reset = () => { target = { x: 0, y: 0 }; stopFrame ??= onFrame(tick); };

  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', reset);
  const stopNear = whenNear(el, (n) => { near = n; if (!n) reset(); });
  const stopReduced = onReducedMotion((reduced) => { if (reduced) { target = cur = { x: 0, y: 0 }; write(); } });
  return () => {
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', reset);
    stopNear(); stopReduced(); stopFrame?.();
  };
}

/**
 * Fade/slide-in on scroll. Elements already on screen are left alone; elements still off screen are
 * marked "reveal-pending" (hidden by CSS when motion is allowed) and get "is-visible" when they come
 * into view. Only those elements are restyled, never the whole page.
 */
export function reveal(els: Iterable<Element>, threshold = 0.15): () => void {
  const seen = new WeakSet<Element>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const first = !seen.has(e.target);
      seen.add(e.target);
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      } else if (first) {
        e.target.classList.add('reveal-pending');
      }
    }
  }, { threshold });
  for (const el of els) io.observe(el);
  return () => io.disconnect();
}
