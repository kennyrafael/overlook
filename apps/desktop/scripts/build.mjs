// Stages the app (scripts/stage.mjs) and packages it with electron-builder.
// Output: apps/desktop/release/ (Windows: NSIS installers for x64 and arm64 + win-unpacked/; macOS: a .dmg per arch + mac/, mac-arm64/).
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
const downloadUrl = (process.env.OVERLOOK_DOWNLOAD_URL || 'https://overlook-downloads.kennyrafael-cg.workers.dev/overlook').replace(/\/+$/, '');

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
  // Release feed for electron-updater, served from Cloudflare R2: x64 → latest.yml, arm64 → latest-arm64.yml
  // (channel set per arch below). The base URL is baked into the app; OVERLOOK_DOWNLOAD_URL overrides it.
  publish: { provider: 'generic', url: downloadUrl },
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
  mac: {
    icon: join(desktop, 'resources', 'icon.png'),
    category: 'public.app-category.developer-tools',
    target: ['dmg'],
    // Ad-hoc signature ("-"): required to run on Apple silicon; no Apple Developer certificate yet, so
    // users approve the first launch in System Settings → Privacy & Security → Open Anyway.
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    minimumSystemVersion: '12.0',
    extendInfo: {
      // Shown when "Start Claude Code" asks to control Terminal or iTerm (AppleScript) for the first time.
      NSAppleEventsUsageDescription: 'Overlook opens Terminal or iTerm at your project folder to start Claude Code there.',
    },
  },
  dmg: {
    artifactName: 'Overlook-${version}-${arch}.${ext}',
    title: 'Overlook ${version}',
  },
};

const IS_MAC = process.platform === 'darwin';

/** Downloads the prebuilt better-sqlite3 binary for this Electron version and arch into the staged app. */
function fetchSqlite(arch, platform) {
  console.log(`\nFetching prebuilt better-sqlite3 for Electron ${electronVersion} (${arch}) …`);
  execFileSync(process.execPath, [
    join(appDir, 'node_modules', 'prebuild-install', 'bin.js'),
    '--runtime', 'electron', '--target', electronVersion, '--arch', arch, '--platform', platform, '--tag-prefix', 'v',
  ], { cwd: join(appDir, 'node_modules', 'better-sqlite3'), stdio: 'inherit' });
}

// One arch at a time, because the staged app holds one native binary at a time.
// Windows: NSIS installers. macOS: one .dmg per arch (a universal build would need both native binaries
// merged with lipo; two smaller downloads are simpler and the download page picks the right one).
const built = [];
for (const arch of ['x64', 'arm64']) {
  fetchSqlite(arch, IS_MAC ? 'darwin' : 'win32');
  const targets = IS_MAC ? Platform.MAC.createTarget('dmg', Arch[arch]) : Platform.WINDOWS.createTarget('nsis', Arch[arch]);
  // electron-builder mutates the config it is given, so each build gets a fresh copy.
  const archConfig = structuredClone(config);
  archConfig.publish = { ...config.publish, channel: arch === 'arm64' ? 'latest-arm64' : 'latest' };
  // Uploading happens in CI (gh release upload), never from a local build.
  built.push(...await build({ projectDir: appDir, targets, config: archConfig, publish: 'never' }));
}
console.log('\nBuilt:\n' + built.filter((f) => /\.(exe|dmg)$/.test(f)).map((f) => '  ' + f).join('\n'));
