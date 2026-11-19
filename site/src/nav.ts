// Site header behaviour: once the hero has scrolled away (Features and below) the header becomes a
// fixed bar that slides in, and marks the section in view. In-page links scroll smoothly (CSS
// `scroll-behavior`); sections below render lazily (`content-visibility`), so a long smooth scroll can
// end a little off once their real heights are known, and is then nudged onto its target.
import { prefersReducedMotion } from './motion/motion.ts';

export function initNav(): void {
  const header = document.querySelector<HTMLElement>('.site-header');
  const hero = document.querySelector<HTMLElement>('.hero');
  if (header && hero) stickyHeader(header, hero);
  correctAnchorScrolls();
  // Glide for links followed from now on; the browser's own jump to a #hash on load stays instant.
  const smooth = () => document.documentElement.classList.add('smooth-scroll');
  if (document.readyState === 'complete') smooth();
  else window.addEventListener('load', smooth, { once: true });
}

function stickyHeader(header: HTMLElement, hero: HTMLElement): void {
  let hideTimer = 0;
  const show = (on: boolean) => {
    clearTimeout(hideTimer);
    if (on) {
      header.classList.add('is-fixed');
      // Next frame, so the bar starts above the viewport and slides in.
      requestAnimationFrame(() => requestAnimationFrame(() => header.classList.add('is-shown')));
    } else if (header.classList.contains('is-fixed')) {
      header.classList.remove('is-shown');
      hideTimer = window.setTimeout(() => header.classList.remove('is-fixed'), prefersReducedMotion() ? 0 : 300);
    }
  };
  // The hero's bottom edge is where Features starts: show the bar once it is within the bar's height of
  // the top, so a link to #features (which lands at the scroll padding) shows it too.
  const bar = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 76) + 4;
  new IntersectionObserver(([e]) => {
    if (e) show(!e.isIntersecting && e.boundingClientRect.bottom < bar);
  }, { rootMargin: `-${bar}px 0px 0px 0px` }).observe(hero);

  // Highlight the nav link of the section in view.
  const links = [...header.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]')];
  const targets = links.map((a) => document.querySelector<HTMLElement>(a.hash)).filter((t): t is HTMLElement => !!t);
  const visible = new Set<Element>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? visible.add(e.target) : visible.delete(e.target);
    const current = targets.find((t) => visible.has(t));
    for (const a of links) {
      if (current && a.hash === `#${current.id}`) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  for (const t of targets) io.observe(t);
}

function correctAnchorScrolls(): void {
  if (!('onscrollend' in window)) return;
  let target: HTMLElement | null = null;
  const remember = () => { target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null; };
  window.addEventListener('hashchange', remember);
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
    if (a && (a as HTMLAnchorElement).hash === location.hash) setTimeout(remember, 0);
  });
  let tries = 0;
  // The reader taking over the scroll cancels the correction.
  const cancel = () => { target = null; tries = 0; };
  for (const ev of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(ev, cancel, { passive: true });
  window.addEventListener('scrollend', () => {
    if (!target) return;
    const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const off = target.getBoundingClientRect().top - pad;
    if (Math.abs(off) > 4 && tries < 3) {
      tries++;
      target.scrollIntoView({ block: 'start' });
    } else {
      target = null;
      tries = 0;
    }
  });
}
