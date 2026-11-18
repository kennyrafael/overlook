import { Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { SettingsModule } from '../config/settings.module';
import { ProjectsModule } from '../projects/projects.module';
import { AppDataController } from './app-data.controller';
import { AppDataService } from './app-data.service';

@Module({
  imports: [ActionsModule, SettingsModule, ProjectsModule],
  controllers: [AppDataController],
  providers: [AppDataService],
})
export class SystemModule {}
