// Renders the social card (public/og.jpg, 1200×630) from the built page's hero, still scene, light
// theme. Re-run after changing the hero:  npm run build && npm run og
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { assertBuilt, launch, routeSite, SITE } from './site-harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'og.jpg');

assertBuilt();
const browser = await launch('chrome');
const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
await routeSite(ctx);
const page = await ctx.newPage();
await page.goto(SITE);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);
// A card, not a page: hide the menu, the skip link and the scroll hint, and make room for the copy.
await page.addStyleTag({ content: `
  .site-header nav, .skip, .scroll-hint, .cta { display: none !important; }
  .hero-stage { min-height: 0 !important; height: 630px !important; }
  .hero-copy { top: 112px !important; }
  .hero-copy .lede { display: none !important; }
` });
await page.waitForTimeout(300);
const png = await page.locator('.hero-stage').screenshot({ type: 'png' });
await sharp(png).resize({ width: 1200, height: 630 }).jpeg({ quality: 86, mozjpeg: true }).toFile(out);
await browser.close();
console.log(`Saved ${out}`);
