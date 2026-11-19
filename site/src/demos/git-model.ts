// The 90-day commit heatmap for the demo (pure): commits per day summed over projects, laid out in
// week columns (Monday on top) ending today, with five intensity levels like the app.
import { commitsByDay, DAYS, PROJECTS } from '../demo/data.ts';

export interface HeatCell {
  daysAgo: number;
  date: Date;
  row: number; // 0 = Monday
  col: number;
  count: number;
  byProject: { project: string; count: number }[];
  level: 0 | 1 | 2 | 3 | 4;
}

/** Level 0 for none, then 1–4 by quartiles of the non-zero days. */
export function levels(counts: number[]): (0 | 1 | 2 | 3 | 4)[] {
  const nz = counts.filter((c) => c > 0).sort((a, b) => a - b);
  const q = (f: number) => nz[Math.floor(f * (nz.length - 1))] ?? 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  return counts.map((c) => (c <= 0 ? 0 : c <= q1 ? 1 : c <= q2 ? 2 : c <= q3 ? 3 : 4));
}

export function heatmap(projects: string[] = PROJECTS.map((p) => p.name), today = new Date()): HeatCell[] {
  const per = PROJECTS.filter((p) => projects.includes(p.name)).map((p) => ({ name: p.name, days: commitsByDay(p) }));
  const counts = Array.from({ length: DAYS }, (_, i) => per.reduce((a, p) => a + p.days[i], 0));
  const lv = levels(counts);
  const base = new Date(today);
  base.setHours(12, 0, 0, 0);
  const todayRow = (base.getDay() + 6) % 7;
  // Column of a day: weeks back from today's week (last column).
  const lastCol = Math.ceil((DAYS - 1 - todayRow) / 7);
  return counts.map((count, i) => {
    const daysAgo = DAYS - 1 - i;
    const date = new Date(base.getTime() - daysAgo * 86_400_000);
    const row = (date.getDay() + 6) % 7;
    const weeksBack = Math.floor((daysAgo + (6 - todayRow)) / 7);
    return {
      daysAgo, date, row, col: lastCol - weeksBack, count, level: lv[i],
      byProject: per.map((p) => ({ project: p.name, count: p.days[i] })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count),
    };
  });
}

export interface RepoState { project: string; branch: string; uncommitted: number; unpushed: number; commits30: number; lastCommitDaysAgo: number }

export function repos(): RepoState[] {
  return PROJECTS.map((p) => {
    const days = commitsByDay(p);
    const last = [...days].reverse().findIndex((n) => n > 0);
    return {
      project: p.name,
      branch: 'main',
      // The plan file counts as uncommitted when it has [~] tasks today (as in the screenshots).
      uncommitted: p.uncommitted.length + (p.milestones.some((m) => m.tasks.some((t) => t.doing)) ? 1 : 0),
      unpushed: p.unpushed,
      commits30: days.slice(-30).reduce((a, b) => a + b, 0),
      lastCommitDaysAgo: last < 0 ? DAYS : last,
    };
  });
}
