import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ActionsService } from './actions.service';

@Controller('projects/:id/actions')
export class ActionsController {
  constructor(private actions: ActionsService) {}

  @Post(':action')
  @HttpCode(200)
  run(@Param('id') id: string, @Param('action') action: string) {
    return this.actions.run(id, action);
  }
}
