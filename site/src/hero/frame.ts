// What the hero looks like at a given scroll progress (pure, unit-tested). See src/styles/hero.css.
import { range } from '../motion/math.ts';

export interface LensGeometry {
  /** Lens centre and resting radius in px, relative to the stage. */
  cx: number;
  cy: number;
  r0: number;
  stageW: number;
  stageH: number;
}

/** The screenshot inside the lens: its natural size and the point (0..1) to aim the lens at when it rests. */
export interface Shot {
  w: number;
  h: number;
  fx: number;
  fy: number;
}

export interface HeroFrame {
  /** Lens radius in px. */
  r: number;
  zoom: number;
  /** Shift of the screenshot (px) so the focus point sits under the resting lens; 0 once it is open. */
  tx: number;
  ty: number;
  copy: number;
  ring: number;
  caption: number;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Radius that covers the whole stage from the lens centre (distance to the farthest corner). */
export function coverRadius(g: LensGeometry): number {
  const dx = Math.max(g.cx, g.stageW - g.cx);
  const dy = Math.max(g.cy, g.stageH - g.cy);
  return Math.hypot(dx, dy) + 2;
}

/**
 * The story over the sticky scroll (p 0..1): the text leaves first, then the lens opens until the app
 * fills the screen (by p = 0.82), the ring fades as it grows, and a caption names the page at the end.
 */
export function heroFrame(p: number, g: LensGeometry, shot?: Shot): HeroFrame {
  const grow = easeInOutCubic(range(p, 0.06, 0.82));
  const zoom = 1.3 - 0.3 * grow;
  const r = g.r0 + (coverRadius(g) - g.r0) * grow;
  let tx = 0, ty = 0;
  if (shot) {
    // The image covers the stage from its top-left corner (object-fit: cover; object-position: 0 0) and
    // is scaled by `zoom` around the lens centre, then shifted by (tx, ty).
    const fit = Math.max(g.stageW / shot.w, g.stageH / shot.h);
    const w = shot.w * fit, h = shot.h * fit;
    // At rest: the focus point sits under the lens centre. Open: the image is centred on the focus
    // horizontally (narrow screens skip the sidebar) and starts at the top.
    const restX = (g.cx - shot.fx * w) * zoom, restY = (g.cy - shot.fy * h) * zoom;
    const openX = Math.min(0, Math.max(g.stageW - w, g.stageW / 2 - shot.fx * w)), openY = 0;
    tx = restX + (openX - restX) * grow;
    ty = restY + (openY - restY) * grow;
    // Never let the shift uncover any part of the lens that is on screen.
    const lensL = Math.max(0, g.cx - r), lensR = Math.min(g.stageW, g.cx + r);
    const lensT = Math.max(0, g.cy - r), lensB = Math.min(g.stageH, g.cy + r);
    const left = g.cx * (1 - zoom), right = g.cx + (w - g.cx) * zoom;
    const top = g.cy * (1 - zoom), bottom = g.cy + (h - g.cy) * zoom;
    tx = Math.min(lensL - left, Math.max(lensR - right, tx));
    ty = Math.min(lensT - top, Math.max(lensB - bottom, ty));
  }
  return {
    r,
    zoom,
    tx,
    ty,
    copy: range(p, 0, 0.2),
    ring: range(p, 0.12, 0.4),
    caption: range(p, 0.8, 0.92),
  };
}
