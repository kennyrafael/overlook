import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { NETWORK_CALLS, type SystemInfo } from '@overlook/shared';
import { ActionsService } from '../actions/actions.service';
import { dataDir, logDir } from '../database/database.config';
import { AppDataService } from './app-data.service';

@Controller('system')
export class AppDataController {
  constructor(private data: AppDataService, private actions: ActionsService) {}

  @Get('info')
  info(): SystemInfo {
    return { dataDir, logDir, network: NETWORK_CALLS };
  }

  @Post('open-logs')
  async openLogs() {
    await this.actions.openFolder(logDir);
    return { ok: true };
  }

  @Get('export')
  export() {
    return this.data.export();
  }

  @Post('import')
  import(@Body() body: unknown) {
    return this.data.import(body);
  }

  /** Requires `{ "confirm": "reset" }` so a stray request cannot wipe the data. */
  @Post('reset')
  async reset(@Body() body: { confirm?: unknown }) {
    if (body?.confirm !== 'reset') throw new BadRequestException('Send { "confirm": "reset" } to reset app data');
    await this.data.reset();
    return { ok: true };
  }
}
