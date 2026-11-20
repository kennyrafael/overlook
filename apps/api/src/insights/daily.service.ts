import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { relative } from 'path';
import { Repository } from 'typeorm';
import type { AwaySummary, ClaudeSession, CommitRef, RepoBranches, SummaryProject, WorkSummary } from '@overlook/shared';
import { ProjectRef, ProjectsService } from '../projects/projects.service';
import { TaskEventsService } from '../projects/task-events.service';
import { netMoves } from '../projects/task-events';
import { ClaudeUsageService } from './claude-usage.service';
import { DeviceEntity } from './device.entity';
import { repoJobs } from './git.service';
import { commitsBetween, repoBranches } from './git-branches';
import { localDay, mapLimit } from './limit';

const GIT_CACHE_MS = 60_000;
const MAX_DEVICES = 50;
const OTHER_NAME = 'Other (not a project)';

/** Midnight (local time) at the start of a YYYY-MM-DD day, as ISO. */
export function dayStart(day: string): string {
  return new Date(`${day}T00:00:00`).toISOString();
}

/** Midnight at the end of a YYYY-MM-DD day (the start of the next one), as ISO. */
export function dayEnd(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** Milliseconds of [start, end] that fall inside [from, to). */
export function overlapMs(start: string, end: string, from: string, to: string): number {
  const a = Math.max(Date.parse(start), Date.parse(from));
  const b = Math.min(Date.parse(end), Date.parse(to));
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? b - a : 0;
}

/**
 * The away card and the weekly summary: task history (TaskEventsService), commits on each repository's
 * checked-out branch (read-only git, 60 s cache) and Claude sessions with their estimated cost.
 */
@Injectable()
export class DailyService {
  private gitCache = new Map<string, { at: number; data: Promise<unknown> }>();

  constructor(
    private projects: ProjectsService,
    private taskEvents: TaskEventsService,
    private claude: ClaudeUsageService,
    @InjectRepository(DeviceEntity) private devices: Repository<DeviceEntity>,
  ) {}

  async away(deviceId: string): Promise<AwaySummary> {
    const until = new Date().toISOString();
    const row = await this.devices.findOneBy({ id: deviceId });
    const empty: AwaySummary = { since: null, until, tasksCompleted: 0, completed: [], commits: 0, sessions: 0, costUsd: 0, projects: [] };
    if (!row) return empty;
    const since = row.lastSeenAt;
    const refs = (await this.projects.refs()).filter((r) => r.exists);
    const [events, commits, overview] = await Promise.all([
      this.taskEvents.between(since, until),
      this.commits(refs, since, null, 1),
      this.claude.overview({ from: localDay(new Date(since)) }),
    ]);

    const names = new Map(refs.map((r) => [r.id, r.name]));
    const per = new Map<string, AwaySummary['projects'][number]>();
    const of = (id: string) => per.get(id) ?? per.set(id, { projectId: id, name: names.get(id) ?? id, tasksCompleted: 0, commits: 0, sessions: 0, costUsd: 0 }).get(id)!;

    const completed: AwaySummary['completed'] = [];
    for (const [id, list] of group(events, (e) => e.projectId)) {
      if (!names.has(id)) continue;
      const done = netMoves(list).filter((m) => m.to === 'done');
      of(id).tasksCompleted += done.length;
      completed.push(...done.map((m) => ({ projectId: id, projectName: names.get(id)!, text: m.taskText, at: m.at })));
    }
    for (const [id, c] of commits) if (c.count) of(id).commits += c.count;
    // Sessions that were active after the last visit. Cost is per day in the logs, so the day of the last
    // visit counts in full: an estimate, like every cost figure.
    const sessions = overview.sessions.filter((s) => s.endedAt > since && s.projectId && names.has(s.projectId));
    for (const s of sessions) {
      const p = of(s.projectId!);
      p.sessions += 1;
      p.costUsd += s.costUsd;
    }

    const projects = [...per.values()].sort((a, b) => b.tasksCompleted + b.commits + b.sessions - (a.tasksCompleted + a.commits + a.sessions) || a.name.localeCompare(b.name));
    return {
      since, until,
      tasksCompleted: projects.reduce((n, p) => n + p.tasksCompleted, 0),
      completed: completed.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10),
      commits: projects.reduce((n, p) => n + p.commits, 0),
      sessions: sessions.length,
      costUsd: sessions.reduce((n, s) => n + s.costUsd, 0),
      projects,
    };
  }

  /** "Mark as seen": the next away card starts from now. */
  async markSeen(deviceId: string): Promise<{ lastSeenAt: string }> {
    const lastSeenAt = new Date().toISOString();
    await this.devices.save({ id: deviceId, lastSeenAt });
    // Ids live in browser storage, which gets cleared; keep only the most recent devices.
    const old = await this.devices.find({ order: { lastSeenAt: 'DESC' }, skip: MAX_DEVICES, take: 1000 });
    if (old.length) await this.devices.remove(old);
    return { lastSeenAt };
  }

  /** Per project, between two local days (inclusive): task moves, commits, Claude sessions, time and cost. */
  async summary(from: string, to: string): Promise<WorkSummary> {
    const start = dayStart(from);
    const end = dayEnd(to);
    const refs = (await this.projects.refs()).filter((r) => r.exists);
    const [events, commits, overview] = await Promise.all([
      this.taskEvents.between(start, end),
      this.commits(refs, start, end, 10),
      this.claude.overview({ from, to }),
    ]);

    const names = new Map(refs.map((r) => [r.id, r.name]));
    const per = new Map<string, SummaryProject>();
    const of = (id: string | null, name: string) => {
      const key = id ?? '';
      return per.get(key) ?? per.set(key, {
        projectId: id, name, moved: [], tasksCompleted: 0, tasksAdded: 0, tasksRemoved: 0,
        commits: 0, recentCommits: [], sessions: 0, durationMs: 0, costUsd: 0,
      }).get(key)!;
    };

    for (const [id, list] of group(events, (e) => e.projectId)) {
      if (!names.has(id)) continue;
      const added = list.filter((e) => e.from === null).length;
      const removed = list.filter((e) => e.to === null).length;
      const moved = netMoves(list);
      if (!moved.length && !added && !removed) continue;
      const p = of(id, names.get(id)!);
      p.moved = moved;
      p.tasksCompleted = moved.filter((m) => m.to === 'done').length;
      p.tasksAdded = added;
      p.tasksRemoved = removed;
    }
    for (const [id, c] of commits) {
      if (!c.count) continue;
      const p = of(id, names.get(id) ?? id);
      p.commits = c.count;
      p.recentCommits = c.recent;
    }
    for (const s of overview.sessions) {
      const known = s.projectId && names.has(s.projectId);
      const p = of(known ? s.projectId : null, known ? names.get(s.projectId!)! : OTHER_NAME);
      p.sessions += 1;
      p.durationMs += sessionMs(s, start, end);
      p.costUsd += s.costUsd;
    }

    const score = (p: SummaryProject) => p.tasksCompleted + p.moved.length + p.commits + p.sessions;
    const projects = [...per.values()].sort((a, b) =>
      Number(a.projectId === null) - Number(b.projectId === null) || score(b) - score(a) || a.name.localeCompare(b.name));
    const sum = (f: (p: SummaryProject) => number) => projects.reduce((n, p) => n + f(p), 0);
    return {
      from, to, generatedAt: new Date().toISOString(),
      totals: {
        tasksCompleted: sum((p) => p.tasksCompleted),
        tasksMoved: sum((p) => p.moved.length),
        commits: sum((p) => p.commits),
        sessions: sum((p) => p.sessions),
        durationMs: sum((p) => p.durationMs),
        costUsd: sum((p) => p.costUsd),
      },
      projects,
    };
  }

  /** Branches and worktrees of one repository of a project; `repo` is its path relative to the project. */
  async branches(projectId: string, repo: string): Promise<RepoBranches> {
    const ref = (await this.projects.refs()).find((r) => r.id === projectId && r.exists);
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
    const job = ref && repoJobs([ref]).find((j) => norm(relative(j.root, j.path)) === norm(repo));
    if (!job) throw new NotFoundException('Repository not found');
    return this.cached(`branches|${job.path}`, () => repoBranches(job.path));
  }

  /** Commits per project (summed over its repositories; the newest `limit`, across them). */
  private async commits(refs: ProjectRef[], since: string, until: string | null, limit: number) {
    const jobs = repoJobs(refs);
    // "Since the last visit" runs up to now, so it is never cached; a fixed range is.
    const results = await mapLimit(jobs, 4, (j) => {
      const read = () => commitsBetween(j.path, relative(j.root, j.path), since, until, limit);
      return until ? this.cached(`log|${j.path}|${since}|${until}|${limit}`, read) : read();
    });
    const out = new Map<string, { count: number; recent: CommitRef[] }>();
    jobs.forEach((j, i) => {
      const prev = out.get(j.projectId) ?? { count: 0, recent: [] };
      out.set(j.projectId, {
        count: prev.count + results[i].count,
        recent: [...prev.recent, ...results[i].recent].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit),
      });
    });
    return out;
  }

  /** git is slow on Windows and the summary page reloads on live events: reuse answers for 60 s. */
  private cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.gitCache.get(key);
    if (hit && now - hit.at < GIT_CACHE_MS) return hit.data as Promise<T>;
    if (this.gitCache.size > 500) {
      for (const [k, v] of this.gitCache) if (now - v.at >= GIT_CACHE_MS) this.gitCache.delete(k);
    }
    const data = fn();
    this.gitCache.set(key, { at: now, data });
    data.catch(() => this.gitCache.delete(key));
    return data;
  }
}

function group<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

const sessionMs = (s: ClaudeSession, from: string, to: string) => overlapMs(s.startedAt, s.endedAt, from, to);


