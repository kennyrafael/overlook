// Large-history benchmark: generates GB of Claude Code logs in a temp folder, starts the built API
// against it, and measures (1) the worst /api/health latency while the logs parse (UI freeze) and
// (2) how long /api/insights/claude takes after a restart (parse cache in SQLite).
// Usage: npm run build && node scripts/bench-logs.mjs [GB=5] [--keep]
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gb = Number(process.argv.find((a) => /^\d+(\.\d+)?$/.test(a)) ?? 5);
const keep = process.argv.includes('--keep');
const work = join(tmpdir(), `overlook-bench-${gb}gb`);
const claudeDir = join(work, 'claude');
const dataDir = join(work, 'data');
const port = 4390;
const base = `http://127.0.0.1:${port}`;

const FILE_BYTES = 50 * 1024 * 1024;
const PROJECTS = 20;

function line(session, i) {
  const ts = new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();
  const pad = 'x'.repeat(600);
  return i % 3 === 0
    ? JSON.stringify({ type: 'user', sessionId: session, cwd: 'C:\\work\\app', version: '2.1.4', message: { role: 'user', content: `prompt ${i} ${pad}` }, uuid: `u${i}`, timestamp: ts }) + '\n'
    : JSON.stringify({ type: 'assistant', sessionId: session, cwd: 'C:\\work\\app', version: '2.1.4', message: { id: `msg_${session}_${i}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: pad }], usage: { input_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 }, output_tokens: 100 } }, uuid: `a${i}`, timestamp: ts }) + '\n';
}

async function writeFile(path, session) {
  const ws = createWriteStream(path);
  let bytes = 0, i = 0, buf = '';
  while (bytes < FILE_BYTES) {
    const l = line(session, i++);
    buf += l; bytes += l.length;
    if (buf.length > 1 << 20) { if (!ws.write(buf)) await new Promise((r) => ws.once('drain', r)); buf = ''; }
  }
  ws.end(buf);
  await new Promise((r) => ws.on('finish', r));
}

async function generate() {
  const files = Math.ceil((gb * 1024 ** 3) / FILE_BYTES);
  const marker = join(work, `done-${files}`);
  if (existsSync(marker)) { console.log(`Reusing ${files} log files in ${claudeDir}`); return; }
  rmSync(work, { recursive: true, force: true });
  console.log(`Generating ${files} × 50 MB logs in ${claudeDir} …`);
  for (let f = 0; f < files; f++) {
    const dir = join(claudeDir, 'projects', `C--work-app${f % PROJECTS}`);
    mkdirSync(dir, { recursive: true });
    await writeFile(join(dir, `s${f}.jsonl`), `s${f}`);
    if (f % 10 === 0) process.stdout.write('.');
  }
  mkdirSync(marker);
  console.log();
}

function start() {
  const p = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, CPD_DATA_DIR: dataDir, CPD_PORT: String(port), CPD_NO_WSL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => process.env.BENCH_VERBOSE && process.stdout.write(d));
  p.stderr.on('data', (d) => process.stderr.write(d));
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUp() {
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not yet */ } await sleep(100); }
  throw new Error('server did not start');
}
async function stop(p) { p.kill(); await new Promise((r) => p.once('exit', r)); }

await generate();
rmSync(dataDir, { recursive: true, force: true });

// Cold run: poll health while the first insights request parses everything.
let p = start();
await waitUp();
let worst = 0, polling = true;
const poller = (async () => {
  while (polling) {
    const t = performance.now();
    await fetch(`${base}/api/health`);
    worst = Math.max(worst, performance.now() - t);
    await sleep(50);
  }
})();
let t = performance.now();
const cold = await (await fetch(`${base}/api/insights/claude`)).json();
const coldMs = performance.now() - t;
polling = false; await poller;
await stop(p);

// Warm restart: time from launch to a full insights response.
t = performance.now();
p = start();
await waitUp();
const warm = await (await fetch(`${base}/api/insights/claude`)).json();
const warmMs = performance.now() - t;
await stop(p);

const sessions = (x) => x.sessions?.length ?? 0;
console.log(JSON.stringify({ gb, coldParseMs: Math.round(coldMs), worstHealthLatencyMs: Math.round(worst), restartToInsightsMs: Math.round(warmMs), sessionsCold: sessions(cold), sessionsWarm: sessions(warm) }, null, 2));
const ok = worst < 500 && warmMs < 3000 && sessions(cold) === sessions(warm) && sessions(cold) > 0;
console.log(ok ? 'PASS' : 'FAIL (want health < 500 ms during parse, restart < 3000 ms, same sessions)');
if (!keep) rmSync(work, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
