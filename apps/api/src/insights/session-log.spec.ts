import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LogAccumulator, bucketCost, priceFor, type PriceTable } from './session-log';
import { parseBranchLine } from './git.service';

const table: PriceTable = {
  prices: {
    'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  },
  cacheWrite5mMultiplier: 1.25,
  cacheWrite1hMultiplier: 2,
};

const asst = (id: string, ts: string, model = 'claude-opus-5-5', usage: object = {
  input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 },
}) => JSON.stringify({ type: 'assistant', timestamp: ts, sessionId: 's1', message: { id, model, usage } });

test('dedupes assistant usage by message id and buckets by day/model', () => {
  const acc = new LogAccumulator();
  acc.add(asst('m1', '2026-11-01T10:00:00.000Z'));
  acc.add(asst('m1', '2026-11-01T10:00:01.000Z')); // same message, second content block
  acc.add(asst('m2', '2026-11-01T11:00:00.000Z', 'claude-opus-5'));
  acc.add(JSON.stringify({ type: 'assistant', timestamp: '2026-11-01T11:00:00.000Z', message: { id: 'x', model: '<synthetic>', usage: { input_tokens: 5 } } }));
  const s = acc.summary();
  assert.equal(s.sessionId, 's1');
  assert.equal(s.buckets.length, 2);
  const b = s.buckets.find((x) => x.model === 'claude-opus-5-5')!;
  assert.deepEqual(
    [b.turns, b.input, b.output, b.cacheWrite5m, b.cacheWrite1h, b.cacheRead],
    [1, 10, 100, 200, 300, 1000],
  );
});

test('counts typed prompts only', () => {
  const acc = new LogAccumulator();
  const user = (content: unknown, extra = {}) => JSON.stringify({ type: 'user', timestamp: '2026-11-02T09:00:00.000Z', message: { role: 'user', content }, ...extra });
  acc.add(user('hello'));
  acc.add(user([{ type: 'text', text: 'do it' }]));
  acc.add(user([{ type: 'tool_result', tool_use_id: 't', content: 'ok' }]));
  acc.add(user('<command-name>/clear</command-name>'));
  acc.add(user('reminder', { isMeta: true }));
  acc.add(JSON.stringify({ type: 'custom-title', customTitle: 'My session' }));
  const s = acc.summary();
  assert.equal(s.prompts, 2);
  assert.equal(s.title, 'My session');
  assert.equal(s.startedAt, Date.parse('2026-11-02T09:00:00.000Z'));
});

test('falls back to cache_creation_input_tokens as 5-minute writes', () => {
  const acc = new LogAccumulator();
  acc.add(asst('m1', '2026-11-01T10:00:00.000Z', 'claude-opus-5-5', { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 400 }));
  const [b] = acc.summary().buckets;
  assert.equal(b.cacheWrite5m, 400);
  assert.equal(b.cacheWrite1h, 0);
});

test('price lookup uses the longest prefix; cost formula', () => {
  assert.equal(priceFor('claude-opus-5-5', table)?.input, 4);
  assert.equal(priceFor('claude-opus-5-20260101', table)?.input, 5);
  assert.equal(priceFor('sonnet', table), null);
  const cost = bucketCost({ day: 'd', model: 'claude-opus-5-5', turns: 1, input: 1_000_000, output: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000, cacheRead: 1_000_000 }, table);
  // 4 + 20 + 4*1.25 + 4*2 + 0.2
  assert.ok(Math.abs(cost! - 37.2) < 1e-9, `cost ${cost}`);
  assert.equal(bucketCost({ day: 'd', model: 'opus', turns: 1, input: 1, output: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }, table), null);
});

test('git branch line parsing', () => {
  assert.deepEqual(parseBranchLine('## main...origin/main [ahead 2, behind 1]'), { branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 });
  assert.deepEqual(parseBranchLine('## feature/x'), { branch: 'feature/x', upstream: null, ahead: 0, behind: 0 });
  assert.deepEqual(parseBranchLine('## main...origin/main [behind 3]'), { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 3 });
  assert.deepEqual(parseBranchLine('## HEAD (no branch)'), { branch: null, upstream: null, ahead: 0, behind: 0 });
  assert.deepEqual(parseBranchLine('## No commits yet on main'), { branch: 'main', upstream: null, ahead: 0, behind: 0 });
});
