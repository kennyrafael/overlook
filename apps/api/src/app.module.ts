import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { databaseOptions } from './database/database.config';
import { HealthController } from './health.controller';
import { SettingsModule } from './config/settings.module';
import { ProjectsModule } from './projects/projects.module';
import { InsightsModule } from './insights/insights.module';
import { EventsModule } from './events/events.module';
import { ActionsModule } from './actions/actions.module';
import { ViewsModule } from './views/views.module';
import { SystemModule } from './system/system.module';
import { FeedbackModule } from './feedback/feedback.module';

import { webDist } from './common/web-dist';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseOptions),
    // In production the API serves the built UI; in dev Vite serves it.
    ...(existsSync(webDist)
      // Static files only; page routes get index.html from spaFallback (configure.ts), which works under dot-folders.
      ? [ServeStaticModule.forRoot({ rootPath: webDist, exclude: ['/api/{*path}'], renderPath: '/__overlook_no_render__' })]
      : []),
    EventsModule,
    SettingsModule,
    ProjectsModule,
    InsightsModule,
    ActionsModule,
    ViewsModule,
    SystemModule,
    FeedbackModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
