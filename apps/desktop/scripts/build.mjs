// Stages the app (scripts/stage.mjs) and packages it with electron-builder.
// Output: apps/desktop/release/ (Windows: NSIS installers for x64 and arm64 + win-unpacked/; macOS: a .dmg per arch + mac/, mac-arm64/;
// Linux: an AppImage and a .deb per arch + linux-unpacked/, linux-arm64-unpacked/).
// The staged app lives outside the repo, so all paths here are absolute.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { out as appDir } from './stage.mjs';

const require = createRequire(import.meta.url);
const { Arch, build, Platform } = require('electron-builder');
const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const electronVersion = require('../package.json').devDependencies.electron;
const downloadUrl = (process.env.OVERLOOK_DOWNLOAD_URL || 'https://overlook-downloads.kennyrafael-cg.workers.dev/overlook').replace(/\/+$/, '');

const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
// release.yml passes the signing variables as '' when the secrets are not set (and on every non-macOS runner).
// electron-builder reads an empty CSC_LINK as a path, resolves it to the project folder and fails ("… not a
// file"), so empty means unset.
for (const k of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) {
  if (process.env[k] !== undefined && !process.env[k].trim()) delete process.env[k];
}
// macOS Developer ID signing + notarization, only when both are configured (CI secrets, see release.yml):
// CSC_LINK / CSC_KEY_PASSWORD (the .p12 certificate) and an App Store Connect API key
// (APPLE_API_KEY = path to the .p8, APPLE_API_KEY_ID, APPLE_API_ISSUER). A signed build also gets a .zip
// per arch and latest-mac.yml, and the app updates itself (updater.ts reads overlookMacAutoUpdate);
// without them the build stays ad-hoc signed and the app keeps the "new version available" notice.
const MAC_SIGNED = IS_MAC && !!process.env.CSC_LINK
  && !!process.env.APPLE_API_KEY && !!process.env.APPLE_API_KEY_ID && !!process.env.APPLE_API_ISSUER;
if (IS_MAC && !!process.env.CSC_LINK && !MAC_SIGNED) {
  throw new Error('CSC_LINK is set but the notarization key is not (APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER).');
}

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
    target: MAC_SIGNED ? ['dmg', 'zip'] : ['dmg'],
    ...(MAC_SIGNED
      ? {
          // Developer ID (from CSC_LINK) with the hardened runtime, notarized: Gatekeeper opens it without a
          // warning, and Squirrel.Mac (electron-updater) can verify an update against the running app's signature.
          hardenedRuntime: true,
          entitlements: join(desktop, 'resources', 'entitlements.mac.plist'),
          entitlementsInherit: join(desktop, 'resources', 'entitlements.mac.plist'),
          notarize: true,
        }
      : {
          // Ad-hoc signature ("-"): required to run on Apple silicon; no Apple Developer certificate yet, so
          // users approve the first launch in System Settings → Privacy & Security → Open Anyway.
          identity: '-',
          hardenedRuntime: false,
          notarize: false,
        }),
    gatekeeperAssess: false,
    minimumSystemVersion: '12.0',
    extendInfo: {
      // Shown when "Start Claude Code" asks to control Terminal or iTerm (AppleScript) for the first time.
      NSAppleEventsUsageDescription: 'Overlook opens Terminal or iTerm at your project folder to start Claude Code there.',
    },
    // Names the .zip (signed builds only: the update payload electron-updater downloads on macOS, which cannot
    // install a .dmg); the .dmg has its own name below. "arm64" in the name is how electron-updater picks the
    // file for the Mac's arch. electron-builder has no top-level `zip` option and rejects unknown keys.
    artifactName: 'Overlook-${version}-${arch}-mac.${ext}',
  },
  dmg: {
    artifactName: 'Overlook-${version}-${arch}.${ext}',
    title: 'Overlook ${version}',
  },
  // Read at runtime by updater.ts: turns on macOS auto-update for signed builds only.
  extraMetadata: { overlookMacAutoUpdate: MAC_SIGNED },
  linux: {
    icon: join(desktop, 'resources', 'icon.png'), // electron-builder renders the hicolor icon sizes from it
    category: 'Development',
    executableName: 'overlook',
    synopsis: 'A project dashboard for Claude Code',
    description: 'Plan progress, a Kanban board that edits your plan files, git activity and Claude Code usage for your local projects.',
    // desktopName in the staged package.json (stage.mjs) names the .desktop file and Electron's app id / WM_CLASS,
    // so the running window is matched to its launcher entry.
    syncDesktopName: true,
    maintainer: 'AgentHub',
    vendor: 'AgentHub',
    desktop: {
      entry: { Keywords: 'claude;dashboard;projects;plans;kanban;git;' },
    },
  },
  // AppImage toolset 1.0.3: the static AppImage runtime (no libfuse2 needed) and an AppRun that starts the app
  // with --no-sandbox only when user namespaces are blocked (Ubuntu 24.04's AppArmor restriction); the legacy
  // toolset crashes there when the AppImage is run directly.
  toolsets: { appimage: '1.0.3' },
  // AppImage (x86_64 / arm64 in the name): updates itself from latest-linux.yml / latest-linux-arm64.yml.
  appImage: {
    artifactName: 'Overlook-${version}-${arch}.${ext}',
  },
  // .deb (amd64 / arm64 in the name): installed with apt; the app shows a "new version available" notice instead.
  deb: {
    artifactName: 'Overlook-${version}-${arch}.${ext}',
    // Electron's runtime libraries; libasound2 was renamed libasound2t64 in Ubuntu 24.04.
    depends: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'libasound2 | libasound2t64', 'libgbm1'],
  },
};

/**
 * Each mac arch is built separately and electron-builder rewrites latest-mac.yml every time, so the
 * files of all archs are collected here and written back as one feed (electron-updater picks by arch).
 */
const macFeed = { info: null, files: [] };
function collectMacFeed() {
  const yaml = require(require.resolve('js-yaml', { paths: [require.resolve('app-builder-lib')] }));
  const path = join(config.directories.output, 'latest-mac.yml');
  const info = yaml.load(readFileSync(path, 'utf8'));
  macFeed.info ??= info;
  for (const f of info.files ?? []) if (!macFeed.files.some((g) => g.url === f.url)) macFeed.files.push(f);
  // The legacy top-level path/sha512 point at the x64 zip (old electron-updater versions read only these).
  const x64 = macFeed.files.find((f) => f.url.endsWith('.zip') && !f.url.includes('arm64')) ?? macFeed.files[0];
  writeFileSync(path, yaml.dump({ ...macFeed.info, files: macFeed.files, path: x64.url, sha512: x64.sha512 }, { lineWidth: -1 }));
}

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
// Linux: an AppImage and a .deb per arch (arm64 is cross-packaged on x64; both only bundle files).
const platform = IS_MAC ? 'darwin' : IS_LINUX ? 'linux' : 'win32';
// OVERLOOK_ARCHS=x64 builds one arch only (CI's packaged smoke test); releases build both.
const archs = (process.env.OVERLOOK_ARCHS || 'x64,arm64').split(',').map((a) => a.trim()).filter((a) => a === 'x64' || a === 'arm64');
const built = [];
for (const arch of archs) {
  fetchSqlite(arch, platform);
  const targets = IS_MAC ? Platform.MAC.createTarget(MAC_SIGNED ? ['dmg', 'zip'] : 'dmg', Arch[arch])
    : IS_LINUX ? Platform.LINUX.createTarget(['AppImage', 'deb'], Arch[arch])
    : Platform.WINDOWS.createTarget('nsis', Arch[arch]);
  // electron-builder mutates the config it is given, so each build gets a fresh copy.
  const archConfig = structuredClone(config);
  // Windows feeds are named by channel (latest.yml, latest-arm64.yml); on Linux and macOS electron-builder and
  // electron-updater add the platform themselves (latest-linux.yml, latest-linux-arm64.yml, latest-mac.yml;
  // macOS lists both archs in one feed, merged by collectMacFeed).
  archConfig.publish = { ...config.publish, channel: arch === 'arm64' && !IS_LINUX && !IS_MAC ? 'latest-arm64' : 'latest' };
  // Uploading happens in CI (gh release upload), never from a local build.
  built.push(...await build({ projectDir: appDir, targets, config: archConfig, publish: 'never' }));
  if (MAC_SIGNED) collectMacFeed();
}
console.log(`\nmacOS: ${IS_MAC ? (MAC_SIGNED ? 'Developer ID signed + notarized, auto-update on' : 'ad-hoc signed, update notice only') : 'n/a'}`);
console.log('\nBuilt:\n' + built.filter((f) => /\.(exe|dmg|zip|AppImage|deb)$/.test(f)).map((f) => '  ' + f).join('\n'));
