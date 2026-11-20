// Drives the hero scene (markup in index.html, look in src/styles/hero.css, story in frame.ts).
// The still scene needs no JavaScript. This adds the scroll story and pointer parallax, but only when
// motion is allowed and the device is not low-end; otherwise the still scene stays. Phones always get
// the still scene: the lens is replaced there by a readable crop of the Overview (see hero.css).
import { onReducedMotion, pointerParallax, scrollProgress, whenIdle } from '../motion/motion.ts';
import { drawContours } from '../textures/contours.ts';
import { heroFrame, type LensGeometry, type Shot } from './frame.ts';

/** Very slow devices and data-saver mode get the still scene. */
function lowEnd(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  return nav.connection?.saveData === true || (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 1;
}

export function initHero(hero: HTMLElement): void {
  const stage = hero.querySelector<HTMLElement>('.hero-stage');
  const anchor = hero.querySelector<HTMLElement>('.lens-anchor');
  const contours = hero.querySelector<SVGSVGElement>('.contours');
  if (!stage || !anchor) return;

  // Decorative: drawn once the page is idle, so they never delay the first paint.
  if (contours) whenIdle(() => drawContours(contours));

  let geom: LensGeometry | null = null;
  let progress = 0;
  let stopScroll: (() => void) | null = null;

  const measure = () => {
    const s = stage.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    geom = { cx: a.left - s.left + a.width / 2, cy: a.top - s.top + a.height / 2, r0: a.width / 2, stageW: s.width, stageH: s.height };
  };

  // Aim the resting lens at the KPI cards of the Overview screenshot (1440×900).
  const shot: Shot = { w: 1440, h: 900, fx: 0.5, fy: 0.3 };

  const render = () => {
    if (!geom) return;
    const f = heroFrame(progress, geom, shot);
    const set = (k: string, v: string) => stage.style.setProperty(k, v);
    set('--p', String(progress));
    set('--cx', `${geom.cx.toFixed(1)}px`);
    set('--cy', `${geom.cy.toFixed(1)}px`);
    set('--r', `${f.r.toFixed(1)}px`);
    set('--zoom', f.zoom.toFixed(4));
    set('--tx', `${f.tx.toFixed(1)}px`);
    set('--ty', `${f.ty.toFixed(1)}px`);
    set('--copy', f.copy.toFixed(4));
    set('--ring', f.ring.toFixed(4));
    set('--caption', f.caption.toFixed(4));
  };

  // The tall, sticky layout comes from CSS (when motion is allowed), so starting needs a single layout
  // read and no class change on the section. Very slow devices opt out with .is-still (rare).
  const still = lowEnd() || matchMedia('(max-width: 760px)').matches;
  if (still) hero.classList.add('is-still');

  const setAnimated = (on: boolean) => {
    stopScroll?.();
    stopScroll = null;
    progress = 0;
    measure();
    render(); // the still scene is rendered once too, so the lens is aimed
    // The scroll tracker's first measurement waits for the next frame: no second forced layout now.
    if (on) stopScroll = scrollProgress(hero, (p) => { progress = p; render(); }, { mode: 'sticky', cssVar: null, immediate: false });
  };

  window.addEventListener('resize', () => { measure(); render(); }, { passive: true });
  pointerParallax(stage);
  onReducedMotion((reduced) => setAnimated(!reduced && !still));
}
