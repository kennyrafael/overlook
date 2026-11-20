import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../config/settings.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { PlanFileService } from '../plans/plan-file.service';
import { ProjectOverrideEntity } from './project-override.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';
import { SnapshotEntity } from './snapshot.entity';
import { SnapshotsService } from './snapshots.service';
import { TaskEventEntity, TaskStateEntity } from './task-event.entity';
import { TaskEventsService } from './task-events.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectOverrideEntity, SnapshotEntity, TaskEventEntity, TaskStateEntity]), SettingsModule, DiscoveryModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, TasksService, PlanFileService, SnapshotsService, TaskEventsService],
  exports: [ProjectsService, SnapshotsService, TaskEventsService],
})
export class ProjectsModule {}
