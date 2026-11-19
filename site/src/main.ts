import './styles/fonts.css';
import './styles/tokens.css';
import './styles/page.css';
import './styles/textures.css';
import './styles/hero.css';
import './styles/demos.css';
import './styles/widgets.css';
import { initDemos } from './demos/loader.ts';
import { initDownloads } from './download.ts';
import { initHero } from './hero/hero.ts';
import { initMotion, reveal } from './motion/motion.ts';

document.documentElement.classList.add('js');
initMotion();
const hero = document.querySelector<HTMLElement>('.hero');
if (hero) initHero(hero);
reveal(document.querySelectorAll('.reveal'));
initDemos();
void initDownloads(document, (url, init) => fetch(url, init), navigator as Parameters<typeof initDownloads>[2]);
