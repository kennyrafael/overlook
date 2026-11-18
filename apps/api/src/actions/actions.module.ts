import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';

@Module({
  imports: [ProjectsModule],
  controllers: [ActionsController],
  providers: [ActionsService],
})
export class ActionsModule {}
