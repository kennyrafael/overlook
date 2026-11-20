import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { SettingEntity } from '../config/setting.entity';
import { ParseCacheEntity } from '../insights/parse-cache.entity';
import { ProjectOverrideEntity } from '../projects/project-override.entity';
import { SnapshotEntity } from '../projects/snapshot.entity';
import { ViewEntity } from '../views/view.entity';
import { Baseline1763424000000 } from './migrations/1763424000000-Baseline';
import { ParseCache1763510400000 } from './migrations/1763510400000-ParseCache';
import { TaskEventEntity, TaskStateEntity } from '../projects/task-event.entity';
import { DeviceEntity } from '../insights/device.entity';
import { DailyOverview1763800000000 } from './migrations/1763800000000-DailyOverview';

/** Where the dashboard keeps its own data (database, plan-file backups, logs). */
export const dataDir = process.env.CPD_DATA_DIR ?? join(homedir(), '.claude-projects-dashboard');
mkdirSync(dataDir, { recursive: true });

export const logDir = join(dataDir, 'logs');

export const databaseFile = join(dataDir, 'dashboard.sqlite');

export const entities = [SettingEntity, ProjectOverrideEntity, SnapshotEntity, ViewEntity, ParseCacheEntity,
  TaskEventEntity, TaskStateEntity, DeviceEntity];
/** In order. Never edit a released migration; add a new one. */
export const migrations = [Baseline1763424000000, ParseCache1763510400000,
  DailyOverview1763800000000];

export const databaseOptions: TypeOrmModuleOptions = {
  type: 'better-sqlite3',
  database: databaseFile,
  entities,
  migrations,
  migrationsRun: true,
  migrationsTransactionMode: 'each',
  synchronize: false,
};
