/**
 * Starts the built dashboard against a throwaway fixture (projects, Claude
 * history, database in a temp folder) for the Playwright smoke tests.
 * Writes the fixture paths to e2e/.fixture.json so tests can inspect files.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { join, resolve, sep } from 'path';
import { createFixture } from '../apps/api/test/fixture';

const PORT = Number(process.env.SMOKE_PORT ?? 4399);
/** Stand-in for the feedback Worker: records what the app forwards; GET /received lists it. */
export const INBOX_PORT = PORT - 1;

function startInbox() {
  const received: unknown[] = [];
  createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/received') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(received)); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { received.push(JSON.parse(raw)); } catch { /* ignore */ }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  }).listen(INBOX_PORT, '127.0.0.1');
  process.env.OVERLOOK_FEEDBACK_URL = `http://127.0.0.1:${INBOX_PORT}/feedback`;
}

async function main() {
  // On Windows the runner kills this process before the signal handlers run, so
  // remove the previous run's fixture here instead.
  try {
    const prev = JSON.parse(readFileSync(join(__dirname, '.fixture.json'), 'utf8'));
    if (typeof prev.base === 'string' && /cpd-e2e-/.test(prev.base)) rmSync(prev.base, { recursive: true, force: true });
  } catch { /* first run */ }
  startInbox();
  const fx = createFixture();
  process.env.CPD_DATA_DIR = fx.dataDir;
  process.env.CLAUDE_CONFIG_DIR = fx.claudeDir;
  // Express will not sendFile() from a path with a dot folder in it (a checkout under .claude/worktrees/), so
  // deep links would 404 there: serve a copy of the built UI from the fixture folder instead.
  const webDist = resolve(__dirname, '..', 'apps', 'web', 'dist');
  if (webDist.split(sep).some((s) => s.startsWith('.') && s.length > 1)) {
    cpSync(webDist, join(fx.base, 'web-dist'), { recursive: true });
    process.env.CPD_WEB_DIST = join(fx.base, 'web-dist');
  }
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
