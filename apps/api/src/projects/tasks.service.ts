import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Milestone, ProjectDetail, Task, TaskStatus } from '@overlook/shared';
import { PlanFileService } from '../plans/plan-file.service';
import { PlanConflictError, PlanEditError, addTask, deleteTask, setTaskStatus, setTaskText } from '../plans/plan-writer';
import { ProjectsService } from './projects.service';
import { TaskEventsService } from './task-events.service';
import { EventsService } from '../events/events.service';

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];

export interface TaskPatch {
  status?: TaskStatus;
  text?: string;
}

/** Task edits written back to the project's plan files. */
@Injectable()
export class TasksService {
  constructor(private projects: ProjectsService, private files: PlanFileService, private events: EventsService, private taskEvents: TaskEventsService) {}

  async update(projectId: string, taskId: string, patch: TaskPatch): Promise<ProjectDetail> {
    if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
      throw new BadRequestException(`Invalid task status ${patch.status}`);
    }
    if (patch.status === undefined && patch.text === undefined) throw new BadRequestException('Nothing to update');
    const { milestone } = await this.locateTask(projectId, taskId);
    const updated = await this.write(projectId, milestone, (c) => {
      let out = c;
      if (patch.status !== undefined) out = setTaskStatus(out, milestone.file, milestone.relFile, taskId, patch.status);
      // Text last: changing the text changes the task id.
      if (patch.text !== undefined) out = setTaskText(out, milestone.file, milestone.relFile, taskId, patch.text);
      return out;
    });
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
      if (e instanceof PlanConflictError) throw new ConflictException(e.message);
      if (e instanceof PlanEditError) throw new BadRequestException(e.message);
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('Plan file no longer exists');
      throw e;
    }
    // Task history records this read as a dashboard change.
    const updated = await this.taskEvents.asDashboardWrite(projectId, () => this.projects.refreshPlans(projectId));
    this.events.emit({ type: 'project:updated', projectId, file: milestone.relFile, source: 'dashboard' });
    return updated;
  }
}
