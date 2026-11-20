import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranches, parseCommits, parseMerged, parseWorktrees } from './git-branches';
import { dayEnd, dayStart, overlapMs } from './daily.service';

const NOW = Date.parse('2026-11-20T12:00:00Z');

test('branches: upstream tracking, gone upstreams, stale and merged flags', () => {
  const out = [
    'main\t*\torigin/main\t[ahead 2, behind 1]\t2026-11-19T10:00:00+01:00\tFix the parser',
    'old-spike\t \t\t\t2026-09-01T10:00:00Z\tTry\ta tab',
    'feature\t \torigin/feature\t[gone]\t2026-11-18T10:00:00Z\tWIP',
    'merged-old\t \torigin/merged-old\t\t2026-08-01T10:00:00Z\tDone',
    '',
  ].join('\n');
  const b = parseBranches(out, parseMerged('main\nmerged-old\n(HEAD detached at abc123)\n'), NOW);
  assert.deepEqual(b.map((x) => x.name), ['main', 'feature', 'old-spike', 'merged-old']);
  const [main, feature, spike, merged] = b;
  assert.deepEqual([main.current, main.ahead, main.behind, main.upstream, main.merged, main.stale], [true, 2, 1, 'origin/main', false, false]);
  assert.equal(main.lastCommitAt, '2026-11-19T09:00:00.000Z');
  assert.deepEqual([feature.upstreamGone, feature.ahead, feature.stale], [true, 0, false]);
  assert.deepEqual([spike.upstream, spike.stale, spike.merged, spike.lastCommitSubject], [null, true, false, 'Try\ta tab']);
  assert.deepEqual([merged.stale, merged.merged], [true, true]);
});

test('worktrees: main first, branch names without refs/heads, flags', () => {
  const out = [
    'worktree C:/code/app', 'HEAD 1111111111111111111111111111111111111111', 'branch refs/heads/main', '',
    'worktree C:/code/app/.claude/worktrees/agent-1', 'HEAD 2222222222222222222222222222222222222222', 'detached', 'locked claude agent', '',
    'worktree C:/tmp/gone', 'HEAD 3333333333333333333333333333333333333333', 'branch refs/heads/fix/x', 'prunable gitdir file points to non-existent location', '',
  ].join('\r\n');
  const w = parseWorktrees(out);
  assert.equal(w.length, 3);
  assert.deepEqual([w[0].main, w[0].branch, w[0].path], [true, 'main', 'C:/code/app']);
  assert.deepEqual([w[1].main, w[1].detached, w[1].locked, w[1].branch], [false, true, true, null]);
  assert.deepEqual([w[2].branch, w[2].prunable], ['fix/x', true]);
});

test('commits: hash, ISO date and subjects with tabs', () => {
  const c = parseCommits('abc\t2026-11-19T10:00:00+01:00\tAdd\tthing\n\n', 'sub');
  assert.deepEqual(c, [{ hash: 'abc', at: '2026-11-19T09:00:00.000Z', subject: 'Add\tthing', repo: 'sub' }]);
});

test('summary ranges are local days; session time is clipped to them', () => {
  assert.equal(Date.parse(dayEnd('2026-11-16')) - Date.parse(dayStart('2026-11-16')) >= 23 * 3_600_000, true);
  assert.equal(dayEnd('2026-11-16'), dayStart('2026-11-17'));
  const from = '2026-11-16T00:00:00.000Z';
  const to = '2026-11-23T00:00:00.000Z';
  assert.equal(overlapMs('2026-11-17T10:00:00Z', '2026-11-17T11:30:00Z', from, to), 90 * 60_000);
  assert.equal(overlapMs('2026-11-15T23:00:00Z', '2026-11-16T01:00:00Z', from, to), 60 * 60_000);
  assert.equal(overlapMs('2026-11-10T10:00:00Z', '2026-11-11T10:00:00Z', from, to), 0);
});
