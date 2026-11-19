/**
 * Boot loader: runs before the app bundle (its own entry in index.html).
 * 1. Points the theme stylesheet at the right theme now, instead of after React mounts, so it
 *    downloads in parallel with the app.
 * 2. Plays the animated logo over the static one already in the page (#boot-loader) until the
 *    app has mounted and the theme has loaded ('overlook:ready' from ThemeProvider).
 */
import { initialMode, themeHref } from '../theme/themeMode';

const mode = initialMode();
document.documentElement.dataset.theme = mode;
const link = document.getElementById('theme-link') as HTMLLinkElement | null;
if (link && !link.getAttribute('href')) link.href = themeHref(mode);

const loader = document.getElementById('boot-loader');
let anim: { destroy(): void } | null = null;
let done = false;

function hide() {
  if (done || !loader) return;
  done = true;
  loader.classList.add('boot-loader-done');
  setTimeout(() => { anim?.destroy(); loader.remove(); }, 300);
}

window.addEventListener('overlook:ready', hide, { once: true });
setTimeout(hide, 20_000); // never leave the app covered

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const logo = document.getElementById('boot-logo');
if (loader && logo && !reduceMotion) {
  void Promise.all([import('lottie-web/build/player/lottie_light'), import('./logoAnimation')]).then(([lottie, { logoAnimation }]) => {
    if (done) return;
    const player = lottie.default.loadAnimation({
      container: logo, renderer: 'svg', loop: true, autoplay: true, animationData: logoAnimation,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    });
    anim = player;
    // Swap the static logo for the animation once its first frame is drawn.
    player.addEventListener('DOMLoaded', () => logo.querySelector('img')?.remove());
  }).catch(() => { /* the static logo stays */ });
}
