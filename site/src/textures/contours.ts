// Topographic contour lines (the terrain you look over from the overlook), drawn as SVG paths.
// Each "hill" is a set of nested closed curves whose radius wobbles with a few sine waves; the same
// seed always gives the same lines. Pure functions: they return path data, the caller adds the SVG.
import { rng } from '../demo/data.ts';

export interface Hill {
  cx: number;
  cy: number;
  /** Radius of the outermost ring. */
  radius: number;
  rings: number;
  seed: number;
}

type Pt = [number, number];

const f = (n: number) => Math.round(n * 10) / 10;

/** Closed Catmull-Rom spline through `pts` as cubic Bézier path data. */
export function smoothClosedPath(pts: Pt[]): string {
  const n = pts.length;
  if (n < 3) throw new Error('need at least 3 points');
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}

/** The rings of one hill, outermost first. */
export function hillPaths(h: Hill, samples = 48): string[] {
  const rand = rng(h.seed);
  // Shared wobble so the rings nest like real contours; each ring adds a little of its own.
  const waves = Array.from({ length: 4 }, (_, k) => ({ k: k + 2, amp: 0.05 + rand() * 0.07, phase: rand() * Math.PI * 2 }));
  const out: string[] = [];
  for (let r = 0; r < h.rings; r++) {
    const t = 1 - r / h.rings; // 1 = outermost
    const own = rand() * Math.PI * 2;
    const pts: Pt[] = [];
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      let k = 1;
      for (const w of waves) k += w.amp * Math.sin(w.k * a + w.phase + own * 0.15) * (0.6 + 0.4 * t);
      const rad = h.radius * t * k;
      // Squash vertically: seen from a lookout, the terrain recedes.
      pts.push([h.cx + Math.cos(a) * rad, h.cy + Math.sin(a) * rad * 0.62]);
    }
    out.push(smoothClosedPath(pts));
  }
  return out;
}

/** Default hills for a 1600×1000 view box. */
export const HILLS: Hill[] = [
  { cx: 260, cy: 300, radius: 520, rings: 9, seed: 11 },
  { cx: 1320, cy: 220, radius: 600, rings: 10, seed: 23 },
  { cx: 820, cy: 860, radius: 560, rings: 8, seed: 37 },
];

/** Fills an <svg viewBox="0 0 1600 1000"> with the contour paths (once). */
export function drawContours(svg: SVGSVGElement, hills: Hill[] = HILLS): void {
  if (svg.childElementCount) return;
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  hills.forEach((h, hi) =>
    hillPaths(h).forEach((d, ri) => {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.setAttribute('pathLength', '1');
      p.style.setProperty('--i', String(hi * 3 + ri));
      g.append(p);
    }),
  );
  svg.append(g);
}
