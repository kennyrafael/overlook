import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, summarize } from './plan-parser';

const parse = (md: string) => parsePlan(md, '/p/PLAN.md', 'PLAN.md');

test('headings with checkboxes become milestones; others are skipped', () => {
  const ms = parse(`# Project
Intro text.

## Decisions
- not a task

## To-Do
### Phase 1
- [x] a
- [x] b
### Phase 2
- [ ] c
- [x] d
`);
  assert.deepEqual(ms.map((m) => m.title), ['Phase 1', 'Phase 2']);
  assert.deepEqual(ms[0].breadcrumb, ['Project', 'To-Do']);
  assert.equal(ms[0].reached, true);
  assert.equal(ms[1].reached, false);
  assert.equal(ms[1].tasksDone, 1);
  assert.equal(ms[1].tasksTotal, 2);
});

test('task statuses and wrapped continuation lines', () => {
  const [m] = parse(`## M
- [ ] first item
  continues here
- [~] doing
- [/] also doing
* [X] done
  - [ ] nested child
`);
  assert.deepEqual(m.tasks.map((t) => t.status), ['todo', 'in_progress', 'in_progress', 'done', 'todo']);
  assert.equal(m.tasks[0].text, 'first item continues here');
  assert.equal(m.tasks[0].line, 2);
  assert.equal(m.tasks[0].lineEnd, 3);
  assert.equal(m.tasks[4].depth, 1);
  assert.equal(m.tasksInProgress, 2);
});

test('explicit heading markers', () => {
  const ms = parse(`## ✅ Shipped
Some notes.
## [ ] Not started
## [x] Done with open tasks
- [ ] leftover
## [ ] Open despite done tasks
- [x] all done
`);
  assert.deepEqual(ms.map((m) => [m.title, m.reached]), [
    ['Shipped', true],
    ['Not started', false],
    ['Done with open tasks', true],
    ['Open despite done tasks', false],
  ]);
});

test('ignores code fences and computes line ranges', () => {
  const ms = parse(`## A
\`\`\`md
## Fake heading
- [ ] fake task
\`\`\`
- [x] real
## B
- [ ] b1
`);
  assert.equal(ms.length, 2);
  assert.equal(ms[0].tasks.length, 1);
  assert.equal(ms[0].lineStart, 1);
  assert.equal(ms[0].lineEnd, 6);
  assert.equal(ms[1].lineStart, 7);
});

test('checkboxes before any heading go to an implicit section', () => {
  const ms = parse(`- [x] one\n- [ ] two\n`);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].title, 'PLAN.md');
});

test('ids are stable across unrelated edits and unique for duplicates', () => {
  const a = parse(`## M\n- [ ] x\n- [ ] x\n`);
  const b = parse(`Intro added\n\n## M\n- [ ] x\n- [ ] x\n`);
  assert.equal(a[0].id, b[0].id);
  assert.deepEqual(a[0].tasks.map((t) => t.id), b[0].tasks.map((t) => t.id));
  assert.notEqual(a[0].tasks[0].id, a[0].tasks[1].id);
});

test('summary: milestone-based progress', () => {
  const s = summarize(parse(`## A\n- [x] a\n## B\n- [ ] b\n## C\n- [x] c\n- [x] c2\n`));
  assert.deepEqual(s, { progress: 67, milestonesTotal: 3, milestonesReached: 2, tasksTotal: 4, tasksDone: 3 });
  assert.equal(summarize([]).progress, 0);
});

test('CRLF line endings', () => {
  const [m] = parse('## M\r\n- [x] a\r\n- [ ] b\r\n');
  assert.equal(m.tasks.length, 2);
  assert.equal(m.tasks[1].text, 'b');
});
