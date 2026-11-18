import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { ProjectPatch, TaskStatus } from '@overlook/shared';
import { ProjectsService } from './projects.service';
import { TaskPatch, TasksService } from './tasks.service';

@Controller('projects')
export class ProjectsController {
  constructor(private projects: ProjectsService, private tasks: TasksService) {}

  @Get() list() { return this.projects.list(); }

  @Post('rescan') rescan() { return this.projects.rescan(); }

  @Get(':id') get(@Param('id') id: string) { return this.projects.get(id); }

  @Patch(':id') update(@Param('id') id: string, @Body() body: ProjectPatch) {
    return this.projects.update(id, body ?? {});
  }

  @Patch(':id/tasks/:taskId') updateTask(@Param('id') id: string, @Param('taskId') taskId: string, @Body() body: TaskPatch) {
    return this.tasks.update(id, taskId, body ?? {});
  }

  @Delete(':id/tasks/:taskId') deleteTask(@Param('id') id: string, @Param('taskId') taskId: string) {
    return this.tasks.remove(id, taskId);
  }

  @Post(':id/milestones/:milestoneId/tasks') addTask(
    @Param('id') id: string,
    @Param('milestoneId') milestoneId: string,
    @Body() body: { text: string; status?: TaskStatus },
  ) {
    return this.tasks.add(id, milestoneId, body?.text, body?.status ?? 'todo');
  }
}
