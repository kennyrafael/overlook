import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';
import { SystemController } from './system.controller';
import { SettingsModule } from '../config/settings.module';

@Module({
  imports: [ProjectsModule, SettingsModule],
  controllers: [ActionsController, SystemController],
  providers: [ActionsService],
})
export class ActionsModule {}
