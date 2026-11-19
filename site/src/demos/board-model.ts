// The plan-file ↔ board model behind the main demo (pure). Mirrors what the app does: the Markdown
// plan is the source of truth, and moving a card changes only that task's checkbox.
import { DAYS, PROJECTS, planMarkdown, taskState, type DemoProject, type TaskState } from '../demo/data.ts';

export interface BoardTask {
  id: string;
  text: string;
  milestone: string;
  state: TaskState;
}

export interface BoardModel {
  project: DemoProject;
  tasks: BoardTask[];
}

export interface PlanLine {
  /** 1-based, like an editor. */
  n: number;
  text: string;
  taskId?: string;
  heading?: string;
}

const MARK: Record<TaskState, string> = { todo: ' ', doing: '~', done: 'x' };

export function boardModel(p: DemoProject = PROJECTS[0]): BoardModel {
  return {
    project: p,
    tasks: p.milestones.flatMap((m, mi) => m.tasks.map((t, ti) => ({ id: `${mi}.${ti}`, text: t.text, milestone: m.title, state: taskState(t, 0) }))),
  };
}

/** The plan file as it reads now (same format as data.ts planMarkdown), one entry per line. */
export function planLines(m: BoardModel): PlanLine[] {
  const out: Omit<PlanLine, 'n'>[] = [{ text: `# ${m.project.name}` }, { text: '' }, { text: `${m.project.tagline}.` }, { text: '' }];
  for (const ms of m.project.milestones) {
    out.push({ text: `## ${ms.title}`, heading: ms.title });
    for (const t of m.tasks.filter((x) => x.milestone === ms.title)) out.push({ text: `- [${MARK[t.state]}] ${t.text}`, taskId: t.id });
    out.push({ text: '' });
  }
  return out.slice(0, -1).map((l, i) => ({ ...l, n: i + 1 })); // no blank line at the end
}

export const planText = (m: BoardModel) => planLines(m).map((l) => l.text).join('\n');

/** A copy with one task moved to `state` (unknown ids leave it unchanged). */
export function moveTask(m: BoardModel, id: string, state: TaskState): BoardModel {
  return { ...m, tasks: m.tasks.map((t) => (t.id === id ? { ...t, state } : t)) };
}

export interface MilestoneProgress { title: string; done: number; total: number; reached: boolean }
export interface BoardProgress { done: number; total: number; reached: number; milestones: MilestoneProgress[] }

export function boardProgress(m: BoardModel): BoardProgress {
  const milestones = m.project.milestones.map((ms) => {
    const ts = m.tasks.filter((t) => t.milestone === ms.title);
    const done = ts.filter((t) => t.state === 'done').length;
    return { title: ms.title, done, total: ts.length, reached: done === ts.length };
  });
  return {
    done: m.tasks.filter((t) => t.state === 'done').length,
    total: m.tasks.length,
    reached: milestones.filter((x) => x.reached).length,
    milestones,
  };
}

/** Tasks done per day over the last DAYS days (oldest first); today's value comes from the board. */
export function burnup(m: BoardModel): number[] {
  const all = m.project.milestones.flatMap((ms) => ms.tasks);
  const series: number[] = [];
  for (let ago = DAYS - 1; ago >= 1; ago--) series.push(all.filter((t) => taskState(t, ago) === 'done').length);
  series.push(boardProgress(m).done);
  return series;
}

export { planMarkdown };
