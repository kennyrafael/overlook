import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { ClaudeActionBody } from '@overlook/shared';
import { ActionsService } from './actions.service';

@Controller('projects/:id/actions')
export class ActionsController {
  constructor(private actions: ActionsService) {}

  /** `claude` optionally takes `{ taskId }` (start on a plan task) or `{ resume }` (a session id). */
  @Post(':action')
  @HttpCode(200)
  run(@Param('id') id: string, @Param('action') action: string, @Body() body?: ClaudeActionBody) {
    return this.actions.run(id, action, body ?? {});
  }
}
