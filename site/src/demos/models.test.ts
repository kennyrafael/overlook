import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAYS, PROJECTS, planMarkdown, sessions } from '../demo/data.ts';
import { boardModel, boardProgress, burnup, moveTask, planLines, planText } from './board-model.ts';
import { heatmap, levels, repos } from './git-model.ts';
import { fuzzyScore, rank } from './palette-model.ts';
import { summarize, turnCost } from './usage-model.ts';

test('the board starts from the same plan file the screenshots use', () => {
  for (const p of PROJECTS) assert.equal(planText(boardModel(p)), planMarkdown(p, 0).replace(/\n$/, ''));
});

test('moving a card changes only its checkbox line', () => {
  const m = boardModel(PROJECTS[0]);
  const before = planLines(m);
  const task = m.tasks.find((t) => t.state === 'todo')!;
  const after = planLines(moveTask(m, task.id, 'done'));
  const changed = after.filter((l, i) => l.text !== before[i].text);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].text, `- [x] ${task.text}`);
  assert.equal(changed[0].taskId, task.id);
  assert.equal(planLines(moveTask(m, task.id, 'doing')).find((l) => l.taskId === task.id)!.text, `- [~] ${task.text}`);
  assert.deepEqual(moveTask(m, 'nope', 'done').tasks, m.tasks);
});

test('progress and milestones follow the board', () => {
  let m = boardModel(PROJECTS[0]);
  assert.deepEqual([boardProgress(m).done, boardProgress(m).total, boardProgress(m).reached], [7, 12, 1]);
  for (const t of m.tasks.filter((x) => x.milestone === 'Phase 2: Offline packs')) m = moveTask(m, t.id, 'done');
  const p = boardProgress(m);
  assert.equal(p.reached, 2);
  assert.equal(p.done, 9);
  const b = burnup(m);
  assert.equal(b.length, DAYS);
  assert.equal(b[b.length - 1], 9);
  assert.ok(b.every((v, i) => i === 0 || v >= b[i - 1]), 'burnup never drops in history');
});

test('usage: costs add up and filters narrow them', () => {
  const all = summarize({ days: 30 });
  const byDay = all.days.reduce((a, d) => a + d.total, 0);
  assert.ok(Math.abs(byDay - all.cost) < 1e-9);
  assert.ok(Math.abs(all.byProject.reduce((a, p) => a + p.cost, 0) - all.cost) < 1e-9);
  assert.equal(all.days.length, 30);
  assert.ok(all.sessions > 0 && all.cost > 0);
  const one = summarize({ days: 30, project: 'trailmap' });
  assert.ok(one.cost < all.cost && one.cost > 0);
  const opus = summarize({ days: 30, models: new Set(['claude-opus-5-5'] as const) });
  assert.ok(opus.days.every((d) => d.cost['claude-sonnet-5-5'] === 0 && d.cost['claude-haiku-5-5'] === 0));
  // A turn's price: 1M output tokens of Opus 5.5 = $20.
  assert.equal(turnCost({ model: 'claude-opus-5-5', input: 0, output: 1e6, cacheRead: 0, cacheWrite: 0 }), 20);
  // Quiet projects have no recent sessions.
  assert.ok(sessions().filter((s) => s.project === 'pocket-ledger').every((s) => s.daysAgo >= 23));
});

test('heatmap: levels, layout and per-project counts', () => {
  assert.deepEqual(levels([0, 1, 2, 3, 4, 0]), [0, 1, 2, 3, 4, 0]);
  const today = new Date(2026, 10, 19); // a Thursday
  const cells = heatmap(undefined, today);
  assert.equal(cells.length, DAYS);
  const last = cells[cells.length - 1];
  assert.equal(last.daysAgo, 0);
  assert.equal(last.row, 3, 'Thursday');
  const lastCol = Math.max(...cells.map((c) => c.col));
  assert.equal(last.col, lastCol);
  assert.equal(Math.min(...cells.map((c) => c.col)), 0);
  const seen = new Set(cells.map((c) => `${c.col}:${c.row}`));
  assert.equal(seen.size, DAYS, 'no two days share a cell');
  for (const c of cells) assert.equal(c.count, c.byProject.reduce((a, p) => a + p.count, 0));
  const r = repos();
  assert.equal(r.find((x) => x.project === 'trailmap')!.unpushed, 2);
});

test('palette: in-order matching with sensible ranking', () => {
  assert.equal(fuzzyScore('xyz', 'Plans become a board'), null);
  assert.ok(fuzzyScore('board', 'Plans become a board')! > fuzzyScore('board', 'Brand of a road')!);
  const items = ['Go to: Git at a glance', 'trailmap: Start Claude Code', 'Download for Windows'];
  assert.deepEqual(rank(items, 'trail', (s) => s), ['trailmap: Start Claude Code']);
  assert.deepEqual(rank(items, '', (s) => s), items);
  assert.equal(rank(items, 'dl win', (s) => s)[0], 'Download for Windows');
});
