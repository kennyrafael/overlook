import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan } from './plan-parser';
import { PlanConflictError, PlanEditError, addTask, deleteTask, moveTask, setTaskStatus, setTaskText } from './plan-writer';

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

const MOVE = `# Plan

## Phase 1
- [ ] write parser
  with a wrapped line
  - [x] lexer
  - [ ] grammar
    notes on the grammar
- [x] scaffold

## Phase 2
    * [ ] deploy
    * [ ] monitor

## [ ] Launch
Notes.
`;

test('moveTask (same file, down): whole block to the end of the target, in its indent and bullet', () => {
  const [p1, p2] = ms(MOVE);
  const out = moveTask({ content: MOVE, file: F, relFile: R }, p1.tasks[0].id, null, p2.id);
  assert.equal(out.target, null);
  assert.equal(out.source, `# Plan

## Phase 1
- [x] scaffold

## Phase 2
    * [ ] deploy
    * [ ] monitor
    * [ ] write parser
      with a wrapped line
      * [x] lexer
      * [ ] grammar
        notes on the grammar

## [ ] Launch
Notes.
`);
  const after = ms(out.source);
  assert.deepEqual(after[1].tasks.map((t) => [t.text, t.depth]), [
    ['deploy', 2], ['monitor', 2], ['write parser with a wrapped line', 2], ['lexer', 3], ['grammar notes on the grammar', 3],
  ]);
});

test('moveTask (same file, up) and into a heading-only milestone', () => {
  const [p1, p2, launch] = ms(MOVE);
  const up = moveTask({ content: MOVE, file: F, relFile: R }, p2.tasks[1].id, null, p1.id).source;
  assert.match(up, /- \[x\] scaffold\n- \[ \] monitor\n\n## Phase 2\n    \* \[ \] deploy\n\n## \[ \] Launch/);
  const toLaunch = moveTask({ content: MOVE, file: F, relFile: R }, p1.tasks[3].id, null, launch.id).source;
  assert.match(toLaunch, /## \[ \] Launch\n\n- \[x\] scaffold\n\nNotes\.\n$/);
  assert.equal(ms(toLaunch)[2].tasks.length, 1);
  assert.throws(() => moveTask({ content: MOVE, file: F, relFile: R }, p1.tasks[0].id, null, p1.id), PlanEditError);
});

test('moveTask across files keeps both files\' line endings and refuses stale ids', () => {
  const other = '## Backlog\r\n+ [ ] idea\r\n';
  const OF = '/p/TODO.md';
  const [p1] = ms(MOVE);
  const [backlog] = parsePlan(other, OF, 'TODO.md');
  const out = moveTask({ content: MOVE, file: F, relFile: R }, p1.tasks[1].id, { content: other, file: OF, relFile: 'TODO.md' }, backlog.id);
  // The sub-task leaves the source; it lands as a top-level "+" item in the CRLF target.
  assert.doesNotMatch(out.source, /lexer/);
  assert.equal(out.target, '## Backlog\r\n+ [ ] idea\r\n+ [x] lexer\r\n');
  assert.throws(() => moveTask({ content: MOVE.replace('lexer', 'lexer v2'), file: F, relFile: R }, p1.tasks[1].id,
    { content: other, file: OF, relFile: 'TODO.md' }, backlog.id), PlanConflictError);
  assert.throws(() => moveTask({ content: MOVE, file: F, relFile: R }, p1.tasks[1].id,
    { content: other.replace('Backlog', 'Later'), file: OF, relFile: 'TODO.md' }, backlog.id), PlanConflictError);
});

test('moveTask in a CRLF file', () => {
  const crlf = MOVE.replace(/\n/g, '\r\n');
  const [p1, p2] = ms(crlf);
  const out = moveTask({ content: crlf, file: F, relFile: R }, p1.tasks[3].id, null, p2.id).source;
  assert.equal(out, crlf.replace('- [x] scaffold\r\n', '').replace('    * [ ] monitor\r\n', '    * [ ] monitor\r\n    * [x] scaffold\r\n'));
  assert.doesNotMatch(out.replace(/\r\n/g, ''), /\n/);
});

test('rejects empty text', () => {
  const t = ms(DOC)[0].tasks[0];
  assert.throws(() => setTaskText(DOC, F, R, t.id, '   '), PlanEditError);
});
