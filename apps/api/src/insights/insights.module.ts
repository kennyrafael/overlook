import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../config/settings.module';
import { ProjectsModule } from '../projects/projects.module';
import { ClaudeUsageService } from './claude-usage.service';
import { GitService } from './git.service';
import { LiveActivityService } from './live-activity.service';
import { InsightsController } from './insights.controller';
import { ParseCacheEntity } from './parse-cache.entity';
import { WatcherService } from './watcher.service';
import { DailyController } from './daily.controller';
import { DailyService } from './daily.service';
import { DeviceEntity } from './device.entity';

@Module({
  imports: [ProjectsModule, SettingsModule, TypeOrmModule.forFeature([ParseCacheEntity, DeviceEntity])],
  controllers: [InsightsController, DailyController],
  providers: [GitService, ClaudeUsageService, LiveActivityService, WatcherService, DailyService],
})
export class InsightsModule {}
