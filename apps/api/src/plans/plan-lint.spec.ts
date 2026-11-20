import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_SIZE_WARN_BYTES, lintPlan, sizeWarning } from './plan-lint';
import { lineRanges, parseBlamePorcelain } from './git-blame';

const lint = (md: string) => lintPlan(md, 'PLAN.md');
const kinds = (md: string) => lint(md).map((w) => `${w.kind}@${w.line}`);

test('a clean plan has no warnings', () => {
  assert.deepEqual(lint(`# Plan

Intro with a [link](https://example.com) and [ref][1].

## ✅ Research
## [ ] Launch
## Phase 1 (due 2026-12-15)
- [x] scaffold
- [~] api
  wrapped line
  - [ ] child
* [/] other bullet
+ [-] third bullet

[1]: https://example.com

\`\`\`md
-[ ] inside a fence is fine
## ✓ also fine
\`\`\`
`), []);
});

test('checkboxes before the first heading', () => {
  const w = lint(`- [ ] loose one\n- [ ] loose two\n\n## M\n- [ ] inside\n`);
  assert.deepEqual(w.map((x) => [x.kind, x.line]), [['task-outside-milestone', 1]]);
  assert.match(w[0].message, /2 tasks come before the first heading/);
  assert.match(w[0].fix, /above line 1/);
});

test('duplicate task text in one file, also across milestones', () => {
  const w = lint(`## A\n- [ ] write docs\n- [ ] other\n\n## B\n- [x] write docs\n`);
  assert.deepEqual(w.map((x) => [x.kind, x.line]), [['duplicate-task', 6]]);
  assert.match(w[0].message, /also on line 2/);
});

test('checkboxes that almost parse', () => {
  const md = `## M
-[ ] no space after bullet
- [] empty brackets
* [X ] extra space
- [ x] leading space
[x] no bullet
1. [ ] numbered
- [?] unknown mark
- [x]no space after
- [ ]
- [a] a label, not a task
[1] a footnote
- [link](https://example.com)
`;
  assert.deepEqual(kinds(md), [2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => `malformed-task@${l}`));
  const byLine = new Map(lint(md).map((w) => [w.line, w]));
  assert.match(byLine.get(2)!.fix, /`- \[ \] no space after bullet`/);
  assert.match(byLine.get(4)!.fix, /`- \[X\] extra space`/);
  assert.match(byLine.get(6)!.fix, /Start the line with "- "/);
  assert.match(byLine.get(8)!.message, /not a checkbox mark/);
});

test('headings that look like milestones but are not read as one', () => {
  const md = `##Phase 1
- [ ] a
## ✓ Phase 2
- [ ] b
## Phase 3 (done)
## [] Phase 4
## Phase 5 (due 2026-13-01)
- [ ] c
## Phase 6 (due: 2026-12-01)
- [ ] d
## ✔ Recognised
`;
  // The task under "##Phase 1" has no heading at all, so it is also outside a milestone.
  assert.deepEqual(kinds(md), ['malformed-heading@1', 'task-outside-milestone@2', ...[3, 5, 6, 7, 9].map((l) => `malformed-heading@${l}`)]);
  const w = lint(md).filter((x) => x.kind === 'malformed-heading');
  assert.match(w[0].fix, /"## Phase 1"/);
  assert.match(w[1].fix, /Replace "✓" with ✅/);
  assert.match(w[4].fix, /\(due YYYY-MM-DD\)/);
});

test('size limits', () => {
  assert.equal(sizeWarning(PLAN_SIZE_WARN_BYTES), null);
  assert.equal(sizeWarning(PLAN_SIZE_WARN_BYTES + 1)!.kind, 'file-too-large');
  assert.match(sizeWarning(3 * 1024 * 1024)!.message, /not read at all/);
  const big = `## M\n- [ ] a\n${'x'.repeat(PLAN_SIZE_WARN_BYTES)}\n`;
  assert.deepEqual(kinds(big), ['file-too-large@0']);
});

test('CRLF files lint the same', () => {
  const md = `- [ ] loose\n## M\n-[ ] broken\n- [ ] dup\n- [ ] dup\n`;
  assert.deepEqual(kinds(md.replace(/\n/g, '\r\n')), kinds(md));
});

test('git blame porcelain: author time per final line, uncommitted lines are null', () => {
  const sha = 'a'.repeat(40);
  const out = [
    `${sha} 3 5 1`, 'author Someone', 'author-time 1700000000', 'author-tz +0000', 'summary x', 'filename PLAN.md', '\t- [~] old',
    `${'0'.repeat(40)} 9 9 1`, 'author Not Committed Yet', 'author-time 1800000000', 'filename PLAN.md', '\t- [~] new',
    `${sha} 4 12`, '\t- [~] same commit again',
  ].join('\n');
  const m = parseBlamePorcelain(out);
  assert.equal(m.get(5), new Date(1700000000 * 1000).toISOString());
  assert.equal(m.get(9), null);
  assert.equal(m.get(12), m.get(5));
  assert.deepEqual(lineRanges([9, 3, 4, 5, 3, 12]), ['-L', '3,5', '-L', '9,9', '-L', '12,12']);
});
