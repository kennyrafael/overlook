// Layout and accessibility audit of the built site (no server; see site-harness.ts):
//  - six widths: no sideways scroll, nothing sticking out of the viewport, full-page screenshots
//  - a touch phone: tap a board card and move it with the "Move to" buttons
//  - heading order (no skipped levels) and every demo reachable by keyboard
//  - axe-core (WCAG 2.1 A/AA) in light and dark, once every demo has loaded
//   npm run build && npm run audit [-- out-dir]      BROWSER=msedge|firefox|webkit to switch
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { assertBuilt, launch, routeSite, SITE, type Engine } from './site-harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, '..', 'test-results', 'audit');
const engine = (process.env.BROWSER as Engine) || 'chrome';
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const problems: string[] = [];
const check = (ok: unknown, what: string) => { if (!ok) problems.push(what); console.log(`${ok ? '  ok ' : '  FAIL'} ${what}`); };

/** Scrolls through the whole page so every lazy demo mounts, then back to the top. */
async function visitAll(page: Page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
}

async function main() {
  assertBuilt();
  mkdirSync(out, { recursive: true });
  console.log(`Browser: ${engine}`);
  const browser = await launch(engine);

  // ---- Widths ----
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    console.log(`\nwidth ${width}`);
    const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 760 : 900 } });
    await routeSite(ctx);
    const page = await ctx.newPage();
    await page.goto(SITE);
    await visitAll(page);
    await page.waitForFunction(() => document.querySelectorAll('.demo.is-live').length === 5, null, { timeout: 8000 }).catch(() => {});
    const live = await page.locator('.demo.is-live').count();
    check(live === 5, `all 5 demos mounted (${live})`);
    const overflow = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (el.closest('.hero-stage, .get-scene, .disc-noise, svg, .contours')) continue; // decorative layers bleed on purpose (clipped)
        // Content inside a box that scrolls sideways (code samples) may be wider; the box itself is checked.
        const scroller = el.parentElement?.closest<HTMLElement>('pre, .code-scroll');
        if (scroller) continue;
        if (r.right > vw + 1 || r.left < -1) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} (${Math.round(r.left)}..${Math.round(r.right)})`);
      }
      return { scroll: document.documentElement.scrollWidth - vw, bad: [...new Set(bad)].slice(0, 6) };
    });
    check(overflow.scroll <= 0, `no sideways scroll${overflow.scroll > 0 ? ` (${overflow.scroll}px)` : ''}`);
    check(overflow.bad.length === 0, `nothing sticks out of the viewport${overflow.bad.length ? `: ${overflow.bad.join(', ')}` : ''}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(out, `page-${width}.jpg`), fullPage: true, type: 'jpeg', quality: 60 });
    await ctx.close();
  }

  // ---- Touch phone ----
  console.log('\ntouch phone (375×812)');
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: engine !== 'firefox' });
    await routeSite(ctx);
    const page = await ctx.newPage();
    await page.goto(SITE);
    await page.locator('#plans').scrollIntoViewIfNeeded();
    await page.locator('#plans .demo').scrollIntoViewIfNeeded();
    await page.locator('#plans .demo.is-live').waitFor();
    await page.locator('#plans .card[data-id="1.4"]').tap();
    await page.locator('#plans .card-menu button', { hasText: 'Done' }).tap();
    check((await page.locator('#plans [data-task="1.4"]').textContent())?.includes('[x]'), 'touch: tap a card, then "Done", ticks the plan line');
    check((await page.locator('#plans .ms-count').nth(1).textContent()) === '4/5', 'touch: the milestone bar moves');
    await ctx.close();
  }

  // ---- Headings, keyboard and axe ----
  for (const scheme of ['light', 'dark'] as const) {
    console.log(`\naccessibility, ${scheme}`);
    // axe is injected as a script, which the page's CSP forbids; bypass it for this run only.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, bypassCSP: true, reducedMotion: 'reduce' });
    await routeSite(ctx);
    const page = await ctx.newPage();
    await page.goto(SITE);
    await visitAll(page);

    const headings = await page.evaluate(() => [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter((h) => (h as HTMLElement).offsetParent !== null || getComputedStyle(h).position === 'absolute')
      .map((h) => ({ level: Number(h.tagName[1]), text: h.textContent!.trim().slice(0, 40) })));
    const h1s = headings.filter((h) => h.level === 1).length;
    const skips = headings.filter((h, i) => i > 0 && h.level > headings[i - 1].level + 1).map((h) => `h${h.level} “${h.text}”`);
    check(h1s === 1, `exactly one h1 (${h1s})`);
    check(skips.length === 0, `no skipped heading levels${skips.length ? `: ${skips.join(', ')}` : ''}`);

    // Every interactive demo control can take keyboard focus.
    const unfocusable = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.demo button, .demo select, .demo [tabindex="0"], .demo a')]
      .filter((el) => el.tabIndex < 0 && !el.closest('[role="tablist"]')).map((el) => el.className || el.tagName).slice(0, 5));
    check(unfocusable.length === 0, `demo controls are keyboard-focusable${unfocusable.length ? `: ${unfocusable.join(', ')}` : ''}`);

    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[]; failureSummary?: string }[] }[] }> } }).axe;
      const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, where: v.nodes.slice(0, v.id === 'color-contrast' ? 40 : 4).map((n) => `${n.target.join(' ')}${n.failureSummary ? ` [${n.failureSummary.split('\n').slice(1, 2).join('').trim().slice(0, 110)}]` : ''}`) }));
    });
    check(result.length === 0, `axe: no WCAG 2.1 A/AA violations${result.length ? ` (${result.length})` : ''}`);
    for (const v of result) {
      console.log(`       ${v.impact} ${v.id} ×${v.count}: ${v.help}`);
      for (const w of v.where) console.log(`         - ${w}`);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s)` : '\nAll checks passed');
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
