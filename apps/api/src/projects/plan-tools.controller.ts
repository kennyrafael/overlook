import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PlanToolsService } from './plan-tools.service';

// Phase 6 routes, apart from projects.controller.ts so the task routes there stay as they were.

/** Stale in-progress work across projects. */
@Controller('plans')
export class PlansController {
  constructor(private tools: PlanToolsService) {}

  @Get('stale') stale() { return this.tools.staleTasks(); }
}

/** Starter plan files for a project without one. */
@Controller('projects/:id')
export class PlanFileController {
  constructor(private tools: PlanToolsService) {}

  @Get('plan-templates') templates(@Param('id') id: string) { return this.tools.templates(id); }

  /** `{ template }` names one of the server's templates; nothing else from the request is written. */
  @Post('plan-file') create(@Param('id') id: string, @Body() body: { template?: unknown }) {
    return this.tools.create(id, body?.template);
  }
}
