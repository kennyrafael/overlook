import { Body, Controller, Get, Put } from '@nestjs/common';
import { Settings } from '@overlook/shared';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get() get() { return this.settings.get(); }

  @Put() update(@Body() body: Partial<Settings>) { return this.settings.update(body); }
}
