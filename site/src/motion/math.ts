// Pure helpers for the motion system (no DOM), so they can be unit-tested in Node.

export const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Maps `v` from [inMin, inMax] to [0, 1], clamped. */
export const range = (v: number, inMin: number, inMax: number) => (inMax === inMin ? (v >= inMax ? 1 : 0) : clamp((v - inMin) / (inMax - inMin)));

/**
 * How far an element has travelled through the viewport: 0 when its top meets the bottom edge,
 * 1 when its bottom leaves the top edge (the same span as CSS `view()` timelines with `cover`).
 */
export function viewProgress(top: number, height: number, viewport: number): number {
  return range(viewport - top, 0, viewport + height);
}

/**
 * Progress while a tall element is pinned: 0 when its top reaches the top of the viewport,
 * 1 when its bottom reaches the bottom (for sticky "scrollytelling" sections).
 */
export function stickyProgress(top: number, height: number, viewport: number): number {
  return range(-top, 0, Math.max(1, height - viewport));
}

/**
 * Frame-rate independent smoothing toward `target` (exponential decay). `lambda` is how fast it
 * follows (about 1/seconds); `dt` is the frame time in seconds.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Pointer position as -1..1 on each axis, from the viewport centre. */
export function pointerOffset(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return { x: clamp((x / Math.max(1, width)) * 2 - 1, -1, 1), y: clamp((y / Math.max(1, height)) * 2 - 1, -1, 1) };
}

/** Rounds to 4 decimals so CSS variables only change when the value really changes. */
export const quantize = (v: number) => Math.round(v * 10000) / 10000;
