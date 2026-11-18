/**
 * Starts the built dashboard against a throwaway fixture (projects, Claude
 * history, database in a temp folder) for the Playwright smoke tests.
 * Writes the fixture paths to e2e/.fixture.json so tests can inspect files.
 */
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createFixture } from '../apps/api/test/fixture';

const PORT = Number(process.env.SMOKE_PORT ?? 4399);

async function main() {
  // On Windows the runner kills this process before the signal handlers run, so
  // remove the previous run's fixture here instead.
  try {
    const prev = JSON.parse(readFileSync(join(__dirname, '.fixture.json'), 'utf8'));
    if (typeof prev.base === 'string' && /cpd-e2e-/.test(prev.base)) rmSync(prev.base, { recursive: true, force: true });
  } catch { /* first run */ }
  const fx = createFixture();
  process.env.CPD_DATA_DIR = fx.dataDir;
  process.env.CLAUDE_CONFIG_DIR = fx.claudeDir;
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../apps/api/dist/app.module');
  const { configure } = require('../apps/api/dist/configure');
  const app = configure(await NestFactory.create(AppModule, { logger: ['error'] }));
  await app.listen(PORT, '127.0.0.1');

  const base = `http://127.0.0.1:${PORT}/api`;
  const headers = { 'Content-Type': 'application/json', 'x-cpd-client': '1' };
  await fetch(`${base}/settings`, { method: 'PUT', headers, body: JSON.stringify({ roots: [fx.root], useClaudeHistory: true }) });
  await fetch(`${base}/projects/rescan`, { method: 'POST', headers });
  writeFileSync(join(__dirname, '.fixture.json'), JSON.stringify(fx, null, 2));
  console.log(`smoke server ready on ${PORT}`);

  const stop = async () => { await app.close(); rmSync(fx.base, { recursive: true, force: true }); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
