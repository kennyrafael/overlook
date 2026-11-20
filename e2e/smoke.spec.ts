import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Fixture } from '../apps/api/test/fixture';

const fx = (): Fixture => JSON.parse(readFileSync(join(__dirname, '.fixture.json'), 'utf8'));
const plan = () => readFileSync(fx().plan, 'utf8');

async function openProject(page: Page, name: string) {
  await page.goto('/projects');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Start every test from clean, per-browser filters and layout (once per test, so a reload keeps them).
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('smoke-clean')) return;
      sessionStorage.setItem('smoke-clean', '1');
      localStorage.removeItem('cpd-filters');
      localStorage.removeItem('cpd-projects-layout');
    } catch { /* ignore */ }
  });
});

test('overview shows KPIs and connects live', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  const projectsKpi = page.locator('.p-card', { hasText: 'Projects' }).first();
  await expect(projectsKpi.locator('.text-3xl')).toHaveText('2');
  await expect(page.getByText('Progress by project')).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();
});

test('projects table lists fixtures and filters by search', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByRole('link', { name: 'alpha', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'beta', exact: true })).toBeVisible();
  await page.getByPlaceholder('Search name, path, tag…').fill('bet');
  await expect(page.getByText('1 of 2 projects')).toBeVisible();
  await expect(page.getByRole('link', { name: 'alpha', exact: true })).toHaveCount(0);
});

test('projects show as cards by default and toggle to the list', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.locator('.project-card')).toHaveCount(2);
  await expect(page.locator('.p-datatable')).toHaveCount(0);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.p-datatable')).toBeVisible();
  await expect(page.locator('.project-card')).toHaveCount(0);
  await expect(page.getByText('2 of 2 projects')).toBeVisible();
  // The choice survives a reload.
  await page.evaluate(() => location.reload());
  await expect(page.locator('.p-datatable')).toBeVisible();
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await page.locator('.project-card', { hasText: 'beta' }).click({ position: { x: 150, y: 70 } });
  await expect(page.getByRole('heading', { name: 'beta', exact: true })).toBeVisible();
});

test('toggling a task in the Milestones tab writes the plan file', async ({ page }) => {
  await openProject(page, 'alpha');
  await page.getByText('Phase 1', { exact: true }).click();
  await page.getByRole('button', { name: 'Mark as done' }).first().click();
  await expect.poll(plan).toContain('- [x] parser');
  await expect(page.getByText('Moved to Done')).toBeVisible();
  // Undo restores the file.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(plan).toContain('- [ ] parser');
});

test('dragging a card on the board changes its checkbox', async ({ page }) => {
  await page.goto('/board');
  const card = page.locator('.board-card', { hasText: 'deploy' });
  const done = page.locator('.board-column').nth(2);
  await expect(card).toBeVisible();
  const from = (await card.boundingBox())!;
  const to = (await done.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + 30, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });
  await page.mouse.up();
  await expect.poll(plan).toMatch(/- \[x\] deploy/);
  await expect(done.locator('.board-card', { hasText: 'deploy' })).toBeVisible();
});

test('an edit made outside the dashboard shows up live', async ({ page }) => {
  await openProject(page, 'alpha');
  const before = plan();
  writeFileSync(fx().plan, before.replace(/- \[[ x]\] scaffold/, '- [ ] scaffold'));
  await expect(page.getByText('alpha plan updated')).toBeVisible({ timeout: 10_000 });
  writeFileSync(fx().plan, before);
});

test('command palette navigates to a project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Open command palette/ }).click();
  await page.getByLabel('Command search').fill('beta');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'beta', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f]{12}$/);
});

test('saved view round-trip', async ({ page }) => {
  await page.goto('/projects');
  await page.getByPlaceholder('Search name, path, tag…').fill('alp');
  await page.getByRole('button', { name: 'Save current filters as a view' }).click();
  await page.getByPlaceholder('e.g. Active web projects').fill('Alpha only');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved view “Alpha only”')).toBeVisible();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByText('2 of 2 projects')).toBeVisible();
  await page.locator('.p-dropdown', { hasText: 'Saved views' }).click();
  await page.getByRole('option', { name: /Alpha only/ }).click();
  await expect(page.getByText('1 of 2 projects')).toBeVisible();
});

test('Claude and Git pages render with fixture data', async ({ page }) => {
  await page.goto('/claude');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('.p-card', { hasText: 'Sessions' }).first().locator('.text-3xl')).toHaveText('1');
  await expect(page.getByText('Parser work')).toBeVisible();
  await page.goto('/git');
  await expect(page.getByText('No git repositories found for these projects.')).toBeVisible();
});

test('deep links work on the production server', async ({ page }) => {
  const res = await page.goto('/settings');
  expect(res?.status()).toBe(200);
  await expect(page.getByText('Cost estimates')).toBeVisible();
});

test('feedback dialog: errors are shown, then only the answers are sent', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Feedback' }).first().click();
  const dialog = page.getByTestId('feedback-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Send answers' }).click();
  await expect(dialog.getByText('Choose yes, maybe or no.')).toBeVisible();
  await dialog.getByLabel('Maybe').check();
  await dialog.getByLabel('Usage budgets and cost alerts').check();
  await dialog.getByLabel('A fair price').selectOption('lt5');
  await dialog.getByLabel('Email, to hear when Pro exists').fill('dev@example.com');
  await dialog.getByRole('button', { name: 'Send answers' }).click();
  await expect(dialog.getByText('Tick the box to agree, or leave the email empty.')).toBeVisible();
  await dialog.getByLabel(/Email me when Overlook Pro exists/).check();
  await dialog.getByRole('button', { name: 'Send answers' }).click();
  await expect(dialog.getByTestId('feedback-status').first()).toHaveText(/Thank you/);

  await dialog.getByRole('tab', { name: 'Suggest a feature' }).click();
  await dialog.getByLabel('Your idea').fill('A timeline of milestones');
  await dialog.getByRole('button', { name: 'Send idea' }).click();
  await expect(dialog.getByText('Thank you! Your idea was sent.')).toBeVisible();

  const got = await (await request.get(`http://127.0.0.1:${Number(process.env.SMOKE_PORT ?? 4399) - 1}/received`)).json();
  const strip = ({ version, ...rest }: Record<string, unknown>) => rest;
  expect(got.map(strip)).toEqual([
    { kind: 'pro', source: 'app', pay: 'maybe', features: ['budgets'], price: 'lt5', email: 'dev@example.com', consent: true },
    { kind: 'idea', source: 'app', text: 'A timeline of milestones' },
  ]);

  await page.keyboard.press('Escape');
  await page.goto('/settings');
  await expect(page.getByTestId('network-card')).toContainText('overlook-feedback');
  await page.getByTestId('feedback-card').getByRole('button', { name: 'Suggest a feature' }).click();
  await expect(page.getByTestId('feedback-dialog').getByLabel('Your idea')).toBeVisible();
});

test('phase 7: session detail opens from the session table, and search finds a prompt', async ({ page }) => {
  await page.goto('/claude');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByTestId('rolling-usage')).toContainText("not your plan's limit");
  await page.getByRole('link', { name: 'Parser work' }).click();
  const detail = page.getByTestId('session-detail');
  await expect(detail.getByRole('heading', { name: 'Parser work' })).toBeVisible();
  await expect(detail).toContainText('build the parser');
  await expect(detail).toContainText('src/parser.ts');
  await expect(detail.locator('canvas')).toBeVisible();

  await page.goto('/claude');
  await page.getByLabel('Search prompts').fill('parser');
  const results = page.getByTestId('search-results');
  await expect(results.locator('mark')).toHaveText('parser');
  await results.getByRole('link', { name: 'Parser work' }).click();
  await expect(page.getByTestId('session-detail')).toContainText('build the parser');
});
