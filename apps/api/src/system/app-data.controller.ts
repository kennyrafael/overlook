import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { NETWORK_CALLS, type AboutInfo, type SystemInfo } from '@overlook/shared';
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

  /** Reads LICENSE, THIRD_PARTY_NOTICES.md and the version from the app root (repo root or staged app). */
  @Get('about')
  about(): AboutInfo {
    let dir = __dirname;
    while (!existsSync(join(dir, 'THIRD_PARTY_NOTICES.md')) && dirname(dir) !== dir) dir = dirname(dir);
    const read = (f: string) => { try { return readFileSync(join(dir, f), 'utf8'); } catch { return ''; } };
    let version = '';
    try { version = JSON.parse(read('package.json')).version ?? ''; } catch { /* unknown */ }
    return { version, license: read('LICENSE'), notices: read('THIRD_PARTY_NOTICES.md') };
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
