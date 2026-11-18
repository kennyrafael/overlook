import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { parseLogFile } from './log-parse.worker';
import { isUnrecognized } from './session-log';

const fx = (name: string) => join(__dirname, '..', '..', 'test', 'fixtures', 'claude-logs', name);

test('Claude Code 1.0 log: usage without the cache_creation split, summary title', async () => {
  const s = await parseLogFile(fx('v1.0-2025.jsonl'));
  assert.equal(isUnrecognized(s.format), false);
  assert.equal(s.title, 'Fix login bug');
  assert.equal(s.prompts, 1);
  assert.equal(s.buckets.length, 1);
  const b = s.buckets[0];
  assert.deepEqual([b.turns, b.input, b.output, b.cacheWrite5m, b.cacheWrite1h, b.cacheRead], [2, 16, 60, 3000, 0, 3000]);
});

test('Claude Code 2.1 log: new record types ignored, content blocks deduped, custom title wins', async () => {
  const s = await parseLogFile(fx('v2.1-2026.jsonl'));
  assert.equal(isUnrecognized(s.format), false);
  assert.equal(s.title, 'Add tests');
  assert.equal(s.prompts, 1);
  assert.equal(s.buckets.length, 1);
  const b = s.buckets[0];
  assert.deepEqual([b.turns, b.cacheWrite5m, b.cacheWrite1h, b.cacheRead], [1, 200, 300, 1000]);
});

test('odd lines (bad JSON, wrong types, null message) are skipped without failing', async () => {
  const s = await parseLogFile(fx('truncated-and-odd.jsonl'));
  assert.equal(s.prompts, 1);
  assert.equal(s.buckets.length, 1);
  assert.deepEqual([s.buckets[0].input, s.buckets[0].output, s.buckets[0].cacheRead], [0, 0, 7]);
  assert.ok(s.format.errors >= 1);
  assert.equal(isUnrecognized(s.format), false);
});

test('a log in an unknown format is flagged, not an error', async () => {
  const s = await parseLogFile(fx('future-unknown.jsonl'));
  assert.equal(s.buckets.length, 0);
  assert.equal(isUnrecognized(s.format), true);
});

test('assistant records whose usage fields were renamed are flagged', async () => {
  const s = await parseLogFile(fx('usage-renamed.jsonl'));
  assert.equal(s.buckets.length, 0);
  assert.equal(isUnrecognized(s.format), true);
});
