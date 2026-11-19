// Functional checks of the built site in a real browser, with no server (see site-harness.ts):
// every demo, the install tabs, the FAQ and the download section, in light desktop, dark phone,
// reduced motion and with JavaScript off. Saves screenshots.
//   npm run build && npm run check:demos [-- out-dir]      BROWSER=msedge|firefox|webkit to switch
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBuilt, launch, routeSite, SITE, type Engine } from './site-harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, '..', 'test-results', 'demos');
const engine = (process.env.BROWSER as Engine) || 'chrome';

const problems: string[] = [];
const check = (ok: unknown, what: string) => { if (!ok) problems.push(what); console.log(`${ok ? '  ok ' : '  FAIL'} ${what}`); };

async function main() {
  assertBuilt();
  mkdirSync(out, { recursive: true });
  console.log(`Browser: ${engine}`);
  const browser = await launch(engine);
  const runs = [
    ['light', { width: 1440, height: 900 }, 'no-preference'],
    ['dark', { width: 390, height: 844 }, 'no-preference'],
    ['light', { width: 1440, height: 900 }, 'reduce'],
  ] as const;
  for (const [scheme, size, motion] of runs) {
    console.log(`\n${scheme}, ${size.width}×${size.height}, reduced motion: ${motion}`);
    const ctx = await browser.newContext({ viewport: size, colorScheme: scheme, deviceScaleFactor: 1, reducedMotion: motion });
    await routeSite(ctx);
    const page = await ctx.newPage();
    const errors: string[] = [];
    // The fake feed has no .dmg, so the macOS probes 404 by design; anything else counts.
    page.on('console', (m) => { if (m.type() === 'error' && !m.location().url.endsWith('.dmg')) errors.push(`${m.text()} ${m.location().url}`); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(SITE);
    await page.waitForLoadState('networkidle');

    check((await page.getAttribute('#dl-main', 'href'))?.endsWith('Overlook-Setup-0.2.1-x64.exe'), 'main download button points at the installer');
    const animated = await page.evaluate(() => document.querySelector('.hero')!.classList.contains('is-animated'));
    check(animated === (motion !== 'reduce'), `hero is ${motion === 'reduce' ? 'the still scene' : 'animated'}`);

    for (const id of ['discover', 'plans', 'usage', 'git', 'privacy']) {
      const demo = page.locator(`#${id} .demo`);
      // Scroll to the section first: content-visibility skips its content until it is near.
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await demo.scrollIntoViewIfNeeded();
      await page.locator(`#${id} .demo.is-live`).waitFor({ timeout: 5000 }).catch(() => {});
      check(await demo.evaluate((e) => e.classList.contains('is-live')), `${id}: live demo mounted`);
      await page.waitForTimeout(1200);
      await demo.screenshot({ path: join(out, `${id}-${scheme}${motion === 'reduce' ? '-reduced' : ''}.png`) });
    }

    // Discovery assembled once in view
    await page.locator('#discover').scrollIntoViewIfNeeded();
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

    // Install tabs: Windows first (this runs on Windows), arrow keys, and links to #install-mac / #install
    const selected = () => page.evaluate(() => document.querySelector('.install [aria-selected="true"]')?.id);
    check(await selected() === 'tab-win', 'install: the Windows tab is selected for a Windows visitor');
    await page.locator('#tab-win').focus();
    await page.keyboard.press('ArrowRight');
    check(await selected() === 'tab-mac' && await page.locator('#install').isHidden() && await page.locator('#install-mac').isVisible(), 'install: → switches to the macOS guide');
    await page.evaluate(() => { location.hash = '#install'; });
    await page.waitForTimeout(100);
    check(await selected() === 'tab-win', 'install: a link to #install opens the Windows guide');
    await page.locator('#install-guide').screenshot({ path: join(out, `install-${scheme}.png`) });
    await page.evaluate(() => { location.hash = '#install-mac'; });
    await page.waitForTimeout(100);
    check(await selected() === 'tab-mac', 'install: a link to #install-mac opens the macOS guide');
    await page.locator('#install-guide').screenshot({ path: join(out, `install-mac-${scheme}.png`) });

    // FAQ, download section, footer
    await page.locator('#faq summary', { hasText: 'How does it read my plans?' }).click();
    check(await page.locator('#faq .plan-sample').isVisible(), 'faq: the plan format example opens');
    await page.locator('#faq').screenshot({ path: join(out, `faq-${scheme}.png`) });
    check((await page.locator('#dl-release').textContent()) === 'v0.2.1 · 19 Nov 2026', 'download: trust strip shows version and release date');
    await page.locator('#download').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.waitForTimeout(500);
    await page.locator('#download').screenshot({ path: join(out, `download-${scheme}.png`) });
    await page.locator('.site-footer').screenshot({ path: join(out, `footer-${scheme}.png`) });

    // Opening the page at #install-mac lands on the macOS guide (it is hidden until the tabs start).
    await page.goto(SITE + '#install-mac');
    await page.waitForFunction(() => document.getElementById('tab-mac')?.getAttribute('aria-selected') === 'true', null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    const macTop = await page.evaluate(() => document.getElementById('install-mac')!.getBoundingClientRect().top);
    check(macTop >= 0 && macTop < 260, `a link to #install-mac lands on the macOS guide (top ${Math.round(macTop)}px)`);

    // Layout: no sideways scroll
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
    check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await ctx.close();
  }
  // Without JavaScript: the still hero, screenshots in place of demos, both install guides.
  console.log('\nlight, 1440×900, JavaScript off');
  const nojs = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  await routeSite(nojs);
  const p2 = await nojs.newPage();
  await p2.goto(SITE);
  check(await p2.locator('.hero-copy h1').isVisible(), 'no JS: hero headline visible');
  check(await p2.locator('.demo-fallback img').count() === 4 && await p2.locator('.net-static').isVisible(), 'no JS: demos show their screenshots (privacy: its text panel)');
  check(await p2.locator('#install').isVisible() && await p2.locator('#install-mac').isVisible(), 'no JS: both install guides visible');
  check(await p2.locator('.install [role="tablist"]').isHidden(), 'no JS: no tab buttons');
  check(await p2.locator('.feature-copy').first().isVisible(), 'no JS: feature text visible (no reveal hiding)');
  await nojs.close();

  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s)` : '\nAll checks passed');
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
