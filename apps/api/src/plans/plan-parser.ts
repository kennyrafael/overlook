import { createHash } from 'crypto';
import type { Milestone, Task, TaskStatus } from '@overlook/shared';

/**
 * Parses a markdown plan file into milestones.
 *
 * - A milestone is a heading with checkboxes directly under it (until the next
 *   heading of any level), or a heading explicitly marked ✅ / [x] / [ ].
 * - Reached = heading marked done, or every task under it is done.
 * - Tasks: `- [ ]` todo, `- [~]` / `- [/]` / `- [-]` in progress, `- [x]` done.
 *   Indented lines after an item that are not themselves list items are
 *   continuation lines of that item.
 * - Content inside fenced code blocks is ignored.
 */

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TASK_RE = /^(\s*)[-*+]\s+\[([ xX~/\-])\]\s+(.*)$/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_DONE_RE = /(✅|☑|✔|\[[xX]\])/;
const HEADING_OPEN_RE = /\[ \]/;

interface Section {
  level: number;
  title: string;
  rawTitle: string;
  line: number;
  lineEnd: number;
  breadcrumb: string[];
  explicit: 'done' | 'open' | null;
  tasks: Task[];
}

function statusFromMark(mark: string): TaskStatus {
  if (mark === 'x' || mark === 'X') return 'done';
  if (mark === ' ') return 'todo';
  return 'in_progress';
}

function hash(...parts: (string | number)[]): string {
  return createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12);
}

function cleanTitle(raw: string): string {
  return raw.replace(HEADING_DONE_RE, '').replace(HEADING_OPEN_RE, '').replace(/\s+/g, ' ').trim();
}

export function parsePlan(content: string, file: string, relFile: string): Milestone[] {
  const lines = content.split(/\r?\n/);
  const sections: Section[] = [];
  const stack: Section[] = []; // enclosing headings
  let current: Section | null = null;
  let inFence = false;
  let lastTask: { task: Task; indent: number } | null = null;

  const close = (lineIdx: number) => {
    if (current) current.lineEnd = Math.max(current.line, lineIdx);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      lastTask = null;
      continue;
    }
    if (inFence) continue;

    const h = HEADING_RE.exec(line);
    if (h) {
      close(lineNo - 1);
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const explicit = HEADING_DONE_RE.test(h[2]) ? 'done' : HEADING_OPEN_RE.test(h[2]) ? 'open' : null;
      current = {
        level,
        rawTitle: h[2],
        title: cleanTitle(h[2]) || h[2],
        line: lineNo,
        lineEnd: lineNo,
        breadcrumb: stack.map((s) => s.title),
        explicit,
        tasks: [],
      };
      sections.push(current);
      stack.push(current);
      lastTask = null;
      continue;
    }

    const t = TASK_RE.exec(line);
    if (t) {
      if (!current) {
        // Checkboxes before any heading: implicit section named after the file.
        current = { level: 0, rawTitle: relFile, title: relFile, line: 1, lineEnd: 1, breadcrumb: [], explicit: null, tasks: [] };
        sections.push(current);
      }
      const indent = t[1].replace(/\t/g, '  ').length;
      const task: Task = {
        id: '',
        text: t[3].trim(),
        status: statusFromMark(t[2]),
        file,
        line: lineNo,
        lineEnd: lineNo,
        depth: Math.floor(indent / 2),
      };
      current.tasks.push(task);
      lastTask = { task, indent };
      continue;
    }

    // Continuation of the previous task: indented deeper, not a new list item.
    if (lastTask && line.trim() !== '') {
      const indent = (/^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '  ').length;
      if (indent > lastTask.indent && !LIST_ITEM_RE.test(line)) {
        lastTask.task.text += ' ' + line.trim();
        lastTask.task.lineEnd = lineNo;
        continue;
      }
    }
    if (line.trim() !== '' ) lastTask = null;
  }
  close(lines.length);

  const seen = new Map<string, number>();
  const milestones: Milestone[] = [];
  for (const s of sections) {
    if (!s.tasks.length && !s.explicit) continue;
    const key = `${s.breadcrumb.join('/')}/${s.title}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const id = hash(relFile.toLowerCase(), key, n);

    const taskSeen = new Map<string, number>();
    for (const task of s.tasks) {
      const tn = taskSeen.get(task.text) ?? 0;
      taskSeen.set(task.text, tn + 1);
      task.id = hash(id, task.text, tn);
    }
    const tasksDone = s.tasks.filter((x) => x.status === 'done').length;
    const tasksInProgress = s.tasks.filter((x) => x.status === 'in_progress').length;
    const reached = s.explicit === 'done' || (s.explicit !== 'open' && s.tasks.length > 0 && tasksDone === s.tasks.length);

    milestones.push({
      id,
      title: s.title,
      reached,
      file,
      relFile,
      level: s.level,
      breadcrumb: s.breadcrumb,
      lineStart: s.line,
      lineEnd: s.lineEnd,
      tasksTotal: s.tasks.length,
      tasksDone,
      tasksInProgress,
      tasks: s.tasks,
    });
  }
  return milestones;
}

export interface PlanSummary {
  progress: number;
  milestonesTotal: number;
  milestonesReached: number;
  tasksTotal: number;
  tasksDone: number;
}

export function summarize(milestones: Milestone[]): PlanSummary {
  const milestonesTotal = milestones.length;
  const milestonesReached = milestones.filter((m) => m.reached).length;
  return {
    progress: milestonesTotal ? Math.round((milestonesReached / milestonesTotal) * 100) : 0,
    milestonesTotal,
    milestonesReached,
    tasksTotal: milestones.reduce((s, m) => s + m.tasksTotal, 0),
    tasksDone: milestones.reduce((s, m) => s + m.tasksDone, 0),
  };
}
