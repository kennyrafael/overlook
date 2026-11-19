// Drives the built site (dist/) in Chrome without any local server: requests to https://overlook.test
// are answered from disk with the same headers Vercel sends (vercel.json, including the CSP), and the
// download feed is faked. Exercises every demo and saves screenshots.
//   npm run build && node --import tsx scripts/check-demos.ts [out-dir]
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const out = process.argv[2] ?? join(here, '..', 'test-results', 'demos');
const require = createRequire(join(here, '..', '..', 'package.json'));
const { chromium } = require('@playwright/test') as typeof import('@playwright/test');

const vercel = JSON.parse(readFileSync(join(here, '..', 'vercel.json'), 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const HEADERS = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const FEED = "version: 0.2.1\nfiles:\n  - url: Overlook-Setup-0.2.1-x64.exe\n    size: 104857600\npath: Overlook-Setup-0.2.1-x64.exe\n";

const problems: string[] = [];
const check = (ok: unknown, what: string) => { if (!ok) problems.push(what); console.log(`${ok ? '  ok ' : '  FAIL'} ${what}`); };

async function main() {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('Run "npm run build" first');
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const runs = [
    ['light', { width: 1440, height: 900 }, 'no-preference'],
    ['dark', { width: 390, height: 844 }, 'no-preference'],
    ['light', { width: 1440, height: 900 }, 'reduce'],
  ] as const;
  for (const [scheme, size, motion] of runs) {
    console.log(`\n${scheme}, ${size.width}×${size.height}, reduced motion: ${motion}`);
    const ctx = await browser.newContext({ viewport: size, colorScheme: scheme, deviceScaleFactor: 1, reducedMotion: motion });
    await ctx.route('https://overlook.test/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = normalize(join(dist, path === '/' ? 'index.html' : path));
      if (!file.startsWith(dist) || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, body: readFileSync(file), headers: { ...HEADERS, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' } });
    });
    await ctx.route('https://overlook-downloads.kennyrafael-cg.workers.dev/**', (route) =>
      route.request().url().endsWith('.yml')
        ? route.fulfill({ status: 200, body: FEED, headers: { 'access-control-allow-origin': 'https://overlook.test' } })
        : route.fulfill({ status: 404, headers: { 'access-control-allow-origin': 'https://overlook.test' } }));
    const page = await ctx.newPage();
    const errors: string[] = [];
    // The fake feed has no .dmg, so the macOS probes 404 by design; anything else counts.
    page.on('console', (m) => { if (m.type() === 'error' && !m.location().url.endsWith('.dmg')) errors.push(`${m.text()} ${m.location().url}`); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('https://overlook.test/');
    await page.waitForLoadState('networkidle');

    check((await page.getAttribute('#dl-main', 'href'))?.endsWith('Overlook-Setup-0.2.1-x64.exe'), 'main download button points at the installer');
    const animated = await page.evaluate(() => document.querySelector('.hero')!.classList.contains('is-animated'));
    check(animated === (motion !== 'reduce'), `hero is ${motion === 'reduce' ? 'the still scene' : 'animated'}`);

    for (const id of ['discover', 'plans', 'usage', 'git', 'privacy']) {
      const demo = page.locator(`#${id} .demo`);
      await demo.scrollIntoViewIfNeeded();
      await page.locator(`#${id} .demo.is-live`).waitFor({ timeout: 5000 }).catch(() => {});
      check(await demo.evaluate((e) => e.classList.contains('is-live')), `${id}: live demo mounted`);
      await page.waitForTimeout(1200);
      await demo.screenshot({ path: join(out, `${id}-${scheme}${motion === 'reduce' ? '-reduced' : ''}.png`) });
    }

    // Discovery assembled once in view
    await page.locator('#discover .demo').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    check((await page.locator('.disc-count').textContent())?.startsWith('5'), 'discovery: 5 projects found once in view');

    // Board: keyboard move, then Undo
    const card = page.locator('#plans .card[data-id="1.3"]');
    await card.focus();
    await page.keyboard.press('ArrowRight');
    check((await page.locator('#plans [data-task="1.3"]').textContent())?.includes('[x]'), 'board: → moves the card to Done and ticks line 15');
    check(await page.locator('#plans .toast').isVisible(), 'board: toast with Undo shown');
    await page.locator('#plans .toast-undo').click();
    check((await page.locator('#plans [data-task="1.3"]').textContent())?.includes('[~]'), 'board: Undo restores the line');
    // Board: tap menu
    await page.locator('#plans .card[data-id="2.0"]').click();
    await page.locator('#plans .card-menu button', { hasText: 'Done' }).click();
    check((await page.locator('#plans [data-task="2.0"]').textContent())?.includes('[x]'), 'board: tap menu moves a card');
    await page.locator('#plans .board-demo').screenshot({ path: join(out, `board-moved-${scheme}.png`) });

    // Usage: switch range, filter a project, read a day with the keyboard
    const before = await page.locator('#usage .kpi-value').nth(2).textContent();
    await page.locator('#usage .seg button', { hasText: '7 days' }).click();
    check((await page.locator('#usage .day').count()) === 7, 'usage: 7-day range shows 7 bars');
    await page.locator('#usage select').selectOption('trailmap');
    check((await page.locator('#usage .kpi-value').nth(2).textContent()) !== before, 'usage: project filter changes the cost');
    await page.locator('#usage .usage-chart').focus();
    await page.keyboard.press('End');
    check((await page.locator('#usage .chart-tip').textContent())?.startsWith('Today'), 'usage: End key shows today in the tooltip');

    // Git: filter, keyboard tooltip
    await page.locator('#git .chips button', { hasText: 'inkwell' }).click();
    check((await page.locator('#git .heat-tip').textContent())?.includes('in inkwell'), 'git: project chip filters the heatmap');
    await page.locator('#git .heat').focus();
    await page.keyboard.press('ArrowLeft');
    check(/commit/.test((await page.locator('#git .heat-tip').textContent()) ?? ''), 'git: arrow keys read a day');

    // Privacy switch
    await page.locator('#privacy .switch').click();
    check((await page.locator('#privacy .net-state').textContent())?.startsWith('Offline'), 'privacy: switch turns the update check off');

    // Palette
    await page.keyboard.press('Control+K');
    await page.locator('dialog.palette[open]').waitFor({ timeout: 3000 }).catch(() => {});
    check(await page.locator('dialog.palette[open]').isVisible(), 'palette: Ctrl+K opens it');
    await page.keyboard.type('git');
    await page.screenshot({ path: join(out, `palette-${scheme}.png`) });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    check(await page.evaluate(() => { const r = document.getElementById('git')!.getBoundingClientRect(); return r.top < 200 && r.bottom > 0; }), 'palette: "git" + Enter jumps to the Git section');

    // Layout: no sideways scroll
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
    check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await ctx.close();
  }
  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s)` : '\nAll checks passed');
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
