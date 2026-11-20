import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.SMOKE_PORT ?? 4399);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1, // tests share one fixture server and edit its files
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Uses the installed Chrome; no browser download needed.
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node --import tsx e2e/serve-fixture.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { SMOKE_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
