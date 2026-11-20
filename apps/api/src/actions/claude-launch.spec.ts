import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_CLAUDE_TASK_PROMPT } from '@overlook/shared';
import { desktopNewSessionUrl, desktopResumePrompt, isBatchFile, MAX_PROMPT_CHARS, SESSION_ID_RE, sessionCwd, taskPrompt, windowsTerminalText } from './claude-launch';

test('task prompt fills the template on one line', () => {
  const p = taskPrompt(DEFAULT_CLAUDE_TASK_PROMPT, { task: 'Add the\nlogin page', milestone: 'Phase 2: Web', file: 'PLAN.md' });
  assert.equal(p, 'Work on this task from PLAN.md (Phase 2: Web): Add the login page');
});

test('task prompt never starts with a dash (it would be read as an option) and is bounded', () => {
  assert.equal(taskPrompt('{task}', { task: '--dangerously-skip-permissions', milestone: '', file: '' }), 'Task: --dangerously-skip-permissions');
  assert.equal(taskPrompt('{task}', { task: 'x'.repeat(5000), milestone: '', file: '' }).length, MAX_PROMPT_CHARS);
});

test('task prompt drops control characters', () => {
  assert.equal(taskPrompt('{task}', { task: 'a\u0000b\u001bc\td', milestone: '', file: '' }), 'a b c d');
});

test('Windows Terminal text has no ; (new tab) or " (re-quoting)', () => {
  assert.equal(windowsTerminalText('do a; then "b"'), "do a, then 'b'");
});

test('.cmd and .bat programs are recognised', () => {
  assert.ok(isBatchFile('C:\\npm\\claude.cmd'));
  assert.ok(isBatchFile('C:\\x\\CLAUDE.BAT'));
  assert.ok(!isBatchFile('C:\\Users\\me\\.local\\bin\\claude.exe'));
});

test('session ids must be UUIDs', () => {
  assert.ok(SESSION_ID_RE.test('3f2b9c1e-8a4d-4e2f-9b6a-1c2d3e4f5a6b'));
  for (const bad of ['', '..\\..\\x', '3f2b9c1e-8a4d-4e2f-9b6a-1c2d3e4f5a6b; rm -rf ~', '--help']) assert.ok(!SESSION_ID_RE.test(bad), bad);
});

test('session cwd is read from the first record that has one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cpd-cwd-'));
  const file = join(dir, 's.jsonl');
  writeFileSync(file, ['{"type":"summary","summary":"x"}', '{"type":"user","cwd":"/home/me/proj","message":{}}', '{"cwd":"/other"}'].join('\n'));
  assert.equal(await sessionCwd(file), '/home/me/proj');
  assert.equal(await sessionCwd(join(dir, 'missing.jsonl')), null);
});

test('desktop link: folder and prompt are URL-encoded; the prompt points at the transcript', () => {
  const p = desktopResumePrompt('/home/me/.claude/projects/x/a.jsonl');
  assert.ok(p.includes('/home/me/.claude/projects/x/a.jsonl'));
  const url = desktopNewSessionUrl('C:/code/my app', 'a&b=c #d');
  assert.equal(url, 'claude://code/new?folder=C%3A%2Fcode%2Fmy%20app&q=a%26b%3Dc%20%23d');
});
