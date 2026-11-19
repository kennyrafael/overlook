// Screenshots of the real app for the landing page, taken on the made-up demo projects.
//   npm run build           (repo root: builds the API and the web UI this script serves)
//   cd site && npm run shots
// Builds the demo world (scripts/demo-world.ts), runs the built API + UI on it in this process, opens
// each page in Chrome (Playwright, installed Chrome as in the smoke tests) in light and dark, and
// writes AVIF + WebP at 2x, 1x and sm (900 px, for phones) to src/assets/shots/. Nothing outside the temp folder is touched.
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createWorld, removeWorld } from './demo-world.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const out = join(here, '..', 'src', 'assets', 'shots');
const require = createRequire(join(repo, 'package.json'));
const PORT = Number(process.env.SHOTS_PORT ?? 4398);
const VIEWPORT = { width: 1440, height: 900 };

/** Pages to capture. `path` may use {trailmap} for that project's id. */
const SHOTS: { name: string; path: string; wait: string }[] = [
  { name: 'overview', path: '/', wait: 'Progress by project' },
  { name: 'projects', path: '/projects', wait: 'trailmap' },
  { name: 'project', path: '/projects/{trailmap}', wait: 'Phase 2: Offline packs' },
  { name: 'board', path: '/board', wait: 'Resume interrupted downloads' },
  { name: 'claude', path: '/claude', wait: 'tidepool-api' },
  { name: 'git', path: '/git', wait: 'trailmap' },
];

async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * The demo lives in a temp folder whose path holds the local user name. Before each capture, show it
 * as `~/code/...` in text, titles and inputs, then fail if anything personal is still on the page.
 */
async function maskPaths(page: import('@playwright/test').Page, root: string, base: string): Promise<void> {
  const secrets = [base, homedir(), userInfo().username].filter((s) => s.length >= 3);
  // Plain JavaScript text: tsx would add helpers to a compiled function that do not exist in the page.
  const leaks = (await page.evaluate(`(() => {
    const root = ${JSON.stringify(root)}, base = ${JSON.stringify(base)}, secrets = ${JSON.stringify(secrets)};
    const swap = (s) => !s.includes(base) ? s
      : s.split(root).join('~/code').split(base).join('~').replace(/~[^\\s"']*/g, (p) => p.replace(/\\\\/g, '/'));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue && n.nodeValue.includes(base)) n.nodeValue = swap(n.nodeValue);
    for (const el of document.querySelectorAll('[title], [aria-label], input, textarea')) {
      for (const a of ['title', 'aria-label']) { const v = el.getAttribute(a); if (v && v.includes(base)) el.setAttribute(a, swap(v)); }
      if ('value' in el && typeof el.value === 'string' && el.value.includes(base)) el.value = swap(el.value);
    }
    const visible = [document.body.innerText,
      ...[...document.querySelectorAll('input, textarea')].map((i) => i.value),
      ...[...document.querySelectorAll('[title], [aria-label]')].flatMap((e) => [e.getAttribute('title') || '', e.getAttribute('aria-label') || ''])
    ].join('\\n').toLowerCase();
    return secrets.filter((s) => visible.includes(s.toLowerCase()));
  })()`)) as string[];
  if (leaks.length) throw new Error(`Personal data still visible on ${page.url()}; not saving this screenshot`);
}

async function main() {
  for (const f of ['apps/api/dist/app.module.js', 'apps/web/dist/index.html']) {
    if (!existsSync(join(repo, f))) throw new Error(`${f} is missing: run "npm run build" in the repo root first`);
  }
  console.log('Building the demo projects…');
  const world = createWorld();
  try {
    process.env.CPD_DATA_DIR = world.dataDir;
    process.env.CLAUDE_CONFIG_DIR = world.claudeDir;
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require(join(repo, 'apps/api/dist/app.module'));
    const { configure } = require(join(repo, 'apps/api/dist/configure'));
    const app = configure(await NestFactory.create(AppModule, { logger: ['error'] }));
    await app.listen(PORT, '127.0.0.1');
    const base = `http://127.0.0.1:${PORT}`;
    const api = (path: string, init?: RequestInit) =>
      fetch(`${base}/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'x-cpd-client': '1' } });

    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ roots: [world.root], useClaudeHistory: true, onboarded: true }) });
      await api('/projects/rescan', { method: 'POST' });
      console.log('Waiting for git, Claude usage and progress history…');
      const projects = await waitFor('projects', async () => {
        const list = (await (await api('/projects')).json()) as { id: string; name: string }[];
        return list.length >= 5 ? list : undefined;
      });
      await waitFor('Claude usage', async () => {
        const o = (await (await api('/insights/claude')).json()) as { totals: { sessions: number } };
        return o.totals.sessions > 0 ? true : undefined;
      });
      await waitFor('progress history', async () => {
        const s = (await (await api('/insights/progress?days=90')).json()) as unknown[];
        return Array.isArray(s) && s.length > 30 ? true : undefined;
      });
      const ids: Record<string, string> = Object.fromEntries(projects.map((p) => [p.name, p.id]));

      const { chromium } = require('@playwright/test') as typeof import('@playwright/test');
      const browser = await chromium.launch({ channel: 'chrome' });
      mkdirSync(out, { recursive: true });
      try {
        for (const theme of ['light', 'dark'] as const) {
          const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
          await ctx.addInitScript((t) => { try { localStorage.setItem('cpd-theme', t); } catch { /* ignore */ } }, theme);
          const page = await ctx.newPage();
          for (const s of SHOTS) {
            const path = s.path.replace(/\{(\w[\w-]*)\}/g, (_, n: string) => encodeURIComponent(ids[n] ?? n));
            await page.goto(base + path);
            await page.getByText(s.wait, { exact: false }).first().waitFor({ timeout: 20_000 });
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(1200); // charts finish drawing
            await maskPaths(page, world.root, world.base);
            const png = await page.screenshot({ type: 'png' });
            for (const [scale, width] of [['2x', VIEWPORT.width * 2], ['1x', VIEWPORT.width], ['sm', 900]] as const) {
              const img = sharp(png).resize({ width });
              await img.clone().avif({ quality: 60, effort: 6 }).toFile(join(out, `${s.name}-${theme}@${scale}.avif`));
              await img.clone().webp({ quality: 82 }).toFile(join(out, `${s.name}-${theme}@${scale}.webp`));
            }
            console.log(`  ${s.name} (${theme})`);
          }
          await ctx.close();
        }
      } finally {
        await browser.close();
      }
    } finally {
      await app.close();
    }
  } finally {
    removeWorld(world);
  }
  console.log(`Saved to ${out}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
