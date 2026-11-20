import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PROJECT_STATUSES, Project, ProjectDetail, ProjectPatch, ProjectStatus, Settings } from '@overlook/shared';
import { PlanSummary, summarize } from '../plans/plan-parser';
import { PlansService } from '../plans/plans.service';
import { PlanAgeService } from '../plans/plan-age.service';
import { SettingsService } from '../config/settings.service';
import { DiscoveredProject, DiscoveryService } from '../discovery/discovery.service';
import { projectId } from '../discovery/path-utils';
import { ProjectOverrideEntity } from './project-override.entity';
import { EventsService } from '../events/events.service';
import { SnapshotsService } from './snapshots.service';
import { TaskEventsService } from './task-events.service';

export interface ProjectRef {
  id: string;
  name: string;
  path: string;
  subpaths: string[];
  claudeDirs: string[];
  exists: boolean;
}

const CACHE_TTL_MS = 60_000;
const DAY_MS = 86_400_000;

@Injectable()
export class ProjectsService implements OnApplicationBootstrap {
  private readonly log = new Logger(ProjectsService.name);
  private lastIds = '';
  private cache: { key: string; at: number; data: DiscoveredProject[] } | null = null;
  private inflight: Promise<DiscoveredProject[]> | null = null;

  constructor(
    private discovery: DiscoveryService,
    private settings: SettingsService,
    private plans: PlansService,
    private events: EventsService,
    private snapshots: SnapshotsService,
    private taskEvents: TaskEventsService,
    private ages: PlanAgeService,
    @InjectRepository(ProjectOverrideEntity) private overrides: Repository<ProjectOverrideEntity>,
  ) {}

  async list(): Promise<Project[]> {
    return (await this.listDetailed()).map(({ milestones: _m, planWarnings: _w, ...p }) => p);
  }

  /** One project with its milestones; in-progress tasks carry `inProgressSince` (from git blame, cached). */
  async get(id: string): Promise<ProjectDetail> {
    const p = (await this.listDetailed()).find((x) => x.id === id);
    if (!p) throw new NotFoundException(`Project ${id} not found`);
    return this.ages.annotate(p);
  }

  /** Every project with its milestones and tasks (one discovery pass, from the cache when fresh). */
  detailed(): Promise<ProjectDetail[]> {
    return this.listDetailed();
  }

  private async listDetailed(): Promise<ProjectDetail[]> {
    const settings = await this.settings.get();
    const [found, rows] = await Promise.all([this.discovered(settings, false), this.overrides.find()]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return found
      .map((d) => this.toProject(d, byId.get(projectId(d.path)), settings))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
  }

  /** Lightweight project references for the git / Claude insight services. */
  async refs(): Promise<ProjectRef[]> {
    const settings = await this.settings.get();
    const [found, rows] = await Promise.all([this.discovered(settings, false), this.overrides.find()]);
    const names = new Map(rows.map((r) => [r.id, r.name]));
    return found.map((d) => {
      const id = projectId(d.path);
      return { id, name: names.get(id) || d.name, path: d.path, subpaths: d.subpaths, claudeDirs: d.claudeDirs, exists: d.exists };
    });
  }

  /** Re-reads one project's plan files into the cache (after a write) and returns it. */
  async refreshPlans(id: string): Promise<ProjectDetail> {
    const settings = await this.settings.get();
    const d = (await this.discovered(settings, false)).find((x) => projectId(x.path) === id);
    if (!d) throw new NotFoundException(`Project ${id} not found`);
    const plan = await this.plans.milestonesFor(d.path, d.subpaths, settings.planFiles);
    d.milestones = plan.milestones;
    d.planFiles = plan.files;
    d.planWarnings = plan.warnings;
    d.lastActivityAt = new Date();
    this.snapshots.record([{ projectId: id, path: d.path, milestones: d.milestones, planFiles: d.planFiles }])
      .catch((e) => this.log.warn(`Snapshot failed: ${e}`));
    void this.taskEvents.observe([{ projectId: id, milestones: d.milestones }]);
    return this.get(id);
  }

  async rescan(): Promise<Project[]> {
    const settings = await this.settings.get();
    await this.discovered(settings, true);
    this.events.emit({ type: 'projects:rescanned' });
    return this.list();
  }

  onApplicationBootstrap() {
    // Reconstruct progress history from git once per start, in the background.
    setTimeout(() => this.backfillHistory().catch((e) => this.log.warn(`Backfill failed: ${e}`)), 2000);
  }

  private async backfillHistory() {
    const settings = await this.settings.get();
    const data = await this.discovered(settings, false);
    let changed = false;
    for (const d of data) {
      if (!d.exists || !d.milestones.length) continue;
      changed = (await this.snapshots.backfill({ projectId: projectId(d.path), path: d.path, milestones: d.milestones, planFiles: d.planFiles })) || changed;
    }
    if (changed) this.events.emit({ type: 'snapshots:updated' });
  }

  private afterDiscovery(data: DiscoveredProject[]) {
    this.snapshots.record(data.map((d) => ({ projectId: projectId(d.path), path: d.path, milestones: d.milestones, planFiles: d.planFiles })))
      .catch((e) => this.log.warn(`Snapshot failed: ${e}`));
    void this.taskEvents.observe(data.map((d) => ({ projectId: projectId(d.path), milestones: d.milestones })));
    const ids =data.map((d) => projectId(d.path)).sort().join(',');
    if (this.lastIds && ids !== this.lastIds) this.events.emit({ type: 'projects:rescanned' });
    this.lastIds = ids;
  }

  async update(id: string, patch: ProjectPatch): Promise<Project> {
    await this.get(id); // 404 if unknown
    const row = (await this.overrides.findOneBy({ id })) ?? this.overrides.create({ id, name: null, status: null, tags: [], pinned: false });

    if (patch.name !== undefined) row.name = patch.name?.trim() || null;
    if (patch.status !== undefined) {
      if (patch.status !== null && !PROJECT_STATUSES.includes(patch.status)) {
        throw new BadRequestException(`Invalid status ${patch.status}`);
      }
      row.status = patch.status;
    }
    if (patch.tags !== undefined) {
      if (!Array.isArray(patch.tags)) throw new BadRequestException('tags must be an array');
      row.tags = [...new Set(patch.tags.map((t) => String(t).trim()).filter(Boolean))];
    }
    if (patch.pinned !== undefined) row.pinned = Boolean(patch.pinned);

    await this.overrides.save(row);
    return this.get(id);
  }

  private async discovered(settings: Settings, force: boolean): Promise<DiscoveredProject[]> {
    const key = JSON.stringify([settings.roots, settings.ignore, settings.planFiles, settings.maxDepth,
      settings.useClaudeHistory, settings.includeScratch, settings.includeMissing]);
    const fresh = this.cache && this.cache.key === key && Date.now() - this.cache.at < CACHE_TTL_MS;
    if (fresh && !force) return this.cache!.data;
    if (!this.inflight) {
      this.inflight = this.discovery.discover(settings)
        .then((data) => {
          this.cache = { key, at: Date.now(), data };
          this.afterDiscovery(data);
          return data;
        })
        .finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  private toProject(d: DiscoveredProject, o: ProjectOverrideEntity | undefined, settings: Settings): ProjectDetail {
    const plan = summarize(d.milestones);
    const derived = deriveStatus(d, plan, settings);
    return {
      id: projectId(d.path),
      path: d.path,
      name: o?.name || d.name,
      tags: o?.tags ?? [],
      status: (o?.status as ProjectStatus | null) ?? derived,
      statusOverridden: Boolean(o?.status),
      ...plan,
      planFiles: d.planFiles,
      milestones: d.milestones,
      planWarnings: d.planWarnings,
      lastActivityAt: d.lastActivityAt?.toISOString() ?? null,
      source: d.source,
      pinned: o?.pinned ?? false,
      exists: d.exists,
      markers: d.markers,
      subpaths: d.subpaths,
      claudeSessions: d.claudeSessions,
    };
  }
}

function deriveStatus(d: DiscoveredProject, plan: PlanSummary, settings: Settings): ProjectStatus {
  if (!d.exists) return 'archived';
  if (plan.milestonesTotal > 0 && plan.milestonesReached === plan.milestonesTotal) return 'done';
  const last = d.lastActivityAt?.getTime() ?? 0;
  return Date.now() - last > settings.staleDays * DAY_MS ? 'paused' : 'active';
}
