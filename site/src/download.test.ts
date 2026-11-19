import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOWNLOADS, feedFiles, initDownloads, isInstallerName, isLinux, isLinuxPackageName, isMac, parseFeed, releaseLabel, type Fetch } from './download.ts';

const FEED = `version: 0.2.1
files:
  - url: Overlook-Setup-0.2.1-x64.exe
    sha512: abc==
    size: 104857600
path: Overlook-Setup-0.2.1-x64.exe
sha512: abc==
releaseDate: '2026-11-19T09:00:00.000Z'
`;

test('parseFeed reads version, path, size and release date (LF and CRLF)', () => {
  for (const text of [FEED, FEED.replace(/\n/g, '\r\n')]) {
    const f = parseFeed(text);
    assert.deepEqual({ ...f, released: f.released?.toISOString() },
      { version: '0.2.1', path: 'Overlook-Setup-0.2.1-x64.exe', size: 104857600, released: '2026-11-19T09:00:00.000Z' });
  }
  assert.deepEqual(parseFeed('nonsense'), { version: undefined, path: undefined, size: undefined, released: undefined });
  assert.equal(parseFeed("releaseDate: 'not a date'").released, undefined);
  assert.equal(releaseLabel(new Date('2026-11-19T23:30:00Z')), '19 Nov 2026');
});

test('only plain .exe names are accepted as installers', () => {
  assert.ok(isInstallerName('Overlook-Setup-0.2.1-arm64.exe'));
  for (const bad of [undefined, '', '../evil.exe', 'https://x.test/a.exe', 'a.exe?x=1', 'Overlook.dmg']) assert.ok(!isInstallerName(bad), bad);
});

test('isMac reads userAgentData first, then platform', () => {
  assert.ok(isMac({ userAgentData: { platform: 'macOS' } }));
  assert.ok(isMac({ platform: 'MacIntel' }));
  assert.ok(!isMac({ platform: 'Win32' }));
  assert.ok(!isMac({}));
});

/** A Linux feed as electron-builder writes it: the .deb and the AppImage, in either order. */
const LINUX_FEED = (arch: 'x86_64' | 'arm64', deb: 'amd64' | 'arm64') => `version: 0.3.0
files:
  - url: Overlook-0.3.0-${deb}.deb
    sha512: def==
    size: 83886080
  - url: Overlook-0.3.0-${arch}.AppImage
    sha512: abc==
    size: 125829120
    blockMapSize: 131072
path: Overlook-0.3.0-${deb}.deb
sha512: def==
releaseDate: '2026-12-01T09:00:00.000Z'
`;

test('feedFiles lists every file with its size (LF and CRLF)', () => {
  const expected = [{ url: 'Overlook-0.3.0-amd64.deb', size: 83886080 }, { url: 'Overlook-0.3.0-x86_64.AppImage', size: 125829120 }];
  assert.deepEqual(feedFiles(LINUX_FEED('x86_64', 'amd64')), expected);
  assert.deepEqual(feedFiles(LINUX_FEED('x86_64', 'amd64').replace(/\n/g, '\r\n')), expected);
  assert.deepEqual(feedFiles(FEED), [{ url: 'Overlook-Setup-0.2.1-x64.exe', size: 104857600 }]);
  assert.deepEqual(feedFiles('nonsense'), []);
});

test('only plain .AppImage and .deb names are accepted as Linux packages', () => {
  assert.ok(isLinuxPackageName('Overlook-0.3.0-x86_64.AppImage'));
  assert.ok(isLinuxPackageName('Overlook-0.3.0-amd64.deb'));
  for (const bad of [undefined, '', '../x.deb', 'https://x.test/a.AppImage', 'a.deb?x=1', 'Overlook.exe', 'a.AppImage.sh']) assert.ok(!isLinuxPackageName(bad), bad);
});

test('isLinux: desktop Linux yes, Android and others no', () => {
  assert.ok(isLinux({ userAgentData: { platform: 'Linux' } }));
  assert.ok(isLinux({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }));
  assert.ok(!isLinux({ userAgentData: { platform: 'Android' }, platform: 'Linux armv81' }));
  assert.ok(!isLinux({ platform: 'Linux armv81', userAgent: 'Mozilla/5.0 (Linux; Android 14)' }));
  assert.ok(!isLinux({ platform: 'Win32' }));
  assert.ok(!isLinux({}));
});

/** The few DOM bits initDownloads touches. */
class El {
  href = '#install';
  textContent = '';
  hidden = false;
  attrs = new Map<string, string>([['aria-disabled', 'true']]);
  classes = new Set<string>();
  classList = { add: (c: string) => this.classes.add(c), remove: (c: string) => this.classes.delete(c) };
  removeAttribute(name: string) { this.attrs.delete(name); }
  constructor(text = '') { this.textContent = text; }
}

function fakeDoc() {
  const els: Record<string, El> = {};
  for (const id of ['dl-x64', 'dl-arm64', 'dl-mac-arm64', 'dl-mac-x64', 'dl-version', 'dl-main', 'dl-release',
    'dl-linux-appimage', 'dl-linux-deb', 'dl-linux-arm64-appimage', 'dl-linux-arm64-deb', 'dl-linux-arm64']) els[id] = new El();
  els['dl-linux-arm64'].hidden = true;
  els['dl-linux-appimage-sub'] = new El('x86_64 · any distribution');
  els['dl-linux-deb-sub'] = new El('amd64 · Debian, Ubuntu');
  els['dl-main'].href = '#download';
  els['dl-main-label'] = new El('Download for Windows');
  els['dl-main-sub'] = new El('Free · open source (MIT)');
  els['dl-x64-sub'] = new El('64-bit (x64)');
  els['dl-arm64-sub'] = new El('arm64');
  els['dl-mac-arm64-sub'] = new El('M1 and later');
  els['dl-mac-x64-sub'] = new El('x64');
  els['dl-x64'].classes.add('primary');
  return { els, doc: { getElementById: (id: string) => els[id] ?? null } as unknown as Document };
}

const respond = (ok: boolean, body = '', headers: Record<string, string> = {}) =>
  Promise.resolve({ ok, text: () => Promise.resolve(body), headers: new Headers(headers) });

test('buttons link to the installers from the feeds; .dmg buttons enable only when the file exists', async () => {
  const { els, doc } = fakeDoc();
  const calls: string[] = [];
  const fetchFn: Fetch = (url) => {
    calls.push(url);
    if (url.endsWith('/latest.yml')) return respond(true, FEED);
    if (url.endsWith('/latest-arm64.yml')) return respond(true, FEED.replace(/x64/g, 'arm64'));
    if (url.endsWith('-arm64.dmg')) return respond(true, '', { 'content-length': String(150 * 1048576) });
    return respond(false);
  };
  await initDownloads(doc, fetchFn, { platform: 'Win32' });

  assert.equal(els['dl-x64'].href, `${DOWNLOADS}/Overlook-Setup-0.2.1-x64.exe`);
  assert.equal(els['dl-arm64'].href, `${DOWNLOADS}/Overlook-Setup-0.2.1-arm64.exe`);
  assert.equal(els['dl-x64-sub'].textContent, '64-bit (x64) · 100 MB');
  assert.equal(els['dl-version'].textContent, 'Latest: v0.2.1, released 19 Nov 2026.');
  assert.equal(els['dl-release'].textContent, 'v0.2.1 · 19 Nov 2026');
  assert.equal(els['dl-mac-arm64'].href, `${DOWNLOADS}/Overlook-0.2.1-arm64.dmg`);
  assert.ok(!els['dl-mac-arm64'].attrs.has('aria-disabled'));
  assert.equal(els['dl-mac-arm64-sub'].textContent, 'M1 and later · 150 MB');
  assert.ok(els['dl-mac-x64'].attrs.has('aria-disabled'), 'no Intel dmg in this release');
  assert.equal(els['dl-mac-x64'].href, '#install');
  assert.ok(calls.includes(`${DOWNLOADS}/Overlook-0.2.1-x64.dmg`));
  assert.ok(els['dl-x64'].classes.has('primary'));
  // No Linux feed in this release: the Linux buttons stay off and the arm64 line stays hidden.
  assert.ok(els['dl-linux-appimage'].attrs.has('aria-disabled'));
  assert.ok(els['dl-linux-deb'].attrs.has('aria-disabled'));
  assert.ok(els['dl-linux-arm64'].hidden);
});

const linuxFetch = (arm64: boolean): Fetch => (url) => {
  if (url.endsWith('/latest.yml')) return respond(true, FEED);
  if (url.endsWith('/latest-linux.yml')) return respond(true, LINUX_FEED('x86_64', 'amd64'));
  if (arm64 && url.endsWith('/latest-linux-arm64.yml')) return respond(true, LINUX_FEED('arm64', 'arm64'));
  return respond(false);
};

test('Linux buttons enable only for the files the Linux feeds list', async () => {
  const { els, doc } = fakeDoc();
  await initDownloads(doc, linuxFetch(false), { platform: 'Win32' });
  assert.equal(els['dl-linux-appimage'].href, `${DOWNLOADS}/Overlook-0.3.0-x86_64.AppImage`);
  assert.ok(!els['dl-linux-appimage'].attrs.has('aria-disabled'));
  assert.equal(els['dl-linux-appimage-sub'].textContent, 'x86_64 · any distribution · 120 MB');
  assert.equal(els['dl-linux-deb'].href, `${DOWNLOADS}/Overlook-0.3.0-amd64.deb`);
  assert.ok(!els['dl-linux-deb'].attrs.has('aria-disabled'));
  assert.equal(els['dl-linux-deb-sub'].textContent, 'amd64 · Debian, Ubuntu · 80 MB');
  // No arm64 feed: its links stay off and hidden.
  assert.ok(els['dl-linux-arm64'].hidden);
  assert.ok(els['dl-linux-arm64-appimage'].attrs.has('aria-disabled'));
  // The Windows feed still sets the version; a Windows visitor keeps the Windows main button.
  assert.equal(els['dl-version'].textContent, 'Latest: v0.2.1, released 19 Nov 2026.');
  assert.ok(els['dl-x64'].classes.has('primary') && !els['dl-linux-appimage'].classes.has('primary'));

  const arm = fakeDoc();
  await initDownloads(arm.doc, linuxFetch(true), { platform: 'Win32' });
  assert.ok(!arm.els['dl-linux-arm64'].hidden);
  assert.equal(arm.els['dl-linux-arm64-appimage'].href, `${DOWNLOADS}/Overlook-0.3.0-arm64.AppImage`);
  assert.equal(arm.els['dl-linux-arm64-deb'].href, `${DOWNLOADS}/Overlook-0.3.0-arm64.deb`);
  assert.ok(!arm.els['dl-linux-arm64-deb'].attrs.has('aria-disabled'));
});

test('a tampered Linux feed keeps the Linux buttons off', async () => {
  const { els, doc } = fakeDoc();
  const evil = LINUX_FEED('x86_64', 'amd64')
    .replace('url: Overlook-0.3.0-x86_64.AppImage', 'url: https://evil.test/x.AppImage')
    .replace('url: Overlook-0.3.0-amd64.deb', 'url: ../x.deb');
  await initDownloads(doc, (url) => (url.endsWith('/latest-linux.yml') ? respond(true, evil) : respond(false)), { platform: 'Linux x86_64' });
  assert.ok(els['dl-linux-appimage'].attrs.has('aria-disabled'));
  assert.ok(els['dl-linux-deb'].attrs.has('aria-disabled'));
  assert.equal(els['dl-linux-appimage'].href, '#install');
});

test('main button: Linux visitors get the AppImage, or the list when there is none', async () => {
  const withLinux = fakeDoc();
  await initDownloads(withLinux.doc, linuxFetch(false), { userAgentData: { platform: 'Linux' } });
  assert.equal(withLinux.els['dl-main'].href, `${DOWNLOADS}/Overlook-0.3.0-x86_64.AppImage`);
  assert.equal(withLinux.els['dl-main-label'].textContent, 'Download for Linux');
  assert.equal(withLinux.els['dl-main-sub'].textContent, 'AppImage · v0.2.1 · 120 MB');
  assert.ok(withLinux.els['dl-linux-appimage'].classes.has('primary') && !withLinux.els['dl-x64'].classes.has('primary'));

  const none = fakeDoc();
  await initDownloads(none.doc, releaseFetch(true), { platform: 'Linux x86_64' });
  assert.equal(none.els['dl-main'].href, '#download');
  assert.equal(none.els['dl-main-label'].textContent, 'Download for Linux');
  assert.equal(none.els['dl-main-sub'].textContent, 'AppImage and .deb');

  // Only a Linux feed (no Windows one): its version is shown.
  const linuxOnly = fakeDoc();
  await initDownloads(linuxOnly.doc, (url) => (url.endsWith('/latest-linux.yml') ? respond(true, LINUX_FEED('x86_64', 'amd64')) : respond(false)), { platform: 'Linux x86_64' });
  assert.equal(linuxOnly.els['dl-version'].textContent, 'Latest: v0.3.0, released 1 Dec 2026.');
  assert.equal(linuxOnly.els['dl-main-sub'].textContent, 'AppImage · v0.3.0 · 120 MB');
});

test('feed failures and tampered feeds keep the fallback links', async () => {
  const { els, doc } = fakeDoc();
  const fetchFn: Fetch = (url) =>
    url.endsWith('/latest.yml') ? respond(true, FEED.replace(/^path: .*$/m, 'path: https://evil.test/x.exe')) : Promise.reject(new Error('offline'));
  await initDownloads(doc, fetchFn, { platform: 'Win32' });
  assert.equal(els['dl-x64'].href, '#install');
  assert.equal(els['dl-arm64'].href, '#install');
  assert.equal(els['dl-version'].textContent, '');
  assert.ok(els['dl-mac-arm64'].attrs.has('aria-disabled'));
});

test('on a Mac the Apple silicon button becomes the main one', async () => {
  const { els, doc } = fakeDoc();
  await initDownloads(doc, () => respond(false), { userAgentData: { platform: 'macOS' } });
  assert.ok(!els['dl-x64'].classes.has('primary'));
  assert.ok(els['dl-mac-arm64'].classes.has('primary'));
});

const releaseFetch = (withDmg: boolean): Fetch => (url) => {
  if (url.endsWith('/latest.yml')) return respond(true, FEED);
  if (url.endsWith('/latest-arm64.yml')) return respond(true, FEED.replace(/x64/g, 'arm64'));
  if (withDmg && url.endsWith('-arm64.dmg')) return respond(true, '', { 'content-length': String(150 * 1048576) });
  return respond(false);
};

test('main button: Windows visitors get the x64 installer with version and size', async () => {
  const { els, doc } = fakeDoc();
  await initDownloads(doc, releaseFetch(true), { platform: 'Win32' });
  assert.equal(els['dl-main'].href, `${DOWNLOADS}/Overlook-Setup-0.2.1-x64.exe`);
  assert.equal(els['dl-main-label'].textContent, 'Download for Windows');
  assert.equal(els['dl-main-sub'].textContent, 'Free · v0.2.1 · 100 MB');
});

test('main button: Mac visitors get the Apple silicon dmg, or the list when there is none', async () => {
  const withDmg = fakeDoc();
  await initDownloads(withDmg.doc, releaseFetch(true), { userAgentData: { platform: 'macOS' } });
  assert.equal(withDmg.els['dl-main'].href, `${DOWNLOADS}/Overlook-0.2.1-arm64.dmg`);
  assert.equal(withDmg.els['dl-main-label'].textContent, 'Download for Mac');
  assert.equal(withDmg.els['dl-main-sub'].textContent, 'Apple silicon · v0.2.1 · 150 MB');

  const noDmg = fakeDoc();
  await initDownloads(noDmg.doc, releaseFetch(false), { platform: 'MacIntel' });
  assert.equal(noDmg.els['dl-main'].href, '#download');
  assert.equal(noDmg.els['dl-main-label'].textContent, 'Download for Mac');
  assert.equal(noDmg.els['dl-main-sub'].textContent, 'Apple silicon and Intel');
});

test('main button keeps its fallback when the feed is down', async () => {
  const { els, doc } = fakeDoc();
  await initDownloads(doc, () => Promise.reject(new Error('offline')), { platform: 'Win32' });
  assert.equal(els['dl-main'].href, '#download');
  assert.equal(els['dl-main-sub'].textContent, 'Free · open source (MIT)');
});
