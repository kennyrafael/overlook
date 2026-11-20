import type { Milestone, TaskMove, TaskStatus } from '@overlook/shared';

/** A task as remembered between two reads: its plan file (relative), text and status. */
export interface TaskState {
  file: string;
  text: string;
  status: TaskStatus;
}

export interface TaskChange {
  file: string;
  text: string;
  from: TaskStatus | null;
  to: TaskStatus | null;
}

/** Whitespace-normalized, so re-wrapping a line is not a rename. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The tasks of a parsed project, in file order. */
export function taskStates(milestones: Milestone[]): TaskState[] {
  return milestones.flatMap((m) => m.tasks.map((t) => ({ file: m.relFile, text: norm(t.text), status: t.status })));
}

/**
 * What changed between two reads. Tasks are matched by plan file + text; tasks with the same text in the
 * same file are paired in order. A changed text cannot be told apart from a delete plus an add, so a rename
 * is reported as both (to: null, then from: null).
 */
export function diffTasks(prev: TaskState[], next: TaskState[]): TaskChange[] {
  const key = (t: TaskState) => `${t.file}\u0000${t.text}`;
  const group = (list: TaskState[]) => {
    const m = new Map<string, TaskState[]>();
    for (const t of list) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
    return m;
  };
  const before = group(prev);
  const after = group(next);
  const out: TaskChange[] = [];
  for (const [k, olds] of before) {
    const news = after.get(k) ?? [];
    olds.forEach((o, i) => {
      const n = news[i];
      if (!n) out.push({ file: o.file, text: o.text, from: o.status, to: null });
      else if (n.status !== o.status) out.push({ file: o.file, text: o.text, from: o.status, to: n.status });
    });
  }
  for (const [k, news] of after) {
    const count = before.get(k)?.length ?? 0;
    for (const n of news.slice(count)) out.push({ file: n.file, text: n.text, from: null, to: n.status });
  }
  return out;
}

/** A status change that finished a task (adding a task already ticked is not counted). */
export const completes = (e: { from: string | null; to: string | null }) => e.to === 'done' && e.from !== null && e.from !== 'done';

/**
 * Collapses a range of events (oldest first) into one net move per task: first `from`, last `to`.
 * Tasks that ended where they started, or that were only added or removed, are left out.
 */
export function netMoves(events: { file: string; taskText: string; from: string | null; to: string | null; at: string }[]): TaskMove[] {
  const byTask = new Map<string, TaskMove>();
  for (const e of events) {
    if (e.from === null || e.to === null) continue;
    const k = `${e.file}\u0000${e.taskText}`;
    const m = byTask.get(k);
    if (m) { m.to = e.to as TaskStatus; m.at = e.at; } else byTask.set(k, { file: e.file, taskText: e.taskText, from: e.from as TaskStatus, to: e.to as TaskStatus, at: e.at });
  }
  return [...byTask.values()].filter((m) => m.from !== m.to).sort((a, b) => b.at.localeCompare(a.at));
}
