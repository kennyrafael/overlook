import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queries, run, table } from '../scripts/stats.mjs';

test('every report reads the overlook dataset for the requested window, with sampling taken into account', () => {
  const q = queries(7);
  assert.equal(Object.keys(q).length, 5);
  for (const sql of Object.values(q)) {
    assert.match(sql, /FROM overlook /);
    assert.match(sql, /INTERVAL '7' DAY/);
    assert.match(sql, /SUM\(_sample_interval\)/);
  }
  assert.match(q['Downloads by version and platform'], /blob1 = 'download'/);
  assert.match(q['Update checks per day (about one per running copy)'], /blob1 = 'update-check'/);
});

test('tables are readable, with dates trimmed and empty results said plainly', () => {
  assert.equal(table([]), '  (none yet)');
  const t = table([{ day: '2026-11-19 00:00:00', downloads: 12 }, { day: '2026-11-20 00:00:00', downloads: 3.4 }]);
  assert.match(t, /day\s+downloads/);
  assert.match(t, /2026-11-19\s+12/);
  assert.match(t, /2026-11-20\s+3$/m);
});

test('run sends each query to the SQL API with the token, and prints the answers', async () => {
  const calls = [];
  const out = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, text: async () => JSON.stringify({ data: [{ version: '0.2.1', platform: 'windows', arch: 'x64', downloads: '5' }] }) };
  };
  await run({ accountId: 'acc 1', token: 'test-token', days: 30, fetchFn, log: (s) => out.push(s) });
  assert.equal(calls.length, 5);
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc%201/analytics_engine/sql');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token');
  assert.match(out[0], /Downloads by version and platform \(last 30 days\)/);
  assert.match(out[0], /0\.2\.1\s+windows\s+x64\s+5/);
});

test('an API error is reported with its status, without the token', async () => {
  const fetchFn = async () => ({ ok: false, status: 403, text: async () => '{"errors":[{"message":"Authentication error"}]}' });
  await assert.rejects(run({ accountId: 'a', token: 'secret-value', days: 30, fetchFn, log: () => {} }), (e) => {
    assert.match(e.message, /403/);
    assert.ok(!e.message.includes('secret-value'));
    return true;
  });
});
