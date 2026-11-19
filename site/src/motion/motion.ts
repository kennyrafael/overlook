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

/** Runs `tick` on every frame until the returned function is called. */
export function onFrame(tick: Tick): () => void {
  ticks.add(tick);
  wake();
  return () => ticks.delete(tick);
}

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const finePointerQuery = typeof matchMedia === 'function' ? matchMedia('(hover: hover) and (pointer: fine)') : null;

export const prefersReducedMotion = () => reducedQuery?.matches ?? false;
export const supportsScrollTimeline = () => typeof CSS !== 'undefined' && CSS.supports?.('animation-timeline: view()') === true;

/** Calls `cb` now and whenever the reduced-motion setting changes. */
export function onReducedMotion(cb: (reduced: boolean) => void): () => void {
  cb(prefersReducedMotion());
  const listener = () => cb(prefersReducedMotion());
  reducedQuery?.addEventListener('change', listener);
  return () => reducedQuery?.removeEventListener('change', listener);
}

/** Sets `data-motion` and `data-scroll-timeline` on <html> and keeps them current. Call once at start-up. */
export function initMotion(root: HTMLElement = document.documentElement): void {
  root.dataset.scrollTimeline = supportsScrollTimeline() ? 'native' : 'js';
  onReducedMotion((reduced) => { root.dataset.motion = reduced ? 'reduced' : 'full'; });
  document.addEventListener('visibilitychange', wake);
}

/** Runs `cb(true)` while `el` is within `margin` of the viewport, `cb(false)` when it leaves. */
export function whenNear(el: Element, cb: (near: boolean) => void, margin = '25%'): () => void {
  const io = new IntersectionObserver(([e]) => cb(e.isIntersecting), { rootMargin: `${margin} 0px` });
  io.observe(el);
  return () => io.disconnect();
}

export interface ScrollOptions {
  /** `view`: 0 → 1 as the element crosses the viewport. `sticky`: 0 → 1 while a tall element is pinned. */
  mode?: 'view' | 'sticky';
  /** CSS variable written on the element (default `--progress`); `null` writes none. */
  cssVar?: string | null;
}

/**
 * Tracks an element's scroll progress (0..1) while it is near the viewport. Writes it to a CSS
 * variable and calls `cb` when it changes. Works in reduced-motion mode too, so sections can still
 * switch state; whether to animate is up to the CSS.
 */
export function scrollProgress(el: HTMLElement, cb?: (p: number) => void, opts: ScrollOptions = {}): () => void {
  const { mode = 'view', cssVar = '--progress' } = opts;
  let prev = -1;
  let stopFrame: (() => void) | null = null;
  const measure = () => {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = quantize(mode === 'sticky' ? stickyProgress(r.top, r.height, vh) : viewProgress(r.top, r.height, vh));
    if (p === prev) return;
    prev = p;
    if (cssVar) el.style.setProperty(cssVar, String(p));
    cb?.(p);
  };
  measure();
  const stopNear = whenNear(el, (near) => {
    stopFrame?.();
    stopFrame = near ? onFrame(measure) : null;
    if (!near) measure(); // settle at 0 or 1 when it leaves
  });
  return () => { stopNear(); stopFrame?.(); };
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
 * Adds `is-visible` to each element the first time it comes into view (for fade/slide-in reveals;
 * CSS decides how it looks, including in reduced-motion mode). Elements already on screen at load
 * are marked straight away.
 */
export function reveal(els: Iterable<Element>, threshold = 0.15): () => void {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-visible');
      io.unobserve(e.target);
    }
  }, { threshold });
  for (const el of els) io.observe(el);
  return () => io.disconnect();
}
