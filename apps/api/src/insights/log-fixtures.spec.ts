import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { parseLog, parseLogFile } from './log-parse.worker';
import { DETAIL_PROMPT_CHARS, relativeInside } from './session-detail';
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

test('tool calls and errors match a hand count (errors by tool_use id, repeats and odd blocks ignored)', async () => {
  const s = await parseLogFile(fx('tools-and-edits.jsonl'));
  assert.equal(isUnrecognized(s.format), false);
  const byName = Object.fromEntries(s.tools.map((t) => [t.name, [t.calls, t.errors]]));
  // Read ok; Edit tu_2 failed, tu_3 ok, tu_9 has a bad input (still a call); Bash failed; Write ok;
  // NotebookEdit failed (its error repeated); MultiEdit ok. The repeated tu_2 line and the result for tu_99 are ignored.
  assert.deepEqual(byName, { Read: [1, 0], Edit: [3, 1], Bash: [1, 1], Write: [1, 0], NotebookEdit: [1, 1], MultiEdit: [1, 0] });
  assert.equal(s.prompts, 3);
  assert.equal(s.title, 'Refactor parser');
  // msg_1..msg_4 and msg_6 (opus), msg_5 (haiku); the repeated msg_2 counts once.
  assert.equal(s.buckets.reduce((n, b) => n + b.turns, 0), 6);
  assert.deepEqual(s.hours.map((h) => [new Date(h.hour).toISOString(), h.model, h.turns]).sort(), [
    ['2026-10-02T10:00:00.000Z', 'claude-haiku-5-5', 1], ['2026-10-02T10:00:00.000Z', 'claude-opus-5-5', 5],
  ]);
});

test('session detail: prompts, work per prompt and edited files match a hand count', async () => {
  const d = await parseLog(fx('tools-and-edits.jsonl'), 'detail');
  assert.deepEqual(d.prompts.map((p) => p.text.slice(0, 20)), ['Refactor the parser ', 'Now add a notebook c', 'Long prompt: aaaaaaa']);
  assert.deepEqual(d.prompts.map((p) => p.truncated), [false, false, true]);
  assert.equal(d.prompts[2].text.length, DETAIL_PROMPT_CHARS + 1);
  assert.equal(d.promptsOmitted, 0);
  // The third prompt got no answer, so it has no exchange.
  assert.deepEqual(d.exchanges.map((e) => [e.prompt, e.usage.map((u) => [u.model, u.turns, u.input, u.output, u.cacheRead])]), [
    [0, [['claude-opus-5-5', 4, 25, 250, 1000]]],
    [1, [['claude-haiku-5-5', 1, 1, 20, 0], ['claude-opus-5-5', 1, 0, 0, 0]]],
  ]);
  // The failed Edit and the failed NotebookEdit changed nothing; the other parser.ts edit did.
  assert.deepEqual(d.edited.map((e) => [e.path, e.edits]).sort(), [
    ['C:\\work\\app\\src\\parser.ts', 1], ['C:\\work\\app\\test\\parser.spec.ts', 1], ['D:\\elsewhere\\x.ts', 1],
  ]);
  assert.equal(relativeInside(d.summary.cwd, 'C:\\work\\app\\src\\parser.ts'), 'src/parser.ts');
  assert.equal(relativeInside('c:/WORK/app/', 'C:\\work\\app\\test\\parser.spec.ts'), 'test/parser.spec.ts');
  assert.equal(relativeInside('/home/me/app', '/home/me/application/x.ts'), '/home/me/application/x.ts');
  assert.equal(relativeInside('C:\\work\\app', 'D:\\elsewhere\\x.ts'), 'D:\\elsewhere\\x.ts');
});

test('the index parse keeps typed prompts only', async () => {
  const r = await parseLog(fx('tools-and-edits.jsonl'), 'index');
  assert.equal(r.prompts.length, 3);
  assert.equal(r.prompts[0].text, 'Refactor the parser into smaller functions');
  assert.equal(r.prompts[0].at, Date.parse('2026-10-02T10:00:00.000Z'));
});
