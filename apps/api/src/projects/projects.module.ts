import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../config/settings.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { PlanFileService } from '../plans/plan-file.service';
import { PlanAgeService } from '../plans/plan-age.service';
import { ProjectOverrideEntity } from './project-override.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';
import { SnapshotEntity } from './snapshot.entity';
import { SnapshotsService } from './snapshots.service';
import { TaskEventEntity, TaskStateEntity } from './task-event.entity';
import { TaskEventsService } from './task-events.service';
import { PlanFileController, PlansController } from './plan-tools.controller';
import { PlanToolsService } from './plan-tools.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectOverrideEntity, SnapshotEntity, TaskEventEntity, TaskStateEntity]), SettingsModule, DiscoveryModule],
  controllers: [ProjectsController, PlansController, PlanFileController],
  providers: [ProjectsService, TasksService, PlanFileService, SnapshotsService, PlanAgeService, PlanToolsService, TaskEventsService],
  exports: [ProjectsService, SnapshotsService, TaskEventsService],
})
export class ProjectsModule {}
