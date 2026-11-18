import { Controller, Get } from '@nestjs/common';
import { ActionsService } from './actions.service';

@Controller('system')
export class SystemController {
  constructor(private actions: ActionsService) {}

  /** Detected local tools (git, Claude Code, VS Code, terminal, WSL history). */
  @Get('tools')
  tools() {
    return this.actions.tools();
  }
}
