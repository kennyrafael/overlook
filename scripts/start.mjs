// One command to run the dashboard: rebuilds only when sources changed, then serves
// the API and the built UI on http://127.0.0.1:4317. `--open` also opens the browser.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.CPD_PORT) || 4317;
const url = `http://127.0.0.1:${port}`;
const open = process.argv.includes('--open');

/** Newest modification time of any file under `dir` (skipping build output). */
function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

const parts = [
  { name: 'shared', src: ['packages/shared/src'], out: 'packages/shared/dist/index.js' },
  { name: 'api', src: ['apps/api/src', 'packages/shared/src'], out: 'apps/api/dist/main.js' },
  { name: 'web', src: ['apps/web/src', 'apps/web/index.html', 'packages/shared/src'], out: 'apps/web/dist/index.html' },
];

const stale = parts.filter((p) => {
  const out = join(root, p.out);
  if (!existsSync(out)) return true;
  const built = statSync(out).mtimeMs;
  return p.src.some((s) => {
    const abs = join(root, s);
    return existsSync(abs) && (statSync(abs).isDirectory() ? newest(abs) : statSync(abs).mtimeMs) > built;
  });
});

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (stale.length) {
  console.log(`Building (${stale.map((p) => p.name).join(', ')} changed)…`);
  // npm.cmd needs a shell on Windows; the arguments are fixed strings.
  execFileSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}

const server = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], { cwd: join(root, 'apps/api'), stdio: 'inherit', env: process.env });
server.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));

if (open) {
  // Wait for the server, then open the default browser.
  const started = Date.now();
  const tryOpen = async () => {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) {
        const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
        spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
        return;
      }
    } catch { /* not up yet */ }
    if (Date.now() - started < 30_000) setTimeout(tryOpen, 500);
  };
  setTimeout(tryOpen, 500);
}
