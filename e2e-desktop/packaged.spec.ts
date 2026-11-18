/**
 * Smoke tests for the packaged Windows app (apps/desktop/release/win-unpacked/Overlook.exe).
 * Run `npm run dist -w @overlook/desktop` first, then `npm run test:desktop`.
 *
 * The app runs against a throwaway fixture (CPD_DATA_DIR / CLAUDE_CONFIG_DIR in a temp folder), never
 * the user's data. Playwright attaches over Chromium's DevTools protocol (--remote-debugging-port),
 * because the Electron fuses disable the Node inspector that `_electron.launch` needs.
 */
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createFixture, type Fixture } from '../apps/api/test/fixture';

const EXE = join(__dirname, '..', 'apps', 'desktop', 'release', 'win-unpacked', 'Overlook.exe');
const CDP_PORT = 9339;

let fx: Fixture;
let app: ChildProcess;
let browser: Browser;
let page: Page;
let origin: string;
const plan = () => readFileSync(fx.plan, 'utf8');

/** API call from inside the app window (it has the launch-token cookie). */
async function api(path: string, init?: { method?: string; body?: unknown }) {
  return page.evaluate(async ({ path, init }) => {
    const res = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', 'x-cpd-client': '1' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return res.status;
  }, { path, init });
}

test.beforeAll(async () => {
  test.skip(!existsSync(EXE), `Packaged app not found at ${EXE}; run npm run dist -w @overlook/desktop`);
  fx = createFixture();
  app = spawn(EXE, [`--remote-debugging-port=${CDP_PORT}`], {
    env: { ...process.env, CPD_DATA_DIR: fx.dataDir, CLAUDE_CONFIG_DIR: fx.claudeDir },
    stdio: 'ignore',
  });
  // Wait for the DevTools endpoint, then for the app window.
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok; } catch { return false; }
  }, { timeout: 30_000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  await expect.poll(() => browser.contexts()[0]?.pages().find((p) => p.url().startsWith('http://127.0.0.1:')) ? 1 : 0,
    { timeout: 30_000 }).toBe(1);
  page = browser.contexts()[0].pages().find((p) => p.url().startsWith('http://127.0.0.1:'))!;
  origin = new URL(page.url()).origin;

  // Point the app at the fixture projects.
  expect(await api('/settings', { method: 'PUT', body: { roots: [fx.root], useClaudeHistory: true } })).toBe(200);
  expect(await api('/projects/rescan', { method: 'POST' })).toBeLessThan(300);
});

test.afterAll(async () => {
  await browser?.close().catch(() => {});
  app?.kill();
  if (fx) {
    // The app may still hold the database for a moment after exit.
    await new Promise((r) => setTimeout(r, 1500));
    rmSync(fx.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
});

test('window shows the Overlook UI on a random local port', async () => {
  await page.reload();
  await expect(page).toHaveTitle('Overlook');
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(origin).not.toBe('http://127.0.0.1:4317');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
});

test('the server rejects requests without the launch token', async () => {
  // Same origin, but from outside the app window: no cookie, so it must be refused.
  const res = await fetch(`${origin}/api/health`);
  expect(res.status).toBe(403);
  const page2 = await fetch(`${origin}/`);
  expect(page2.status).toBe(403);
});

test('projects are discovered and a plan edit is written to disk', async () => {
  await page.goto(`${origin}/projects`);
  await page.getByRole('link', { name: 'alpha', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'alpha', exact: true })).toBeVisible();
  await page.getByText('Phase 1', { exact: true }).click();
  await page.getByRole('button', { name: 'Mark as done' }).first().click();
  await expect.poll(plan).toContain('- [x] parser');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(plan).toContain('- [ ] parser');
});

test('an edit made outside the app shows up live', async () => {
  const before = plan();
  writeFileSync(fx.plan, before.replace(/- \[[ x]\] scaffold/, '- [ ] scaffold'));
  await expect(page.getByText('alpha plan updated')).toBeVisible({ timeout: 10_000 });
  writeFileSync(fx.plan, before);
});

test('links to other sites do not open inside the app', async () => {
  const before = page.url();
  // will-navigate blocks this; the app window must stay on its own origin.
  await page.evaluate(() => { window.location.href = 'https://example.com/'; }).catch(() => {});
  await page.waitForTimeout(500);
  expect(page.url().startsWith(origin)).toBe(true);
  expect(page.url()).toBe(before);
});
