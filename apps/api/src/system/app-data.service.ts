import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DEFAULT_SETTINGS, PROJECT_STATUSES, type AppDataExport, type Settings } from '@overlook/shared';
import { SettingsService } from '../config/settings.service';
import { SettingEntity } from '../config/setting.entity';
import { ParseCacheEntity } from '../insights/parse-cache.entity';
import { ProjectOverrideEntity } from '../projects/project-override.entity';
import { ProjectsService } from '../projects/projects.service';
import { SnapshotEntity } from '../projects/snapshot.entity';
import { TaskEventEntity, TaskStateEntity } from '../projects/task-event.entity';
import { TaskEventsService } from '../projects/task-events.service';
import { DeviceEntity } from '../insights/device.entity';
import { cleanFilters } from '../views/views.service';
import { ViewEntity } from '../views/view.entity';

/** Export, import and reset of everything Overlook stores about the user's setup. */
@Injectable()
export class AppDataService {
  constructor(private db: DataSource, private settings: SettingsService, private projects: ProjectsService, private taskEvents: TaskEventsService) {}

  async export(): Promise<AppDataExport> {
    const [settings, overrides, views] = await Promise.all([
      this.settings.get(),
      this.db.getRepository(ProjectOverrideEntity).find(),
      this.db.getRepository(ViewEntity).find({ order: { createdAt: 'ASC' } }),
    ]);
    return {
      app: 'overlook',
      format: 1,
      exportedAt: new Date().toISOString(),
      settings,
      projectOverrides: overrides.map((o) => ({ id: o.id, name: o.name, status: o.status, tags: o.tags, pinned: o.pinned })),
      views: views.map((v) => ({ id: v.id, name: v.name, filters: cleanFilters(JSON.parse(v.filters)), createdAt: v.createdAt.toISOString() })),
    };
  }

  /** Replaces settings, project overrides and saved views with the file's contents. */
  async import(raw: unknown): Promise<{ settings: number; projectOverrides: number; views: number }> {
    const data = raw as Partial<AppDataExport> | null;
    if (!data || typeof data !== 'object' || data.app !== 'overlook') throw new BadRequestException('Not an Overlook export file');
    if (data.format !== 1) throw new BadRequestException(`Unsupported export format ${String(data.format)}; update Overlook and try again`);

    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const overrides = (Array.isArray(data.projectOverrides) ? data.projectOverrides : []).flatMap((o) => {
      const id = str(o?.id, 200);
      if (!id) return [];
      const status = typeof o.status === 'string' && (PROJECT_STATUSES as string[]).includes(o.status) ? o.status : null;
      const tags = Array.isArray(o.tags) ? [...new Set(o.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean))].slice(0, 50) : [];
      return [{ id, name: str(o.name, 200), status, tags, pinned: o.pinned === true }];
    });
    const views = (Array.isArray(data.views) ? data.views : []).flatMap((v) => {
      const name = str(v?.name, 80);
      if (!name) return [];
      const created = typeof v.createdAt === 'string' && !Number.isNaN(Date.parse(v.createdAt)) ? new Date(v.createdAt) : new Date();
      return [{ name, filters: JSON.stringify(cleanFilters(v.filters)), createdAt: created }];
    });

    await this.db.transaction(async (m) => {
      await m.clear(SettingEntity);
      await m.clear(ProjectOverrideEntity);
      await m.clear(ViewEntity);
      if (overrides.length) await m.save(ProjectOverrideEntity, overrides);
      for (const v of views) await m.save(ViewEntity, m.create(ViewEntity, v));
    });
    // Settings go through the normal validation; unknown or mistyped keys are dropped.
    const s = (data.settings && typeof data.settings === 'object' ? data.settings : {}) as Partial<Settings>;
    await this.settings.update({ ...DEFAULT_SETTINGS, ...s });
    await this.projects.rescan();
    return { settings: Object.keys(s).length, projectOverrides: overrides.length, views: views.length };
  }

  /** Deletes everything in the database. Plan files and Claude logs are not touched. */
  async reset(): Promise<void> {
    await this.db.transaction(async (m) => {
      for (const e of [SettingEntity, ProjectOverrideEntity, SnapshotEntity, ViewEntity, ParseCacheEntity, TaskEventEntity, TaskStateEntity, DeviceEntity]) await m.clear(e);
    });
    this.taskEvents.forget();
    await this.projects.rescan();
  }
}
