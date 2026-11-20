import type { PlanWarning, PlanWarningKind } from '@overlook/shared';
import { FENCE_RE, HEADING_DONE_RE, HEADING_RE, TASK_RE, cleanTitle, parsePlan, splitDue } from './plan-parser';

/**
 * Plan health: finds mistakes that make a plan file parse differently than its author meant.
 * Pure (text in, warnings out) so it can run on every read; each warning says what to change.
 */

export type LintWarning = Pick<PlanWarning, 'kind' | 'line' | 'message' | 'fix'>;

/**
 * Above this size a plan file gets a warning. Every board edit re-reads, re-parses and backs up
 * the whole file (20 copies are kept) and the watcher re-parses it on each save; hand-written
 * plans rarely pass 100 KB, so 512 KB usually means pasted logs or generated output.
 */
export const PLAN_SIZE_WARN_BYTES = 512 * 1024;
/** Above this size plan files are not read at all (see PlansService). */
export const PLAN_SIZE_MAX_BYTES = 2 * 1024 * 1024;

const MARKS = new Set([' ', 'x', 'X', '~', '/', '-']);
/** Something bracketed near the start of a line: a checkbox, maybe a broken one. */
const BOXISH_RE = /^(\s*)([-*+]|\d+[.)])?(\s*)\[([^\]]{0,3})\](.*)$/;
/** Done markers people use that the parser does not read (it reads ✅ ☑ ✔ [x]). */
const DONE_LOOKALIKE_RE = /✓|☒|🗸|\((?:done|complete|completed|finished)\)|\[(?:done|complete|completed)\]|\[\s+[xX]\s*\]|\[[xX]\s+\]/i;
const OPEN_LOOKALIKE_RE = /\[\]|\[\s{2,}\]/;

const short = (s: string, n = 50) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

/** The size warning for a plan file of `bytes` bytes, if any. */
export function sizeWarning(bytes: number): LintWarning | null {
  if (bytes > PLAN_SIZE_MAX_BYTES) {
    return {
      kind: 'file-too-large', line: 0,
      message: `This file is ${kb(bytes)}, over the 2 MB limit, so it is not read at all: none of its milestones appear.`,
      fix: 'Move finished phases, notes or pasted output into another file (for example docs/HISTORY.md) so the plan is under 512 KB.',
    };
  }
  if (bytes > PLAN_SIZE_WARN_BYTES) {
    return {
      kind: 'file-too-large', line: 0,
      message: `This file is ${kb(bytes)}. Every board edit re-reads and backs up the whole file, and over 2 MB it is skipped.`,
      fix: 'Move finished phases, notes or pasted output into another file (for example docs/HISTORY.md) so the plan is under 512 KB.',
    };
  }
  return null;
}

/** Checks a line that is not a valid task for a checkbox that almost is one. */
function lintBoxish(line: string): { message: string; fix: string } | null {
  const m = BOXISH_RE.exec(line);
  if (!m) return null;
  const [, indent, bullet, gap, inner, rest] = m;
  // Markdown links and references: [text](url), [text][ref], [ref]: url.
  if (/^[([:]/.test(rest)) return null;
  const mark = inner.trim().length === 1 ? inner.trim() : inner === '' || inner.trim() === '' ? ' ' : null;
  const lookalikeMark = inner.trim().length === 1 && /[^\p{L}\p{N}]|[oOvV]/u.test(inner.trim());
  if (mark === null) return null;
  const text = rest.trim();
  const suggested = `${indent}- [${MARKS.has(mark) ? mark : 'x'}] ${short(text || 'task text')}`;
  const fix = `Change it to \`${suggested.trim()}\`.`;

  if (!bullet) {
    // Without a bullet only exact marks count; "[1] footnote" or "[a] option" are not tasks.
    if (!MARKS.has(inner) || !text) return null;
    return { message: 'A checkbox without a list bullet is not read as a task.', fix: `Start the line with "- ". ${fix}` };
  }
  if (/\d/.test(bullet)) {
    if (!MARKS.has(mark)) return null;
    return { message: 'Numbered items are not read as tasks; only "-", "*" and "+" bullets are.', fix };
  }
  if (!MARKS.has(mark)) {
    if (!lookalikeMark) return null;
    return { message: `"[${inner}]" is not a checkbox mark the dashboard reads ([ ] to do, [~] [/] [-] in progress, [x] done).`, fix };
  }
  if (gap === '') return { message: 'There is no space between the bullet and the checkbox, so this is not read as a task.', fix };
  if (inner === '') return { message: '"[]" is not read as a checkbox: it needs a space or a mark inside.', fix };
  if (inner.length !== 1) return { message: `"[${inner}]" has extra spaces inside the brackets, so this is not read as a task.`, fix };
  if (!text) return { message: 'This checkbox has no text, so it is not read as a task.', fix: 'Add the task text after the checkbox, or delete the line.' };
  return { message: 'There is no space after the checkbox, so this is not read as a task.', fix };
}

/** Checks a heading for done/open markers and due dates the parser does not read. */
function lintHeading(title: string): { message: string; fix: string } | null {
  const cleaned = cleanTitle(title) || title;
  if (!HEADING_DONE_RE.test(title)) {
    const done = DONE_LOOKALIKE_RE.exec(title);
    if (done) {
      return {
        message: `This heading looks marked as reached ("${done[0]}"), but only ✅, ☑, ✔ or [x] mark a milestone reached.`,
        fix: `Replace "${done[0]}" with ✅.`,
      };
    }
  }
  const open = OPEN_LOOKALIKE_RE.exec(title);
  if (open) return { message: `"${open[0]}" in a heading is not read as an open milestone marker.`, fix: `Replace "${open[0]}" with "[ ]".` };
  if (/\(\s*due\b/i.test(cleaned) && !splitDue(cleaned).due) {
    return {
      message: 'This heading has a due date the dashboard cannot read, so it is shown as part of the title.',
      fix: 'Write it as "(due YYYY-MM-DD)" with a real date, at the very end of the heading, e.g. "## Phase 2 (due 2026-12-15)".',
    };
  }
  return null;
}

/**
 * Lints one plan file's text. `relFile` names the file in messages. Warnings are sorted by line;
 * a size warning (line 0) comes first.
 */
export function lintPlan(content: string, relFile: string): LintWarning[] {
  const out: LintWarning[] = [];
  const add = (kind: PlanWarningKind, line: number, w: { message: string; fix: string }) => out.push({ kind, line, ...w });

  const size = sizeWarning(Buffer.byteLength(content, 'utf8'));
  if (size) out.push(size);
  if (Buffer.byteLength(content, 'utf8') > PLAN_SIZE_MAX_BYTES) return out;

  const lines = content.split(/\r?\n/);
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE_RE.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const h = HEADING_RE.exec(line);
    if (h) {
      const w = lintHeading(h[2]);
      if (w) add('malformed-heading', i + 1, w);
      return;
    }
    if (/^#{2,6}[^#\s]/.test(line)) {
      const level = /^#+/.exec(line)![0];
      add('malformed-heading', i + 1, {
        message: 'There is no space after the #, so this is not read as a heading (its tasks count under the heading above).',
        fix: `Change it to "${level} ${short(line.slice(level.length).trim())}".`,
      });
      return;
    }
    if (TASK_RE.test(line)) return;
    const w = lintBoxish(line);
    if (w) add('malformed-task', i + 1, w);
  });

  const milestones = parsePlan(content, relFile, relFile);
  const loose = milestones.find((m) => m.level === 0);
  if (loose) {
    const first = loose.tasks[0].line;
    const n = loose.tasks.length;
    add('task-outside-milestone', first, {
      message: `${n === 1 ? '1 task comes' : `${n} tasks come`} before the first heading, so ${n === 1 ? 'it is' : 'they are'} grouped under a milestone named after the file.`,
      fix: `Add a heading such as "## Backlog" above line ${first}.`,
    });
  }

  const firstLine = new Map<string, number>();
  for (const t of milestones.flatMap((m) => m.tasks).sort((a, b) => a.line - b.line)) {
    const prev = firstLine.get(t.text);
    if (prev === undefined) { firstLine.set(t.text, t.line); continue; }
    add('duplicate-task', t.line, {
      message: `"${short(t.text)}" is also on line ${prev}. Edits find a task by its text, so with two the wrong one can be changed after the file is edited elsewhere.`,
      fix: 'Make each task\'s text unique, for example by adding a detail, or delete the copy.',
    });
  }

  return out.sort((a, b) => a.line - b.line);
}
