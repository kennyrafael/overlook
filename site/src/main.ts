import './styles/fonts.css';
import './styles/tokens.css';
import './styles/page.css';
import './styles/textures.css';
import './styles/hero.css';
import './styles/demos.css';
import './styles/widgets.css';
import './styles/closing.css';
import './styles/feedback.css';
import { initClosing } from './closing.ts';
import { initDemos } from './demos/loader.ts';
import { initDownloads } from './download.ts';
import { initFeedback } from './feedback.ts';
import { initHero } from './hero/hero.ts';
import { initInstallTabs } from './install.ts';
import { initMotion, reveal, whenIdle } from './motion/motion.ts';
import { initNav } from './nav.ts';
import { initTheme } from './theme.ts';
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

inject();
injectSpeedInsights();

// Before anything else, so the screenshots load in the chosen theme and the toggle shows the right icon.
initTheme();

// Start-up waits for the first paint: the hero's tall scroll layout comes from CSS, so setting it up
// afterwards changes nothing on screen, and the headline is never held back by script work.
requestAnimationFrame(() => setTimeout(() => {
  initMotion();
  initNav();
  const hero = document.querySelector<HTMLElement>('.hero');
  if (hero) initHero(hero);
  void initDownloads(document, (url, init) => fetch(url, init), navigator as Parameters<typeof initDownloads>[2]);
  // Everything below the fold starts once the browser is idle.
  whenIdle(() => {
    reveal(document.querySelectorAll('.reveal'));
    initDemos();
    initInstallTabs();
    initClosing();
    initFeedback();
  });
}, 0));
