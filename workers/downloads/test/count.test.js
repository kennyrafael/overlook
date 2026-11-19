import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, dataPoint, fromStart } from '../src/count.js';
import worker from '../src/index.js';

const SITE = 'https://overlook.agenthub.pt';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36';
const APP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Overlook/0.2.1 Chrome/142.0 Electron/42.0.0 Safari/537.36';
const get = (file, extra = {}) => classify({ method: 'GET', file, userAgent: BROWSER, country: 'PT', ...extra }, SITE);

test('installers from the website count as downloads, with platform, arch and version', () => {
  assert.deepEqual(get('Overlook-Setup-0.2.1-x64.exe'), {
    kind: 'download', platform: 'windows', arch: 'x64', version: '0.2.1', file: 'Overlook-Setup-0.2.1-x64.exe', country: 'PT', source: 'web',
  });
  assert.equal(get('Overlook-Setup-0.2.1-arm64.exe').arch, 'arm64');
  const dmg = get('Overlook-0.2.1-arm64.dmg');
  assert.deepEqual([dmg.platform, dmg.arch], ['macos', 'arm64']);
  const appImage = get('Overlook-0.3.0-x86_64.AppImage');
  assert.deepEqual([appImage.platform, appImage.arch], ['linux', 'x64']);
  assert.deepEqual(
    [get('Overlook-0.3.0-amd64.deb').arch, get('Overlook-0.3.0-arm64.deb').arch, get('Overlook-0.3.0-aarch64.AppImage').arch],
    ['x64', 'arm64', 'arm64'],
  );
  assert.equal(get('Overlook-1.0.0-beta.2-x64.dmg').version, '1.0.0-beta.2');
});

test('the app fetching an installer is an update download, not a new one', () => {
  const c = get('Overlook-Setup-0.2.1-x64.exe', { userAgent: APP });
  assert.equal(c.kind, 'update-download');
  assert.equal(c.source, 'app');
});

test('only whole downloads count: resumes, partial blocks, HEAD probes and other files do not', () => {
  assert.ok(fromStart(null) && fromStart('bytes=0-') && fromStart('bytes=0-1023'));
  assert.ok(!fromStart('bytes=1024-') && !fromStart('bytes=-500'));
  assert.equal(get('Overlook-Setup-0.2.1-x64.exe', { range: 'bytes=0-' }).kind, 'download');
  assert.equal(get('Overlook-Setup-0.2.1-x64.exe', { range: 'bytes=5000-9999' }), null);
  assert.equal(classify({ method: 'HEAD', file: 'Overlook-0.2.1-arm64.dmg', userAgent: BROWSER }, SITE), null);
  for (const f of ['Overlook-Setup-0.2.1-x64.exe.blockmap', 'Overlook-0.2.1-x64.dmg.blockmap', 'notes.txt', 'Overlook-Setup-x64.exe']) {
    assert.equal(get(f), null, f);
  }
});

test('update feeds read by the app are update checks; the landing page reading them is not', () => {
  assert.deepEqual(get('latest.yml', { userAgent: APP }), {
    kind: 'update-check', platform: 'windows', arch: 'x64', version: '', file: 'latest.yml', country: 'PT', source: 'app',
  });
  assert.equal(get('latest-arm64.yml').arch, 'arm64');
  assert.equal(get('latest-mac.yml').platform, 'macos');
  assert.equal(get('latest-linux.yml').platform, 'linux');
  assert.equal(get('latest.yml', { origin: SITE }), null);
});

test('data points carry no personal data, only the classification', () => {
  const p = dataPoint(get('Overlook-Setup-0.2.1-x64.exe'));
  assert.deepEqual(p, {
    indexes: ['download'],
    blobs: ['download', 'windows', 'x64', '0.2.1', 'Overlook-Setup-0.2.1-x64.exe', 'PT', 'web'],
    doubles: [1],
  });
  assert.ok(!JSON.stringify(p).includes('Mozilla'));
});

// ---- The Worker end to end, with a fake R2 bucket and a fake Analytics Engine binding ----
function fakeEnv(files) {
  const points = [];
  const bucket = {
    async get(key, opts) {
      if (!(key in files)) return null;
      const body = files[key];
      const range = opts?.range?.get?.('range');
      const m = range && /^bytes=(\d+)-(\d*)$/.exec(range);
      const obj = {
        size: body.length,
        httpEtag: '"e"',
        body: new Blob([body]).stream(),
        writeHttpMetadata(h) { h.set('Content-Type', 'application/octet-stream'); },
      };
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : body.length - 1;
        obj.range = { offset: start, length: end - start + 1 };
        obj.body = new Blob([body.slice(start, end + 1)]).stream();
      }
      return obj;
    },
  };
  return { points, env: { BUCKET: bucket, overlook: { writeDataPoint: (p) => points.push(p) } } };
}

function req(path, init = {}) {
  const r = new Request(`https://overlook-downloads.example/overlook/${path}`, init);
  Object.defineProperty(r, 'cf', { value: { country: 'BR' } });
  return r;
}

test('the Worker serves files unchanged and records one point per counted request', async () => {
  const { env, points } = fakeEnv({ 'overlook/Overlook-Setup-0.2.1-x64.exe': 'installer-bytes', 'overlook/latest.yml': 'version: 0.2.1' });
  const full = await worker.fetch(req('Overlook-Setup-0.2.1-x64.exe', { headers: { 'user-agent': BROWSER } }), env);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), 'installer-bytes');
  const part = await worker.fetch(req('Overlook-Setup-0.2.1-x64.exe', { headers: { range: 'bytes=4-8', 'user-agent': APP } }), env);
  assert.equal(part.status, 206);
  assert.equal(await part.text(), 'aller');
  const head = await worker.fetch(req('Overlook-Setup-0.2.1-x64.exe', { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  await worker.fetch(req('latest.yml', { headers: { origin: SITE } }), env); // the landing page
  await worker.fetch(req('latest.yml', { headers: { 'user-agent': APP } }), env); // the app
  const missing = await worker.fetch(req('Overlook-Setup-9.9.9-x64.exe'), env);
  assert.equal(missing.status, 404);
  assert.deepEqual(points.map((p) => [p.blobs[0], p.blobs[1], p.blobs[5]]), [
    ['download', 'windows', 'BR'],
    ['update-check', 'windows', 'BR'],
  ]);
});

test('a broken or missing counter never breaks a download', async () => {
  const { env } = fakeEnv({ 'overlook/Overlook-0.2.1-arm64.dmg': 'dmg' });
  env.overlook = { writeDataPoint() { throw new Error('analytics down'); } };
  const res = await worker.fetch(req('Overlook-0.2.1-arm64.dmg', { headers: { 'user-agent': BROWSER } }), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'dmg');
  const { env: noBinding } = fakeEnv({ 'overlook/Overlook-0.2.1-arm64.dmg': 'dmg' });
  delete noBinding.overlook;
  assert.equal((await worker.fetch(req('Overlook-0.2.1-arm64.dmg'), noBinding)).status, 200);
});
