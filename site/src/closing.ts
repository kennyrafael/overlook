// The closing download section: contour lines, and the night landscape and closed lens drifting a
// little as it scrolls into view (CSS reads --p). Still with reduced motion.
import { prefersReducedMotion, scrollProgress } from './motion/motion.ts';
import { drawContours } from './textures/contours.ts';

export function initClosing(): void {
  const section = document.querySelector<HTMLElement>('.get');
  if (!section) return;
  const contours = section.querySelector<SVGSVGElement>('.contours');
  if (contours) drawContours(contours);
  if (prefersReducedMotion()) return;
  const scene = section.querySelector<HTMLElement>('.get-scene');
  scrollProgress(section, (p) => scene?.style.setProperty('--p', p.toFixed(4)), { cssVar: null });
}
