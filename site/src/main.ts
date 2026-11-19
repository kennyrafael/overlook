import './styles/fonts.css';
import './styles/tokens.css';
import './styles/page.css';
import './styles/textures.css';
import './styles/hero.css';
import { initDownloads } from './download.ts';
import { initHero } from './hero/hero.ts';
import { initMotion } from './motion/motion.ts';

initMotion();
const hero = document.querySelector<HTMLElement>('.hero');
if (hero) initHero(hero);
void initDownloads(document, (url, init) => fetch(url, init), navigator as Parameters<typeof initDownloads>[2]);
