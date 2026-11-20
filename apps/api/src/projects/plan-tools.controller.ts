import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PlanToolsService } from './plan-tools.service';

/** Phase 6 routes: stale work across projects and starter plan files. */
@Controller()
export class PlanToolsController {
  constructor(private tools: PlanToolsService) {}

  @Get('plans/stale') stale() { return this.tools.staleTasks(); }

  @Get('projects/:id/plan-templates') templates(@Param('id') id: string) { return this.tools.templates(id); }

  /** `{ template }` names one of the server's templates; nothing else from the request is written. */
  @Post('projects/:id/plan-file') create(@Param('id') id: string, @Body() body: { template?: unknown }) {
    return this.tools.create(id, body?.template);
  }
}
