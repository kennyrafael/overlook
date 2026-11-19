import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { join } from 'path';
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

// Built UI. The desktop app can point elsewhere with CPD_WEB_DIST.
const webDist = process.env.CPD_WEB_DIST ?? join(__dirname, '..', '..', 'web', 'dist');

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseOptions),
    // In production the API serves the built UI; in dev Vite serves it.
    ...(existsSync(webDist)
      ? [ServeStaticModule.forRoot({ rootPath: webDist, exclude: ['/api/{*path}'] })]
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
