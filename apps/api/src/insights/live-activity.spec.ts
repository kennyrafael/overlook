import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveAccumulator } from './live-activity';
import { matchTask, words } from './task-match';

let n = 0;
const ts = () => new Date(Date.UTC(2026, 10, 19, 10, 0, n++)).toISOString();
const tool = (name: string, input: object, id = `tu${n}`, stop = 'tool_use') => JSON.stringify({
  type: 'assistant', timestamp: ts(), sessionId: 's1',
  message: { id: `m${n}`, stop_reason: stop, content: [{ type: 'tool_use', id, name, input }] },
});
const prompt = (text: string) => JSON.stringify({ type: 'user', timestamp: ts(), message: { role: 'user', content: text } });
const result = (id: string, content: string) => JSON.stringify({
  type: 'user', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
});
const statuses = (a: LiveAccumulator) => a.visibleSteps().map((s) => `${s.status}:${s.text}`);

test('desktop plan tool: full list, then advance / done / start deltas', () => {
  const a = new LiveAccumulator();
  a.add(prompt('build the tray icon'));
  a.add(tool('mcp__ccd_turn__update_plan', { items: [
    { content: 'Read main.ts', status: 'in_progress' }, { content: 'Add tray', status: 'pending' }, { content: 'Test', status: 'pending' },
  ] }));
  assert.deepEqual(statuses(a), ['in_progress:Read main.ts', 'todo:Add tray', 'todo:Test']);
  a.add(tool('mcp__ccd_turn__update_plan', { advance: true }));
  assert.deepEqual(statuses(a), ['done:Read main.ts', 'in_progress:Add tray', 'todo:Test']);
  a.add(tool('mcp__ccd_turn__update_plan', { done: [2], start: 3 }));
  assert.deepEqual(statuses(a), ['done:Read main.ts', 'done:Add tray', 'in_progress:Test']);
  assert.equal(a.waiting, false);
  a.add(tool('mcp__ccd_turn__wrap_up', { recap: 'done' }));
  assert.equal(a.waiting, true);
  assert.deepEqual(statuses(a), ['done:Read main.ts', 'done:Add tray', 'done:Test']);
  a.add(prompt('thanks, next'));
  assert.equal(a.waiting, false);
  assert.deepEqual(a.prompts, ['build the tray icon', 'thanks, next']);
});

test('TodoWrite replaces the list', () => {
  const a = new LiveAccumulator();
  a.add(tool('TodoWrite', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] }));
  assert.deepEqual(statuses(a), ['done:A', 'in_progress:B']);
  a.add(tool('TodoWrite', { todos: [{ content: 'C', status: 'pending' }] }));
  assert.deepEqual(statuses(a), ['todo:C']);
});

test('TaskCreate / TaskUpdate follow task ids from the tool results', () => {
  const a = new LiveAccumulator();
  a.add(tool('TaskCreate', { subject: 'Parse logs', description: 'x' }, 'c1'));
  a.add(result('c1', 'Task #7 created successfully: Parse logs'));
  a.add(tool('TaskCreate', { subject: 'Write UI' }, 'c2'));
  a.add(result('c2', 'Task #8 created successfully: Write UI'));
  a.add(tool('TaskUpdate', { taskId: '7', status: 'in_progress' }));
  assert.deepEqual(statuses(a), ['in_progress:Parse logs', 'todo:Write UI']);
  a.add(tool('TaskUpdate', { taskId: '7', status: 'completed' }));
  a.add(tool('TaskUpdate', { taskId: '8', status: 'deleted' }));
  assert.deepEqual(statuses(a), ['done:Parse logs']);
});

test('end_turn means idle; sidechain, meta and command records are ignored; bad lines never throw', () => {
  const a = new LiveAccumulator();
  a.add(prompt('<command-name>/clear</command-name>'));
  a.add(JSON.stringify({ type: 'user', isMeta: true, timestamp: ts(), message: { content: 'meta' } }));
  a.add(JSON.stringify({ type: 'assistant', isSidechain: true, timestamp: ts(), message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'sub', status: 'pending' }] } }] } }));
  a.add('{"type":"assistant", broken');
  a.add('not json');
  a.add(JSON.stringify({ type: 'custom-title', customTitle: 'Tray work' }));
  a.add(JSON.stringify({ type: 'assistant', timestamp: ts(), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } }));
  assert.deepEqual(a.prompts, []);
  assert.deepEqual(a.visibleSteps(), []);
  assert.equal(a.title, 'Tray work');
  assert.equal(a.waiting, true);
});

const plan = [
  { id: 't1', text: 'Single-instance lock; tray icon with optional "Keep running in the tray" (Settings → Desktop app)' },
  { id: 't2', text: 'Native folder picker for root folders ("Add folders…" in Settings and setup)' },
  { id: 't3', text: 'Logs to a file in userData with rotation; "Open log folder" in Settings' },
  { id: 't4', text: 'Settings import/export (JSON) and "reset app data"' },
];

test('words: stop words, plurals and identifiers', () => {
  assert.deepEqual(words('Add the folders to `plan-parser` 42 times'), ['folder', 'plan-parser', 'time']);
});

test('suggests the one task that clearly stands out', () => {
  const m = matchTask('Can you add a tray icon so the app keeps running in the tray when closed? Single instance too.', plan);
  assert.equal(m?.taskId, 't1');
});

test('no suggestion when nothing matches or two tasks tie', () => {
  assert.equal(matchTask('Fix the spacing in the setup dialog', plan), null);
  assert.equal(matchTask('settings', plan), null);
  // Both the log-folder and the folder-picker task mention folders and Settings: too close to call.
  assert.equal(matchTask('folders in settings', plan), null);
  assert.equal(matchTask('anything', []), null);
});
