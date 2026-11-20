import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Milestone, ProjectDetail, Task, TaskStatus } from '@overlook/shared';
import { PlanFileService } from '../plans/plan-file.service';
import { parsePlan } from '../plans/plan-parser';
import { PlanConflictError, PlanEditError, addTask, deleteTask, moveTask, setTaskStatus, setTaskText } from '../plans/plan-writer';
import { ProjectsService } from './projects.service';
import { EventsService } from '../events/events.service';

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];

export interface TaskPatch {
  status?: TaskStatus;
  text?: string;
  /** Move the task (with its sub-tasks) to the end of this milestone; it may be in another plan file of the project. */
  milestoneId?: string;
}

/** Task edits written back to the project's plan files. */
@Injectable()
export class TasksService {
  constructor(private projects: ProjectsService, private files: PlanFileService, private events: EventsService) {}

  async update(projectId: string, taskId: string, patch: TaskPatch): Promise<ProjectDetail> {
    if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
      throw new BadRequestException(`Invalid task status ${patch.status}`);
    }
    if (patch.milestoneId !== undefined && (typeof patch.milestoneId !== 'string' || !patch.milestoneId)) {
      throw new BadRequestException('milestoneId must be a milestone id');
    }
    if (patch.status === undefined && patch.text === undefined && patch.milestoneId === undefined) throw new BadRequestException('Nothing to update');
    const { milestone } = await this.locateTask(projectId, taskId);
    const edit = (c: string) => {
      let out = c;
      if (patch.status !== undefined) out = setTaskStatus(out, milestone.file, milestone.relFile, taskId, patch.status);
      // Text last: changing the text changes the task id.
      if (patch.text !== undefined) out = setTaskText(out, milestone.file, milestone.relFile, taskId, patch.text);
      return out;
    };
    if (patch.milestoneId === undefined) return this.write(projectId, milestone, edit);
    return this.move(projectId, milestone, taskId, patch.milestoneId, edit);
  }

  /**
   * Applies `edit` (status/text) and then moves the task to another milestone. Both files are read,
   * checked and backed up before either is written; a change in either since the page loaded is a 409.
   */
  private async move(projectId: string, from: Milestone, taskId: string, milestoneId: string, edit: (c: string) => string): Promise<ProjectDetail> {
    const project = await this.projects.get(projectId);
    const to = project.milestones.find((m) => m.id === milestoneId);
    if (!to) throw new ConflictException('Milestone not found. Reload the project and try again.');
    const tasksOf = (content: string) => parsePlan(content, from.file, from.relFile).flatMap((m) => m.tasks);
    /** Applies the status/text edit; returns the new content and the task's id in it. */
    const edited = (c: string) => {
      const line = tasksOf(c).find((t) => t.id === taskId)?.line;
      if (line === undefined) throw new PlanConflictError('The task changed in the file since it was loaded. Reload and try again.');
      const content = edit(c);
      // Status and text edits keep the checkbox on its line, so the edited task is found there.
      const id = content === c ? taskId : tasksOf(content).find((t) => t.line === line)?.id;
      if (!id) throw new PlanConflictError('The task changed in the file since it was loaded. Reload and try again.');
      return { content, id };
    };
    const src = (content: string) => ({ content, file: from.file, relFile: from.relFile });
    try {
      if (to.file.toLowerCase() === from.file.toLowerCase()) {
        await this.files.edit(from.file, (c) => {
          const e = edited(c);
          return moveTask(src(e.content), e.id, null, milestoneId).source;
        });
      } else {
        await this.files.editPair(from.file, to.file, (a, b) => {
          const e = edited(a);
          const r = moveTask(src(e.content), e.id, { content: b, file: to.file, relFile: to.relFile }, milestoneId);
          return [r.source, r.target!];
        });
      }
    } catch (e) {
      throw this.httpError(e);
    }
    const updated = await this.projects.refreshPlans(projectId);
    for (const file of new Set([from.relFile, to.relFile])) this.events.emit({ type: 'project:updated', projectId, file, source: 'dashboard' });
    return updated;
  }

  async add(projectId: string, milestoneId: string, text: string, status: TaskStatus = 'todo'): Promise<ProjectDetail> {
    if (!STATUSES.includes(status)) throw new BadRequestException(`Invalid task status ${status}`);
    const project = await this.projects.get(projectId);
    const milestone = project.milestones.find((m) => m.id === milestoneId);
    if (!milestone) throw new ConflictException('Milestone not found. Reload the project and try again.');
    return this.write(projectId, milestone, (c) => addTask(c, milestone.file, milestone.relFile, milestoneId, text, status));
  }

  async remove(projectId: string, taskId: string): Promise<ProjectDetail> {
    const { milestone } = await this.locateTask(projectId, taskId);
    return this.write(projectId, milestone, (c) => deleteTask(c, milestone.file, milestone.relFile, taskId));
  }

  /** Finds the task in the cached project; re-reads plan files once if it is not there. */
  private async locateTask(projectId: string, taskId: string): Promise<{ milestone: Milestone; task: Task }> {
    for (const load of [() => this.projects.get(projectId), () => this.projects.refreshPlans(projectId)]) {
      for (const milestone of (await load()).milestones) {
        const task = milestone.tasks.find((t) => t.id === taskId);
        if (task) return { milestone, task };
      }
    }
    throw new ConflictException('Task not found. It may have been changed in the file; reload and try again.');
  }

  /** Writes the file, refreshes the cached project, then tells other open pages. */
  private async write(projectId: string, milestone: Milestone, edit: (content: string) => string): Promise<ProjectDetail> {
    try {
      await this.files.edit(milestone.file, edit);
    } catch (e) {
      throw this.httpError(e);
    }
    const updated = await this.projects.refreshPlans(projectId);
    this.events.emit({ type: 'project:updated', projectId, file: milestone.relFile, source: 'dashboard' });
    return updated;
  }

  private httpError(e: unknown): unknown {
    if (e instanceof PlanConflictError) return new ConflictException(e.message);
    if (e instanceof PlanEditError) return new BadRequestException(e.message);
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new NotFoundException('Plan file no longer exists');
    return e;
  }
}
