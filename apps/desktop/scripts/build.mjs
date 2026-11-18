// Stages the app (scripts/stage.mjs) and packages it with electron-builder.
// Output: apps/desktop/release/ (NSIS installers for x64 and arm64, plus win-unpacked/ folders).
// The staged app lives outside the repo, so all paths here are absolute.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { out as appDir } from './stage.mjs';

const require = createRequire(import.meta.url);
const { Arch, build, Platform } = require('electron-builder');
const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const electronVersion = require('../package.json').devDependencies.electron;

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'eu.agenthub.overlook',
  productName: 'Overlook',
  copyright: 'Copyright (c) 2026 AgentHub',
  electronVersion,
  directories: {
    app: appDir,
    output: join(desktop, 'release'),
    buildResources: join(desktop, 'resources'),
  },
  asar: true,
  asarUnpack: ['**/*.node'], // native modules (better-sqlite3) cannot load from inside the asar
  // No rebuild: fetchSqlite() below puts the prebuilt Electron binary of better-sqlite3 in place per arch
  // (electron-builder's rebuild needs Python and Visual Studio when it cannot find one).
  npmRebuild: false,
  nodeGypRebuild: false,
  files: [
    '**/*',
    '!.npmrc',
    '!local/**',
    '!package-lock.json',
    '!**/*.map',
    '!**/{test,tests,__tests__,docs,example,examples}/**',
    '!**/*.{md,markdown}',
    'THIRD_PARTY_NOTICES.md',
  ],
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  },
  // Release feed for electron-updater: x64 → latest.yml, arm64 → latest-arm64.yml (set per arch below).
  publish: { provider: 'github', owner: 'kennyrafael', repo: 'overlook', releaseType: 'release' },
  win: {
    icon: join(desktop, 'resources', 'icon.png'),
    target: ['nsis'],
    signAndEditExecutable: true, // sets icon and version info; no certificate yet (unsigned build)
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Overlook',
    uninstallDisplayName: 'Overlook',
    deleteAppDataOnUninstall: false,
    artifactName: 'Overlook-Setup-${version}-${arch}.${ext}',
  },
};

/** Downloads the prebuilt better-sqlite3 binary for this Electron version and arch into the staged app. */
function fetchSqlite(arch) {
  console.log(`\nFetching prebuilt better-sqlite3 for Electron ${electronVersion} (${arch}) …`);
  execFileSync(process.execPath, [
    join(appDir, 'node_modules', 'prebuild-install', 'bin.js'),
    '--runtime', 'electron', '--target', electronVersion, '--arch', arch, '--platform', 'win32', '--tag-prefix', 'v',
  ], { cwd: join(appDir, 'node_modules', 'better-sqlite3'), stdio: 'inherit' });
}

// One arch at a time, because the staged app holds one native binary at a time.
const built = [];
for (const arch of ['x64', 'arm64']) {
  fetchSqlite(arch);
  const targets = Platform.WINDOWS.createTarget('nsis', Arch[arch]);
  // electron-builder mutates the config it is given, so each build gets a fresh copy.
  const archConfig = structuredClone(config);
  archConfig.publish = { ...config.publish, channel: arch === 'arm64' ? 'latest-arm64' : 'latest' };
  // Uploading happens in CI (gh release upload), never from a local build.
  built.push(...await build({ projectDir: appDir, targets, config: archConfig, publish: 'never' }));
}
console.log('\nBuilt:\n' + built.filter((f) => f.endsWith('.exe')).map((f) => '  ' + f).join('\n'));
