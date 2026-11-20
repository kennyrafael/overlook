import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, In, LessThan, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import type { Milestone, TaskEvent, TaskStatus } from '@overlook/shared';
import { TaskEventEntity, TaskStateEntity } from './task-event.entity';
import { TaskState, diffTasks, taskStates } from './task-events';

export interface TaskEventSource {
  projectId: string;
  milestones: Milestone[];
}

/**
 * Task history for the away card and the weekly summary. Every time a project's plan files are read, the
 * task list is compared with the last one seen (kept in SQLite, so edits made while the app was closed are
 * found too) and the differences are stored as events. Nothing is written inside the project.
 */
@Injectable()
export class TaskEventsService implements OnApplicationBootstrap {
  private readonly log = new Logger(TaskEventsService.name);
  private states: Promise<Map<string, TaskState[]>> | null = null;
  /** Serializes observe() calls, so two reads of the same project never diff against the same old state. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Projects whose next read follows a write made in the dashboard. */
  private dashboardWrites = new Set<string>();

  constructor(
    @InjectRepository(TaskEventEntity) private events: Repository<TaskEventEntity>,
    @InjectRepository(TaskStateEntity) private stateRows: Repository<TaskStateEntity>,
  ) {}

  /** Records what changed since the last read. Never throws (history must not break a page load). */
  observe(sources: TaskEventSource[]): Promise<void> {
    const source = (id: string): TaskEvent['source'] => (this.dashboardWrites.has(id) ? 'dashboard' : 'file');
    const tagged = sources.map((s) => ({ ...s, source: source(s.projectId) }));
    const job = this.queue.then(() => this.apply(tagged)).catch((e) => this.log.warn(`Task history failed: ${e}`));
    this.queue = job;
    return job;
  }

  /** Runs a dashboard write; the plan read it triggers is recorded with source 'dashboard'. */
  async asDashboardWrite<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    this.dashboardWrites.add(projectId);
    try { return await fn(); } finally { this.dashboardWrites.delete(projectId); }
  }

  /** Events with `from <= at < to` (ISO), oldest first. */
  async between(from: string, to: string, projectIds?: string[]): Promise<TaskEvent[]> {
    await this.queue; // include a read that is still being recorded
    const rows = await this.events.find({
      where: { at: And(MoreThanOrEqual(from), LessThan(to)), ...(projectIds ? { projectId: In(projectIds) } : {}) },
      order: { at: 'ASC', id: 'ASC' },
    });
    return rows.map((r) => ({
      projectId: r.projectId, file: r.file, taskText: r.taskText,
      from: r.from as TaskStatus | null, to: r.to as TaskStatus | null, at: r.at, source: r.source,
    }));
  }

  onApplicationBootstrap() {
    this.prune().catch((e) => this.log.warn(`Pruning task history failed: ${e}`));
  }

  /** Drops events older than `days`, so the table stays small. */
  async prune(days = 400) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    await this.events.delete({ at: LessThanOrEqual(cutoff) });
  }

  /** After a data reset: the next read of each project is a first read again. */
  forget() {
    this.states = null;
  }

  private load(): Promise<Map<string, TaskState[]>> {
    this.states ??= (async () => {
      const m = new Map<string, TaskState[]>();
      for (const r of await this.stateRows.find()) {
        try { m.set(r.projectId, JSON.parse(r.tasks)); } catch { /* treated as a first read */ }
      }
      return m;
    })();
    return this.states;
  }

  private async apply(sources: (TaskEventSource & { source: TaskEvent['source'] })[]) {
    const states = await this.load();
    const at = new Date().toISOString();
    const rows: TaskEventEntity[] = [];
    const changed: TaskStateEntity[] = [];
    for (const s of sources) {
      const next = taskStates(s.milestones);
      const prev = states.get(s.projectId);
      // A plan that suddenly reads as empty is more likely mid-save or unreadable than cleared: keep the
      // old list and compare with the next read instead of recording every task as removed.
      if (prev?.length && !next.length) continue;
      if (prev) {
        const diff = diffTasks(prev, next);
        if (!diff.length) continue;
        for (const d of diff) {
          rows.push(this.events.create({ projectId: s.projectId, file: d.file, taskText: d.text, from: d.from, to: d.to, at, source: s.source }));
        }
      }
      // First read of a project: remember it, record nothing (that is not a change).
      states.set(s.projectId, next);
      changed.push(this.stateRows.create({ projectId: s.projectId, tasks: JSON.stringify(next), updatedAt: at }));
    }
    if (rows.length) await this.events.save(rows, { chunk: 200 });
    if (changed.length) await this.stateRows.save(changed, { chunk: 100 });
  }
}
