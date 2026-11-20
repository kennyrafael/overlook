import type { Milestone, Task, TaskStatus } from '@overlook/shared';
import { parsePlan } from './plan-parser';

/**
 * Pure edits on plan-file text. Every edit re-parses the current content and
 * locates the task/milestone by its id, so edits made elsewhere in the file
 * since the dashboard last read it are preserved. If the target is gone, a
 * PlanConflictError is thrown and nothing is changed.
 */

export class PlanConflictError extends Error {}
export class PlanEditError extends Error {}

const TASK_LINE_RE = /^(\s*[-*+]\s+\[)([ xX~/\-])(\]\s+)(.*)$/;
const MARK: Record<TaskStatus, string> = { todo: ' ', in_progress: '~', done: 'x' };

interface Doc {
  lines: string[];
  eol: string;
  milestones: Milestone[];
}

function load(content: string, file: string, relFile: string): Doc {
  return {
    lines: content.split(/\r?\n/),
    eol: content.includes('\r\n') ? '\r\n' : '\n',
    milestones: parsePlan(content, file, relFile),
  };
}

const save = (d: Doc) => d.lines.join(d.eol);

function findTask(d: Doc, taskId: string): { task: Task; milestone: Milestone } {
  for (const m of d.milestones) {
    const task = m.tasks.find((t) => t.id === taskId);
    if (task) return { task, milestone: m };
  }
  throw new PlanConflictError('The task changed in the file since it was loaded. Reload and try again.');
}

function findMilestone(d: Doc, milestoneId: string): Milestone {
  const m = d.milestones.find((x) => x.id === milestoneId);
  if (!m) throw new PlanConflictError('The milestone changed in the file since it was loaded. Reload and try again.');
  return m;
}

export function cleanTaskText(text: unknown): string {
  if (typeof text !== 'string') throw new PlanEditError('Task text must be a string');
  const t = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) throw new PlanEditError('Task text cannot be empty');
  if (t.length > 2000) throw new PlanEditError('Task text is too long');
  return t;
}

export function setTaskStatus(content: string, file: string, relFile: string, taskId: string, status: TaskStatus): string {
  const d = load(content, file, relFile);
  const { task } = findTask(d, taskId);
  if (task.status === status) return content;
  const i = task.line - 1;
  const m = TASK_LINE_RE.exec(d.lines[i]);
  if (!m) throw new PlanConflictError('Task line not found');
  d.lines[i] = m[1] + MARK[status] + m[3] + m[4];
  return save(d);
}

/** Replaces the item's text; wrapped continuation lines are folded into the single new line. */
export function setTaskText(content: string, file: string, relFile: string, taskId: string, text: string): string {
  const clean = cleanTaskText(text);
  const d = load(content, file, relFile);
  const { task } = findTask(d, taskId);
  const i = task.line - 1;
  const m = TASK_LINE_RE.exec(d.lines[i]);
  if (!m) throw new PlanConflictError('Task line not found');
  d.lines.splice(i, task.lineEnd - task.line + 1, m[1] + m[2] + m[3] + clean);
  return save(d);
}

/** Appends a task at the end of a milestone, matching the indent and bullet of its first task. */
export function addTask(content: string, file: string, relFile: string, milestoneId: string, text: string, status: TaskStatus): string {
  const clean = cleanTaskText(text);
  const d = load(content, file, relFile);
  const ms = findMilestone(d, milestoneId);

  if (ms.tasks.length) {
    const first = TASK_LINE_RE.exec(d.lines[ms.tasks[0].line - 1]);
    const prefix = first ? first[1].replace(/\[$/, '') : '- ';
    const last = ms.tasks[ms.tasks.length - 1];
    d.lines.splice(last.lineEnd, 0, `${prefix}[${MARK[status]}] ${clean}`);
  } else {
    // Heading-only milestone: insert a list right under the heading.
    const at = ms.lineStart; // index of the line after the heading
    const insert = ['', `- [${MARK[status]}] ${clean}`];
    if (d.lines[at] !== undefined && d.lines[at].trim() !== '') insert.push('');
    d.lines.splice(at, 0, ...insert);
  }
  return save(d);
}

/** Removes a task. Refuses when it has nested sub-tasks, so they are not orphaned. */
export function deleteTask(content: string, file: string, relFile: string, taskId: string): string {
  const d = load(content, file, relFile);
  const { task, milestone } = findTask(d, taskId);
  const next = milestone.tasks[milestone.tasks.indexOf(task) + 1];
  if (next && next.depth > task.depth) {
    throw new PlanEditError('This task has sub-tasks. Delete those first.');
  }
  d.lines.splice(task.line - 1, task.lineEnd - task.line + 1);
  return save(d);
}

export interface PlanText {
  content: string;
  file: string;
  relFile: string;
}

const leading = (s: string) => /^\s*/.exec(s)![0];
const width = (ws: string) => ws.replace(/\t/g, '  ').length;

/**
 * The end (exclusive 0-based index = last 1-based line) of the item at `task`: its wrapped lines
 * and sub-tasks (already in the parse), plus deeper-indented lines right after them (notes, plain
 * sub-bullets). Stops at a blank line, a heading, or a line at the item's level or above.
 */
function blockEnd(d: Doc, milestone: Milestone, task: Task): number {
  const tasks = milestone.tasks;
  let end = task.lineEnd;
  for (let i = tasks.indexOf(task) + 1; i < tasks.length && tasks[i].depth > task.depth; i++) end = Math.max(end, tasks[i].lineEnd);
  const indent = width(leading(d.lines[task.line - 1]));
  while (end < d.lines.length && d.lines[end].trim() !== '' && width(leading(d.lines[end])) > indent
    && !/^#{1,6}\s/.test(d.lines[end].trimStart())) end++;
  return end;
}

/** Where a task block goes at the end of `ms`, and the indent and bullet it takes there. */
function insertionPoint(d: Doc, ms: Milestone): { at: number; indent: string; bullet: string; headingOnly: boolean } {
  if (!ms.tasks.length) return { at: ms.lineStart, indent: '', bullet: '-', headingOnly: true };
  const top = ms.tasks.reduce((a, t) => (t.depth < a.depth ? t : a), ms.tasks[0]);
  const m = /^(\s*)([-*+])/.exec(d.lines[top.line - 1]);
  // After the last top-level item's whole block, so the moved task does not land among its sub-tasks.
  const lastTop = [...ms.tasks].reverse().find((t) => t.depth === top.depth)!;
  return { at: blockEnd(d, ms, lastTop), indent: m?.[1] ?? '', bullet: m?.[2] ?? '-', headingOnly: false };
}

/** Re-indents a block to `indent`; items that used the moved item's bullet get `bullet`. */
function restyle(block: string[], indent: string, bullet: string): string[] {
  const base = leading(block[0]);
  const srcBullet = /^\s*([-*+])/.exec(block[0])?.[1] ?? '-';
  return block.map((line) => {
    if (line.trim() === '') return '';
    const ws = leading(line);
    const rel = ws.startsWith(base) ? ws.slice(base.length) : ws.slice(Math.min(ws.length, base.length));
    let body = line.slice(ws.length);
    if (body.startsWith(`${srcBullet} `)) body = bullet + body.slice(1);
    return indent + rel + body;
  });
}

/**
 * Moves a task with its wrapped lines and sub-tasks to the end of another milestone, in the same
 * file (`target` null) or in another one, taking the target's indent and bullet. Returns the new
 * contents (`target` null for a same-file move). Throws PlanConflictError when the task or the
 * milestone changed in the file since it was loaded.
 */
export function moveTask(source: PlanText, taskId: string, target: PlanText | null, milestoneId: string): { source: string; target: string | null } {
  const src = load(source.content, source.file, source.relFile);
  const { task, milestone } = findTask(src, taskId);
  const dst = target ? load(target.content, target.file, target.relFile) : src;
  const to = findMilestone(dst, milestoneId);
  if (!target && to.id === milestone.id) throw new PlanEditError('The task is already in that milestone');

  const from = task.line - 1;
  const end = blockEnd(src, milestone, task);
  const point = insertionPoint(dst, to);
  const block = restyle(src.lines.slice(from, end), point.indent, point.bullet);
  const insert = point.headingOnly
    ? ['', ...block, ...(dst.lines[point.at] !== undefined && dst.lines[point.at].trim() !== '' ? [''] : [])]
    : block;

  if (!target) {
    // Splice the later position first so the earlier index stays valid.
    if (point.at >= end) {
      src.lines.splice(point.at, 0, ...insert);
      src.lines.splice(from, end - from);
    } else {
      src.lines.splice(from, end - from);
      src.lines.splice(point.at, 0, ...insert);
    }
    return { source: save(src), target: null };
  }
  src.lines.splice(from, end - from);
  dst.lines.splice(point.at, 0, ...insert);
  return { source: save(src), target: save(dst) };
}
