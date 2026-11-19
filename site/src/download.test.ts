import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOWNLOADS, initDownloads, isInstallerName, isMac, parseFeed, type Fetch } from './download.ts';

const FEED = `version: 0.2.1
files:
  - url: Overlook-Setup-0.2.1-x64.exe
    sha512: abc==
    size: 104857600
path: Overlook-Setup-0.2.1-x64.exe
sha512: abc==
releaseDate: '2026-11-19T09:00:00.000Z'
`;

test('parseFeed reads version, path and size (LF and CRLF)', () => {
  for (const text of [FEED, FEED.replace(/\n/g, '\r\n')]) {
    assert.deepEqual(parseFeed(text), { version: '0.2.1', path: 'Overlook-Setup-0.2.1-x64.exe', size: 104857600 });
  }
  assert.deepEqual(parseFeed('nonsense'), { version: undefined, path: undefined, size: undefined });
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

/** The few DOM bits initDownloads touches. */
class El {
  href = '#install';
  textContent = '';
  attrs = new Map<string, string>([['aria-disabled', 'true']]);
  classes = new Set<string>();
  classList = { add: (c: string) => this.classes.add(c), remove: (c: string) => this.classes.delete(c) };
  removeAttribute(name: string) { this.attrs.delete(name); }
  constructor(text = '') { this.textContent = text; }
}

function fakeDoc() {
  const els: Record<string, El> = {};
  for (const id of ['dl-x64', 'dl-arm64', 'dl-mac-arm64', 'dl-mac-x64', 'dl-version', 'dl-main']) els[id] = new El();
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
  assert.equal(els['dl-version'].textContent, 'Latest: v0.2.1.');
  assert.equal(els['dl-mac-arm64'].href, `${DOWNLOADS}/Overlook-0.2.1-arm64.dmg`);
  assert.ok(!els['dl-mac-arm64'].attrs.has('aria-disabled'));
  assert.equal(els['dl-mac-arm64-sub'].textContent, 'M1 and later · 150 MB');
  assert.ok(els['dl-mac-x64'].attrs.has('aria-disabled'), 'no Intel dmg in this release');
  assert.equal(els['dl-mac-x64'].href, '#install');
  assert.ok(calls.includes(`${DOWNLOADS}/Overlook-0.2.1-x64.dmg`));
  assert.ok(els['dl-x64'].classes.has('primary'));
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
