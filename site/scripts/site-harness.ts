// Shared by check-demos.ts and audit.ts: serves the built site (dist/) to a Playwright browser without
// any local server. Requests to https://overlook.test are answered from disk with the headers Vercel
// sends (vercel.json, including the CSP), and the download feed is faked.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
export const dist = join(here, '..', 'dist');
export const SITE = 'https://overlook.test/';
const require = createRequire(import.meta.url);
const pw = require('@playwright/test') as typeof import('@playwright/test');

const vercel = JSON.parse(readFileSync(join(here, '..', 'vercel.json'), 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const HEADERS = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.avif': 'image/avif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml',
};
export const FEED = "version: 0.2.1\nfiles:\n  - url: Overlook-Setup-0.2.1-x64.exe\n    size: 104857600\npath: Overlook-Setup-0.2.1-x64.exe\nreleaseDate: '2026-11-19T09:00:00.000Z'\n";

export type Engine = 'chrome' | 'msedge' | 'firefox' | 'webkit';

/** Installed Chrome or Edge (as in the app's smoke tests), or Playwright's Firefox / WebKit. */
export function launch(engine: Engine = (process.env.BROWSER as Engine) || 'chrome'): Promise<Browser> {
  if (engine === 'firefox') return pw.firefox.launch();
  if (engine === 'webkit') return pw.webkit.launch();
  return pw.chromium.launch({ channel: engine });
}

export function assertBuilt(): void {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('Run "npm run build" first');
}

/** Serves dist/ at https://overlook.test and fakes the update feed (no .dmg, so Mac buttons stay off). */
export async function routeSite(ctx: BrowserContext): Promise<void> {
  await ctx.route(`${SITE}**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = normalize(join(dist, path === '/' ? 'index.html' : path));
    if (!file.startsWith(dist) || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, body: readFileSync(file), headers: { ...HEADERS, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' } });
  });
  await ctx.route('https://overlook-downloads.kennyrafael-cg.workers.dev/**', (route) =>
    route.request().url().endsWith('.yml')
      ? route.fulfill({ status: 200, body: FEED, headers: { 'access-control-allow-origin': 'https://overlook.test' } })
      : route.fulfill({ status: 404, headers: { 'access-control-allow-origin': 'https://overlook.test' } }));
}
