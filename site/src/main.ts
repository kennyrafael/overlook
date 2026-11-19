import './styles/fonts.css';
import './styles/tokens.css';
import './styles/page.css';
import { initDownloads } from './download.ts';
import { initMotion } from './motion/motion.ts';

initMotion();
void initDownloads(document, (url, init) => fetch(url, init), navigator as Parameters<typeof initDownloads>[2]);
