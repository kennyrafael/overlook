// Assembles <tmp>/overlook-desktop-build/app, the folder electron-builder packages:
//   package.json        (name, version, main, production dependencies of the server)
//   desktop/            (Electron main + preload, from apps/desktop/dist)
//   api/dist/           (Nest server)
//   web/dist/           (built UI)
//   node_modules/       (installed fresh; @overlook/shared copied in; electron-builder rebuilds natives for Electron)
// The monorepo's own node_modules stay built for Node, so `npm test` keeps working.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktop, '..', '..');
// Staged outside the repo so electron-builder does not detect the monorepo workspace above it.
export const out = join(tmpdir(), 'overlook-desktop-build', 'app');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const need = [
  [join(desktop, 'dist', 'main.js'), 'npm run build -w @overlook/desktop'],
  [join(root, 'apps', 'api', 'dist', 'main.js'), 'npm run build'],
  [join(root, 'apps', 'web', 'dist', 'index.html'), 'npm run build'],
  [join(root, 'packages', 'shared', 'dist', 'index.js'), 'npm run build'],
];
for (const [file, cmd] of need) {
  if (!existsSync(file)) { console.error(`Missing ${file}. Run \`${cmd}\` first.`); process.exit(1); }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const rootPkg = read(join(root, 'package.json'));
const apiPkg = read(join(root, 'apps', 'api', 'package.json'));
const desktopPkg = read(join(desktop, 'package.json'));
// The workspace package @overlook/shared is installed from a local copy (copied, not symlinked).
const deps = { ...apiPkg.dependencies, ...desktopPkg.dependencies, '@overlook/shared': 'file:local/shared' };
const noMaps = (src) => !src.endsWith('.map');
const sharedSrc = join(out, 'local', 'shared');
mkdirSync(sharedSrc, { recursive: true });
cpSync(join(root, 'packages', 'shared', 'package.json'), join(sharedSrc, 'package.json'));
cpSync(join(root, 'packages', 'shared', 'dist'), join(sharedSrc, 'dist'), { recursive: true, filter: noMaps });

writeFileSync(join(out, 'package.json'), JSON.stringify({
  name: 'overlook',
  productName: 'Overlook',
  version: rootPkg.version,
  description: 'A project dashboard for Claude Code',
  author: 'AgentHub',
  license: 'MIT',
  main: 'desktop/main.js',
  dependencies: deps,
}, null, 2));

const copy = (from, to, filter) => cpSync(join(root, from), join(out, to), { recursive: true, filter });
copy('apps/desktop/dist', 'desktop', noMaps);
copy('apps/desktop/resources/icon.png', 'desktop/icon.png'); // window and tray icon
copy('apps/api/dist', 'api/dist', noMaps);
copy('apps/web/dist', 'web/dist');
copy('LICENSE', 'LICENSE');
copy('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md');
// Use the repo's registry settings (public npm), not whatever the user's global .npmrc points to.
copy('.npmrc', '.npmrc');

// Production dependencies only, with its own package-lock.json so electron-builder treats the staged app as a
// standalone project (not part of the monorepo workspace). Scripts are skipped: electron-builder rebuilds native modules
// (better-sqlite3) for Electron's ABI during packaging.
console.log('Installing production dependencies into the staged app …');
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['install', '--omit=dev', '--ignore-scripts', '--install-links', '--no-audit', '--no-fund'],
  { cwd: out, stdio: 'inherit', shell: process.platform === 'win32' });

console.log(`Staged app in ${out}`);
