import assert from 'node:assert/strict';
import { test } from 'node:test';
import { macClaudeArgs } from './actions.service';

const evil = `/Users/me/it's "quoted" $(rm -rf ~); x`;

for (const iterm of [false, true]) {
  test(`macOS ${iterm ? 'iTerm' : 'Terminal'}: the folder and program are AppleScript arguments, not script text`, () => {
    const args = macClaudeArgs(evil, '/opt/homebrew/bin/claude', iterm);
    // Every script line is an -e pair; the two values come last, unchanged.
    assert.deepEqual(args.slice(-2), [evil, '/opt/homebrew/bin/claude']);
    const script = args.slice(0, -2);
    for (let i = 0; i < script.length; i += 2) assert.equal(script[i], '-e');
    const text = script.filter((_, i) => i % 2 === 1).join('\n');
    assert.ok(!text.includes(evil) && !text.includes('claude'));
    assert.match(text, /quoted form of \(item 1 of argv\)/);
    assert.match(text, /quoted form of \(item 2 of argv\)/);
    assert.match(text, iterm ? /tell application "iTerm"/ : /tell application "Terminal"/);
  });
}
