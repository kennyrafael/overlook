import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { SettingEntity } from '../config/setting.entity';
import { ProjectOverrideEntity } from '../projects/project-override.entity';
import { SnapshotEntity } from '../projects/snapshot.entity';
import { ViewEntity } from '../views/view.entity';

/** Where the dashboard keeps its own data (database, plan-file backups). */
export const dataDir = process.env.CPD_DATA_DIR ?? join(homedir(), '.claude-projects-dashboard');
mkdirSync(dataDir, { recursive: true });

export const databaseOptions: TypeOrmModuleOptions = {
  type: 'better-sqlite3',
  database: join(dataDir, 'dashboard.sqlite'),
  entities: [SettingEntity, ProjectOverrideEntity, SnapshotEntity, ViewEntity],
  synchronize: true, // fine for a local single-user app; switch to migrations later
};
