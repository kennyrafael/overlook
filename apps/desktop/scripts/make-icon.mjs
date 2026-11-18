// Renders brand/mark.svg to resources/icon.png (1024x1024) with the installed Chrome via Playwright.
// electron-builder turns icon.png into the Windows .ico and macOS .icns.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(desktop, '..', '..', 'brand', 'mark.svg'), 'utf8')
  .replace('<svg ', '<svg width="1024" height="1024" ');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: join(desktop, 'resources', 'icon.png'), omitBackground: true });
await browser.close();
console.log('Wrote resources/icon.png');
