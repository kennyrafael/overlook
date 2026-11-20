/**
 * Smoke tests for the packaged app (Windows: release/win-unpacked/Overlook.exe; macOS: release/mac or mac-arm64/Overlook.app;
 * Linux: release/linux-unpacked/overlook, or the installed .deb when OVERLOOK_EXE=/opt/Overlook/overlook, as CI does).
 * Run `npm run dist -w @overlook/desktop` first, then `npm run test:desktop` (on Linux without a display: xvfb-run -a).
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

const RELEASE = join(__dirname, '..', 'apps', 'desktop', 'release');
// The app built for this machine's arch: Windows x64 → win-unpacked; macOS → mac (x64) or mac-arm64;
// Linux → linux-unpacked (x64) or linux-arm64-unpacked. OVERLOOK_EXE points at another copy (an installed .deb).
const EXE = process.env.OVERLOOK_EXE || (process.platform === 'darwin'
  ? join(RELEASE, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Overlook.app', 'Contents', 'MacOS', 'Overlook')
  : process.platform === 'linux'
    ? join(RELEASE, process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked', 'overlook')
    : join(RELEASE, 'win-unpacked', 'Overlook.exe'));
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
  // Locally a missing build skips the suite; in CI (and with OVERLOOK_EXE) it fails, so a green run means it ran.
  if (!existsSync(EXE) && (process.env.CI || process.env.OVERLOOK_EXE)) throw new Error(`Packaged app not found at ${EXE}`);
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

test('first launch shows the setup dialog', async () => {
  const setup = page.getByRole('dialog', { name: 'Set up Overlook' });
  await expect(setup).toBeVisible();
  await setup.getByRole('button', { name: 'Next' }).click();
  await expect(setup.getByRole('list', { name: 'Detected tools' })).toBeVisible();
  await setup.getByRole('button', { name: 'Next' }).click();
  // The native folder picker is offered in the desktop app.
  await expect(setup.getByRole('button', { name: 'Choose folders…' })).toBeVisible();
  // Enter the fixture folder as a typed path (the native dialog cannot be driven from the test).
  const input = setup.locator('.p-chips input');
  await input.fill(fx.root);
  await input.press('Enter');
  await setup.getByRole('button', { name: 'Finish' }).click();
  await expect(setup).toBeHidden();
  await expect(page.getByText(/projects found/)).toBeVisible();
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

// Not clicked: it opens a native dialog and reads the release feed over the network.
test('Settings offers a manual update check', async () => {
  await page.goto(`${origin}/settings`);
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible();
  await page.goto(`${origin}/`);
});

test('a second launch does not start another copy', async () => {
  const second = spawn(EXE, [], { env: { ...process.env, CPD_DATA_DIR: fx.dataDir, CLAUDE_CONFIG_DIR: fx.claudeDir }, stdio: 'ignore' });
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => { second.kill(); resolve(-1); }, 15_000);
    second.once('exit', (c) => { clearTimeout(t); resolve(c); });
  });
  expect(code).toBe(0);
  // The first copy is still serving.
  expect(await api('/health')).toBe(200);
});

test('links to other sites do not open inside the app', async () => {
  const before = page.url();
  // will-navigate blocks this; the app window must stay on its own origin.
  await page.evaluate(() => { window.location.href = 'https://example.com/'; }).catch(() => {});
  await page.waitForTimeout(500);
  expect(page.url().startsWith(origin)).toBe(true);
  expect(page.url()).toBe(before);
});

test('quitting stops the app and its server', async () => {
  const exited = new Promise<number | null>((resolve) => app.once('exit', resolve));
  await page.close(); // last window closed and "keep running in the tray" is off → quit
  const code = await Promise.race([exited, new Promise<string>((r) => setTimeout(() => r('timeout'), 15_000))]);
  expect(code).not.toBe('timeout');
  // The server process is gone too: nothing answers on the old port.
  await expect.poll(async () => {
    try { await fetch(`${origin}/api/health`); return 'up'; } catch { return 'down'; }
  }, { timeout: 10_000 }).toBe('down');
});
