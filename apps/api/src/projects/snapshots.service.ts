import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { basename, dirname, join } from 'path';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import type { Milestone, ProgressPoint } from '@overlook/shared';
import { git } from '../common/git';
import { localDay } from '../insights/limit';
import { parsePlan, summarize } from '../plans/plan-parser';
import { SnapshotEntity } from './snapshot.entity';

const BACKFILL_DAYS = 90;

export interface SnapshotSource {
  projectId: string;
  path: string;
  milestones: Milestone[];
  /** Plan files (relative to the project) that currently hold milestones. */
  planFiles: string[];
}

type Counts = Pick<ProgressPoint, 'milestonesReached' | 'milestonesTotal' | 'tasksDone' | 'tasksTotal'>;

function counts(milestones: Milestone[]): Counts {
  const s = summarize(milestones);
  return { milestonesReached: s.milestonesReached, milestonesTotal: s.milestonesTotal, tasksDone: s.tasksDone, tasksTotal: s.tasksTotal };
}

function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDay(d);
}

/** Daily progress snapshots: recorded live, and backfilled once from git history. */
@Injectable()
export class SnapshotsService {
  private readonly log = new Logger(SnapshotsService.name);
  private backfilled = new Set<string>();

  constructor(@InjectRepository(SnapshotEntity) private repo: Repository<SnapshotEntity>) {}

  /** Upserts today's row for each project that has a plan. */
  async record(sources: SnapshotSource[]) {
    const day = localDay(new Date());
    const rows = sources
      .filter((s) => s.milestones.length)
      .map((s) => this.repo.create({ projectId: s.projectId, day, source: 'live', ...counts(s.milestones) }));
    if (rows.length) await this.repo.save(rows);
  }

  /** Daily totals over the given projects (all when undefined), carrying each project's last value forward. */
  async series(projectIds: string[] | undefined, days: number): Promise<ProgressPoint[]> {
    const today = localDay(new Date());
    const from = addDays(today, -(days - 1));
    // Include the last row before `from` so values carry into the window.
    const where = projectIds ? { projectId: In(projectIds) } : {};
    const rows = await this.repo.find({ where, order: { day: 'ASC' } });
    if (!rows.length) return [];

    const byProject = new Map<string, SnapshotEntity[]>();
    for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);

    const firstDay = rows.reduce((m, r) => (r.day < m ? r.day : m), today);
    const start = firstDay > from ? firstDay : from;
    const out: ProgressPoint[] = [];
    const cursor = new Map<string, number>();
    for (let day = start; day <= today; day = addDays(day, 1)) {
      const p: ProgressPoint = { date: day, milestonesReached: 0, milestonesTotal: 0, tasksDone: 0, tasksTotal: 0 };
      for (const [id, list] of byProject) {
        let i = cursor.get(id) ?? -1;
        while (i + 1 < list.length && list[i + 1].day <= day) i++;
        cursor.set(id, i);
        if (i < 0) continue; // project had no plan yet
        const r = list[i];
        p.milestonesReached += r.milestonesReached;
        p.milestonesTotal += r.milestonesTotal;
        p.tasksDone += r.tasksDone;
        p.tasksTotal += r.tasksTotal;
      }
      out.push(p);
    }
    return out;
  }

  /**
   * Reconstructs daily progress for the last 90 days from the git history of the
   * project's plan files. Runs once per project per server start; never overwrites
   * days that already have a row.
   */
  async backfill(src: SnapshotSource): Promise<boolean> {
    if (this.backfilled.has(src.projectId) || !src.planFiles.length) return false;
    this.backfilled.add(src.projectId);

    const today = localDay(new Date());
    const since = addDays(today, -BACKFILL_DAYS);
    // file -> list of (day, counts) states in chronological order
    const timelines: { day: string; c: Counts }[][] = [];

    for (const rel of src.planFiles) {
      const file = join(src.path, rel);
      const dir = dirname(file);
      if (!existsSync(file)) continue;
      try {
        // Ask git for the repo-relative path (comparing paths ourselves breaks on 8.3 short names).
        const repoPath = (await git(dir, ['ls-files', '--full-name', '--', basename(file)])).trim().split('\n')[0];
        if (!repoPath) continue; // not tracked
        const parseAt = async (hash: string) =>
          counts(parsePlan(await git(dir, ['show', `${hash}:${repoPath}`]), file, rel));

        const timeline: { day: string; c: Counts }[] = [];
        // State at the start of the window (last commit before it).
        const before = (await git(dir, ['log', '-1', `--before=${since}`, '--format=%H', '--', basename(file)])).trim();
        if (before) timeline.push({ day: since, c: await parseAt(before) });

        const log = (await git(dir, ['log', `--since=${since}`, '--reverse', '--date=format-local:%Y-%m-%d', '--format=%H%x09%ad', '--', basename(file)])).trim();
        for (const line of log.split('\n').filter(Boolean)) {
          const [hash, day] = line.split('\t');
          const c = await parseAt(hash).catch(() => null); // file may be deleted in that commit
          if (!c) continue;
          if (timeline.length && timeline[timeline.length - 1].day === day) timeline[timeline.length - 1].c = c;
          else timeline.push({ day, c });
        }
        if (timeline.length) timelines.push(timeline);
      } catch {
        // Not in a git repo, or untracked: nothing to backfill for this file.
      }
    }
    if (!timelines.length) return false;

    const existing = new Set((await this.repo.find({ where: { projectId: src.projectId, day: MoreThanOrEqual(since) }, select: ['day'] })).map((r) => r.day));
    const start = timelines.reduce((m, t) => (t[0].day < m ? t[0].day : m), today);
    const rows: SnapshotEntity[] = [];
    const idx = timelines.map(() => -1);
    for (let day = start; day < today; day = addDays(day, 1)) {
      const total: Counts = { milestonesReached: 0, milestonesTotal: 0, tasksDone: 0, tasksTotal: 0 };
      let any = false;
      timelines.forEach((t, k) => {
        while (idx[k] + 1 < t.length && t[idx[k] + 1].day <= day) idx[k]++;
        if (idx[k] < 0) return;
        any = true;
        const c = t[idx[k]].c;
        total.milestonesReached += c.milestonesReached;
        total.milestonesTotal += c.milestonesTotal;
        total.tasksDone += c.tasksDone;
        total.tasksTotal += c.tasksTotal;
      });
      if (any && total.milestonesTotal > 0 && !existing.has(day)) {
        rows.push(this.repo.create({ projectId: src.projectId, day, source: 'git', ...total }));
      }
    }
    if (rows.length) {
      await this.repo.save(rows, { chunk: 200 });
      this.log.log(`Backfilled ${rows.length} days for ${src.path}`);
    }
    return rows.length > 0;
  }
}
