import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';
import { statsPage } from '../src/stats-page.js';

const ENV = { STATS_PASSWORD: 'correct horse battery staple', CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'test-token' };
const auth = (pw) => ({ authorization: `Basic ${btoa(`owner:${pw}`)}` });
const req = (path = '/stats', headers = {}) => new Request(`https://overlook-downloads.example${path}`, { headers });

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
/** A fake SQL API: answers each report by the words in its query. */
function fakeApi(calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const sql = init.body;
    let data = [];
    if (sql.includes('GROUP BY version')) data = [
      { version: '0.3.0', platform: 'windows', arch: 'x64', downloads: '40' },
      { version: '0.3.0', platform: 'macos', arch: 'arm64', downloads: '12' },
      { version: '0.3.0', platform: 'linux', arch: 'x64', downloads: '3' },
    ];
    else if (sql.includes('GROUP BY day, platform')) data = [
      { day: `${yesterday} 00:00:00`, platform: 'windows', checks: '20' },
      { day: `${yesterday} 00:00:00`, platform: 'macos', checks: '5' },
      { day: `${today} 00:00:00`, platform: 'windows', checks: '2' },
    ];
    else if (sql.includes('GROUP BY day')) data = [{ day: `${yesterday} 00:00:00`, downloads: '9' }];
    else if (sql.includes('GROUP BY country')) data = [{ country: '<b>PT</b>', downloads: '30' }];
    else if (sql.includes('GROUP BY kind')) data = [{ kind: 'download', count: '55' }, { kind: 'update-download', count: '7' }, { kind: 'update-check', count: '27' }];
    return { ok: true, text: async () => JSON.stringify({ data }) };
  };
}

test('/stats does not exist until all three secrets are set', async () => {
  assert.equal((await worker.fetch(req(), {})).status, 404);
  assert.equal((await worker.fetch(req(), { STATS_PASSWORD: 'x', CLOUDFLARE_ACCOUNT_ID: 'acc' })).status, 404);
});

test('a missing or wrong password gets a 401 with a Basic challenge', async () => {
  const none = await statsPage(req(), ENV, fakeApi());
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate'), /^Basic realm="Overlook stats"/);
  assert.equal((await statsPage(req('/stats', auth('wrong')), ENV, fakeApi())).status, 401);
  assert.equal((await statsPage(req('/stats', { authorization: 'Basic !!!' }), ENV, fakeApi())).status, 401);
  assert.equal((await statsPage(req('/stats', { authorization: 'Bearer x' }), ENV, fakeApi())).status, 401);
});

test('the right password shows the totals, platforms, copies in use and tables, escaped', async () => {
  const calls = [];
  const res = await statsPage(req('/stats?days=7', auth(ENV.STATS_PASSWORD)), ENV, fakeApi(calls));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('x-robots-tag'), /noindex/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await res.text();
  assert.equal(calls.length, 5);
  assert.ok(calls.every((c) => c.init.body.includes("INTERVAL '7' DAY") && c.init.headers.Authorization === 'Bearer test-token'));
  assert.match(html, /Downloads<\/span><strong>55</);
  assert.match(html, /Update downloads<\/span><strong>7</);
  // Copies in use: yesterday's checks (20 + 5); today's partial day is not used.
  assert.match(html, /Copies in use<\/span><strong>25</);
  assert.match(html, /Windows<\/span><strong>40</);
  assert.match(html, /macOS<\/span><strong>12</);
  assert.match(html, /Linux<\/span><strong>3</);
  assert.match(html, /aria-current="page">7 days/);
  assert.equal((html.match(/class="bar"/g) ?? []).length, 7);
  assert.ok(html.includes('&lt;b&gt;PT&lt;/b&gt;') && !html.includes('<b>PT</b>'));
  assert.ok(!html.includes('test-token'));
  assert.ok(!/<script/i.test(html));
});

test('an unknown range falls back to 30 days', async () => {
  const calls = [];
  await statsPage(req('/stats?days=1000', auth(ENV.STATS_PASSWORD)), ENV, fakeApi(calls));
  assert.ok(calls.every((c) => c.init.body.includes("INTERVAL '30' DAY")));
});

test('a Cloudflare error shows a 502 page without the token', async () => {
  const fetchFn = async () => ({ ok: false, status: 403, text: async () => '{"errors":[{"message":"Authentication error"}]}' });
  const res = await statsPage(req('/stats', auth(ENV.STATS_PASSWORD)), ENV, fetchFn);
  assert.equal(res.status, 502);
  const html = await res.text();
  assert.match(html, /Could not read the numbers/);
  assert.match(html, /403/);
  assert.ok(!html.includes('test-token'));
});

test('downloads are still served next to /stats', async () => {
  const env = { ...ENV, BUCKET: { get: async () => null } };
  assert.equal((await worker.fetch(req('/overlook/latest.yml'), env)).status, 404);
  assert.equal((await worker.fetch(req('/statsx'), env)).status, 404);
});
