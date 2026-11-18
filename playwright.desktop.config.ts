import { defineConfig } from '@playwright/test';

// Smoke tests for the packaged desktop app. Build it first: npm run dist -w @overlook/desktop
export default defineConfig({
  testDir: './e2e-desktop',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
});
