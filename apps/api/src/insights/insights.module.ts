import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../config/settings.module';
import { ProjectsModule } from '../projects/projects.module';
import { ClaudeUsageService } from './claude-usage.service';
import { GitService } from './git.service';
import { InsightsController } from './insights.controller';
import { ParseCacheEntity } from './parse-cache.entity';
import { WatcherService } from './watcher.service';

@Module({
  imports: [ProjectsModule, SettingsModule, TypeOrmModule.forFeature([ParseCacheEntity])],
  controllers: [InsightsController],
  providers: [GitService, ClaudeUsageService, WatcherService],
})
export class InsightsModule {}
