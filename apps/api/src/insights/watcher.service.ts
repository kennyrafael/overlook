import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { FSWatcher, watch } from 'chokidar';
import { existsSync } from 'fs';
import { basename, dirname, join, relative, sep } from 'path';
import { Subscription } from 'rxjs';
import { SettingsService } from '../config/settings.service';
import { claudeProjectsDir } from '../discovery/claude-history.reader';
import { pathKey } from '../discovery/path-utils';
import { EventsService } from '../events/events.service';
import { ProjectsService } from '../projects/projects.service';
import { GitService, repoJobs } from './git.service';

const PLAN_DEBOUNCE_MS = 300;
const GIT_DEBOUNCE_MS = 1500;
const CLAUDE_DEBOUNCE_MS = 5000;
const CLAUDE_MAX_WAIT_MS = 20_000;
const GIT_POLL_MS = 3 * 60_000;

/** Debounces calls per key; `maxWait` forces a flush during continuous activity. */
class Debouncer {
  private timers = new Map<string, { t: NodeJS.Timeout; first: number }>();
  constructor(private wait: number, private maxWait = Infinity) {}
  run(key: string, fn: () => void) {
    const prev = this.timers.get(key);
    const first = prev?.first ?? Date.now();
    if (prev) clearTimeout(prev.t);
    const delay = Math.max(0, Math.min(this.wait, first + this.maxWait - Date.now()));
    const t = setTimeout(() => { this.timers.delete(key); fn(); }, delay);
    this.timers.set(key, { t, first });
  }
  clear() { for (const { t } of this.timers.values()) clearTimeout(t); this.timers.clear(); }
}

/**
 * Watches plan files, git metadata and Claude session logs, refreshes the
 * affected caches and pushes events to open pages.
 */
@Injectable()
export class WatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(WatcherService.name);
  private watchers: FSWatcher[] = [];
  private sub?: Subscription;
  private poll?: NodeJS.Timeout;
  private planDebounce = new Debouncer(PLAN_DEBOUNCE_MS);
  private gitDebounce = new Debouncer(GIT_DEBOUNCE_MS);
  private claudeDebounce = new Debouncer(CLAUDE_DEBOUNCE_MS, CLAUDE_MAX_WAIT_MS);
  private pendingClaude = new Set<string>();
  private starting: Promise<void> | null = null;

  constructor(
    private projects: ProjectsService,
    private settings: SettingsService,
    private git: GitService,
    private events: EventsService,
  ) {}

  onApplicationBootstrap() {
    this.sub = this.events.stream.subscribe((e) => {
      if (e.type === 'projects:rescanned') this.restart();
    });
    setTimeout(() => this.restart(), 1500);
    this.poll = setInterval(() => {
      this.git.poll()
        .then((ids) => { if (ids.length) this.events.emit({ type: 'git:updated', projectIds: ids }); })
        .catch((e) => this.log.warn(`git poll failed: ${e}`));
    }, GIT_POLL_MS);
  }

  async onModuleDestroy() {
    this.sub?.unsubscribe();
    if (this.poll) clearInterval(this.poll);
    await this.stop();
  }

  private restart() {
    // Serialize restarts; a rescan during start-up waits for it to finish.
    this.starting = (this.starting ?? Promise.resolve())
      .then(() => this.stop())
      .then(() => this.start())
      .catch((e) => this.log.warn(`Watcher start failed: ${e}`));
  }

  private async stop() {
    const ws = this.watchers;
    this.watchers = [];
    this.planDebounce.clear();
    this.gitDebounce.clear();
    this.claudeDebounce.clear();
    await Promise.all(ws.map((w) => w.close().catch(() => undefined)));
  }

  private async start() {
    const [refs, settings] = await Promise.all([this.projects.refs(), this.settings.get()]);
    const live = refs.filter((r) => r.exists);
    const planNames = new Set(settings.planFiles.map((f) => f.toLowerCase()));

    // Plan files: watch each project folder and included folder, one level deep.
    const dirOwner = new Map<string, string>();
    for (const r of live) for (const d of [r.path, ...r.subpaths]) if (existsSync(d)) dirOwner.set(pathKey(d), r.id);
    if (dirOwner.size) {
      const w = watch([...new Set(live.flatMap((r) => [r.path, ...r.subpaths]).filter(existsSync))], {
        depth: 0, ignoreInitial: true, ignorePermissionErrors: true,
        ignored: (p, stats) => !!stats?.isFile() && !planNames.has(basename(p).toLowerCase()),
      });
      w.on('all', (_evt, file) => {
        if (!planNames.has(basename(file).toLowerCase())) return;
        const id = dirOwner.get(pathKey(dirname(file)));
        if (!id) return;
        this.planDebounce.run(id, () => this.onPlanChange(id, file));
      });
      w.on('error', (e) => this.log.warn(`plan watcher: ${e}`));
      this.watchers.push(w);
    }

    // Git: HEAD, index, reflog and remote refs of each repository.
    const gitOwner = new Map<string, string>();
    const gitPaths: string[] = [];
    for (const j of repoJobs(live)) {
      const gitDir = join(j.path, '.git');
      for (const p of ['HEAD', 'index', join('logs', 'HEAD'), join('refs', 'remotes')].map((x) => join(gitDir, x))) {
        if (existsSync(p)) gitPaths.push(p);
      }
      gitOwner.set(pathKey(gitDir), j.projectId);
    }
    if (gitPaths.length) {
      const w = watch(gitPaths, { ignoreInitial: true, ignorePermissionErrors: true, depth: 3 });
      w.on('all', (_evt, file) => {
        const key = pathKey(file);
        const owner = [...gitOwner.entries()].find(([g]) => key.startsWith(g + sep.toLowerCase()) || key.startsWith(g + sep))?.[1];
        if (owner) this.gitDebounce.run(owner, () => this.onGitChange(owner));
      });
      w.on('error', (e) => this.log.warn(`git watcher: ${e}`));
      this.watchers.push(w);
    }

    // Claude session logs.
    const root = claudeProjectsDir();
    const claudeOwner = new Map<string, string>();
    for (const r of refs) for (const d of r.claudeDirs) claudeOwner.set(d.toLowerCase(), r.id);
    if (existsSync(root)) {
      const w = watch(root, {
        depth: 3, ignoreInitial: true, ignorePermissionErrors: true,
        ignored: (p, stats) => !!stats?.isFile() && !p.endsWith('.jsonl'),
      });
      w.on('all', (_evt, file) => {
        if (!file.endsWith('.jsonl')) return;
        const dir = relative(root, file).split(sep)[0]?.toLowerCase();
        this.pendingClaude.add(claudeOwner.get(dir) ?? '');
        this.claudeDebounce.run('claude', () => {
          const ids = [...this.pendingClaude].filter(Boolean);
          this.pendingClaude.clear();
          this.events.emit({ type: 'claude:updated', projectIds: ids });
        });
      });
      w.on('error', (e) => this.log.warn(`claude watcher: ${e}`));
      this.watchers.push(w);
    }

    this.log.log(`Watching ${dirOwner.size} project folders, ${gitPaths.length} git paths, Claude logs: ${existsSync(root)}`);
  }

  private async onPlanChange(projectId: string, file: string) {
    if (await this.events.isOwnWrite(file)) return;
    try {
      const p = await this.projects.refreshPlans(projectId);
      this.events.emit({ type: 'project:updated', projectId, file: relative(p.path, file), source: 'external' });
    } catch (e) {
      this.log.warn(`Refresh after plan change failed: ${e}`);
    }
  }

  private async onGitChange(projectId: string) {
    try {
      if (await this.git.refreshProject(projectId)) this.events.emit({ type: 'git:updated', projectIds: [projectId] });
    } catch (e) {
      this.log.warn(`Refresh after git change failed: ${e}`);
    }
  }
}
