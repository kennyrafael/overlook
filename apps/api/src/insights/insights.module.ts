import { Module } from '@nestjs/common';
import { SettingsModule } from '../config/settings.module';
import { ProjectsModule } from '../projects/projects.module';
import { ClaudeUsageService } from './claude-usage.service';
import { GitService } from './git.service';
import { InsightsController } from './insights.controller';
import { WatcherService } from './watcher.service';

@Module({
  imports: [ProjectsModule, SettingsModule],
  controllers: [InsightsController],
  providers: [GitService, ClaudeUsageService, WatcherService],
})
export class InsightsModule {}
