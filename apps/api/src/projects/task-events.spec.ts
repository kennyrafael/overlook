import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan } from '../plans/plan-parser';
import { completes, diffTasks, netMoves, taskStates, type TaskState } from './task-events';

const read = (md: string, rel = 'PLAN.md') => taskStates(parsePlan(md, `/p/${rel}`, rel));

const PLAN = `# P
## Phase 1
- [x] scaffold
- [ ] parser
## Phase 2
- [ ] deploy
`;

test('a status change is one event with from and to', () => {
  const before = read(PLAN);
  const after = read(PLAN.replace('- [ ] parser', '- [x] parser').replace('- [ ] deploy', '- [~] deploy'));
  assert.deepEqual(diffTasks(before, after), [
    { file: 'PLAN.md', text: 'parser', from: 'todo', to: 'done' },
    { file: 'PLAN.md', text: 'deploy', from: 'todo', to: 'in_progress' },
  ]);
});

test('unchanged plans, moved lines and re-wrapped text give no events', () => {
  const before = read(PLAN);
  assert.deepEqual(diffTasks(before, read(PLAN)), []);
  const moved = `# P\n## Phase 2\n- [ ] deploy\n## Phase 1\n- [ ] parser\n- [x] scaffold\n`;
  assert.deepEqual(diffTasks(before, read(moved)), []);
  const spaced = [{ file: 'PLAN.md', text: 'parser', status: 'todo' }] as TaskState[];
  assert.deepEqual(diffTasks(spaced, taskStates([{ relFile: 'PLAN.md', tasks: [{ text: '  parser ', status: 'todo' }] } as never])), []);
});

test('a rename is a removal plus an addition', () => {
  const before = read(PLAN);
  const after = read(PLAN.replace('- [ ] parser', '- [ ] markdown parser'));
  assert.deepEqual(diffTasks(before, after), [
    { file: 'PLAN.md', text: 'parser', from: 'todo', to: null },
    { file: 'PLAN.md', text: 'markdown parser', from: null, to: 'todo' },
  ]);
});

test('the same text in another plan file is another task', () => {
  const before = [...read(PLAN), ...read('# T\n## Next\n- [ ] parser\n', 'TODO.md')];
  const after = [...read(PLAN), ...read('# T\n## Next\n- [x] parser\n', 'TODO.md')];
  assert.deepEqual(diffTasks(before, after), [{ file: 'TODO.md', text: 'parser', from: 'todo', to: 'done' }]);
});

test('duplicate texts are paired in order; an extra copy is an addition', () => {
  const two = read('# P\n## A\n- [ ] test\n- [ ] test\n');
  const three = read('# P\n## A\n- [ ] test\n- [x] test\n- [ ] test\n');
  assert.deepEqual(diffTasks(two, three), [
    { file: 'PLAN.md', text: 'test', from: 'todo', to: 'done' },
    { file: 'PLAN.md', text: 'test', from: null, to: 'todo' },
  ]);
});

test('the first read has nothing to compare with (the service stores it without events)', () => {
  // TaskEventsService only diffs when a previous state exists; an empty previous list is a real state.
  assert.deepEqual(diffTasks([], []), []);
  assert.equal(diffTasks([], read(PLAN)).every((e) => e.from === null), true);
});

test('completes counts only real status changes to done', () => {
  assert.equal(completes({ from: 'todo', to: 'done' }), true);
  assert.equal(completes({ from: 'in_progress', to: 'done' }), true);
  assert.equal(completes({ from: null, to: 'done' }), false); // added ticked, or renamed
  assert.equal(completes({ from: 'done', to: null }), false);
});

test('netMoves keeps one net move per task and drops round trips', () => {
  const e = (taskText: string, from: string | null, to: string | null, at: string) => ({ file: 'PLAN.md', taskText, from, to, at });
  const moves = netMoves([
    e('a', 'todo', 'in_progress', '2026-01-01T10:00:00.000Z'),
    e('a', 'in_progress', 'done', '2026-01-02T10:00:00.000Z'),
    e('b', 'todo', 'done', '2026-01-01T11:00:00.000Z'),
    e('b', 'done', 'todo', '2026-01-01T12:00:00.000Z'),
    e('c', null, 'todo', '2026-01-01T12:00:00.000Z'),
  ]);
  assert.deepEqual(moves, [{ file: 'PLAN.md', taskText: 'a', from: 'todo', to: 'done', at: '2026-01-02T10:00:00.000Z' }]);
});

/** Just enough of a TypeORM repository for TaskEventsService.observe(). */
function memoryRepo<T extends object>() {
  const rows: T[] = [];
  return {
    rows,
    create: (x: T) => ({ ...x }),
    find: async () => rows.slice(),
    save: async (x: T | T[]) => { rows.push(...(Array.isArray(x) ? x : [x])); return x; },
  };
}

test('the service records nothing on the first read, then each change once, tagged by source', async () => {
  const { TaskEventsService } = await import('./task-events.service');
  const events = memoryRepo<{ taskText: string; from: string | null; to: string | null; source: string }>();
  const states = memoryRepo<{ projectId: string; tasks: string }>();
  const svc = new TaskEventsService(events as never, states as never);
  const ms = (md: string) => parsePlan(md, '/p/PLAN.md', 'PLAN.md');

  await svc.observe([{ projectId: 'p1', milestones: ms(PLAN) }]);
  assert.equal(events.rows.length, 0, 'first read is not a change');
  assert.equal(states.rows.length, 1);

  await svc.observe([{ projectId: 'p1', milestones: ms(PLAN) }]);
  assert.equal(events.rows.length, 0, 'same plan again');

  await svc.asDashboardWrite('p1', () => svc.observe([{ projectId: 'p1', milestones: ms(PLAN.replace('- [ ] parser', '- [x] parser')) }]));
  assert.deepEqual(events.rows.map((e) => [e.taskText, e.from, e.to, e.source]), [['parser', 'todo', 'done', 'dashboard']]);

  // An empty read (file mid-save) keeps the old list instead of recording every task as removed.
  await svc.observe([{ projectId: 'p1', milestones: [] }]);
  assert.equal(events.rows.length, 1);
  await svc.observe([{ projectId: 'p1', milestones: ms(PLAN) }]);
  assert.deepEqual(events.rows.slice(1).map((e) => [e.taskText, e.from, e.to, e.source]), [['parser', 'done', 'todo', 'file']]);

  // A new service (app restart) starts from the stored list: an edit made while closed is still found.
  const restarted = new TaskEventsService(events as never, states as never);
  await restarted.observe([{ projectId: 'p1', milestones: ms(PLAN.replace('- [ ] deploy', '- [x] deploy')) }]);
  assert.deepEqual(events.rows.slice(2).map((e) => [e.taskText, e.from, e.to]), [['deploy', 'todo', 'done']]);
});
