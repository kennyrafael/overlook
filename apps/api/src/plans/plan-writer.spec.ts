import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan } from './plan-parser';
import { PlanConflictError, PlanEditError, addTask, deleteTask, setTaskStatus, setTaskText } from './plan-writer';

const F = '/p/PLAN.md';
const R = 'PLAN.md';
const ms = (md: string) => parsePlan(md, F, R);

const DOC = `# Plan

## Phase 1
- [ ] write parser
  with a wrapped line
- [x] scaffold

## Phase 2
* [ ] deploy
  * [ ] nested child

## Empty
Some text.
`;

test('setTaskStatus changes only the checkbox mark', () => {
  const t = ms(DOC)[0].tasks[0];
  const out = setTaskStatus(DOC, F, R, t.id, 'done');
  assert.equal(out, DOC.replace('- [ ] write parser', '- [x] write parser'));
  const prog = setTaskStatus(DOC, F, R, t.id, 'in_progress');
  assert.match(prog, /- \[~\] write parser/);
});

test('setTaskStatus is a no-op when unchanged', () => {
  const t = ms(DOC)[0].tasks[1];
  assert.equal(setTaskStatus(DOC, F, R, t.id, 'done'), DOC);
});

test('setTaskText folds continuation lines into one', () => {
  const t = ms(DOC)[0].tasks[0];
  const out = setTaskText(DOC, F, R, t.id, '  new\ntext ');
  assert.match(out, /^- \[ \] new text$/m);
  assert.doesNotMatch(out, /wrapped line/);
  assert.match(out, /- \[x\] scaffold/);
});

test('addTask appends with the same bullet and indent', () => {
  const [p1, p2] = ms(DOC);
  const a = addTask(DOC, F, R, p1.id, 'tests', 'todo');
  assert.match(a, /- \[x\] scaffold\n- \[ \] tests\n/);
  const b = addTask(DOC, F, R, p2.id, 'monitor', 'in_progress');
  assert.match(b, /  \* \[ \] nested child\n\* \[~\] monitor\n/);
  assert.equal(ms(b)[1].tasks.length, 3);
});

test('addTask under a heading-only milestone', () => {
  const md = `## [ ] Launch\nNotes here.\n`;
  const [m] = ms(md);
  const out = addTask(md, F, R, m.id, 'announce', 'todo');
  assert.equal(out, `## [ ] Launch\n\n- [ ] announce\n\nNotes here.\n`);
  assert.equal(ms(out)[0].tasks.length, 1);
});

test('deleteTask removes the item and its wrapped lines; refuses with children', () => {
  const [p1, p2] = ms(DOC);
  const out = deleteTask(DOC, F, R, p1.tasks[0].id);
  assert.doesNotMatch(out, /write parser|wrapped line/);
  assert.equal(ms(out)[0].tasks.length, 1);
  assert.throws(() => deleteTask(DOC, F, R, p2.tasks[0].id), PlanEditError);
  assert.match(deleteTask(DOC, F, R, p2.tasks[1].id), /\* \[ \] deploy\n\n## Empty/);
});

test('edits survive unrelated changes made elsewhere in the file', () => {
  const t = ms(DOC)[1].tasks[0];
  const edited = 'Intro paragraph added by hand.\n\n' + DOC.replace('- [x] scaffold', '- [x] scaffold\n- [ ] added by hand');
  const out = setTaskStatus(edited, F, R, t.id, 'done');
  assert.match(out, /\* \[x\] deploy/);
  assert.match(out, /Intro paragraph/);
  assert.match(out, /added by hand/);
});

test('conflict when the task text was changed elsewhere', () => {
  const t = ms(DOC)[0].tasks[1];
  const changed = DOC.replace('scaffold', 'scaffold the repo');
  assert.throws(() => setTaskStatus(changed, F, R, t.id, 'todo'), PlanConflictError);
});

test('preserves CRLF line endings', () => {
  const crlf = DOC.replace(/\n/g, '\r\n');
  const t = ms(crlf)[0].tasks[0];
  const out = setTaskStatus(crlf, F, R, t.id, 'done');
  assert.equal(out, crlf.replace('- [ ] write parser', '- [x] write parser'));
});

test('rejects empty text', () => {
  const t = ms(DOC)[0].tasks[0];
  assert.throws(() => setTaskText(DOC, F, R, t.id, '   '), PlanEditError);
});
