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
  // Start every test from clean, per-browser filters.
  await page.addInitScript(() => { try { localStorage.removeItem('cpd-filters'); } catch { /* ignore */ } });
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
