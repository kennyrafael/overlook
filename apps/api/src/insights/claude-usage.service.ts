import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { In, Repository } from 'typeorm';
import type { ClaudeDay, ClaudeOverview, ClaudeSession, TaskSessionRef, TokenUsage } from '@overlook/shared';
import { SettingsService } from '../config/settings.service';
import { claudeRoots } from '../discovery/claude-roots';
import { ProjectsService } from '../projects/projects.service';
import { localDay, mapLimit } from './limit';
import { taskMatcher } from './task-match';
import { LogParserPool } from './log-parser-pool';
import { ParseCacheEntity } from './parse-cache.entity';
import { PARSER_VERSION, isUnrecognized, LogSummary, PriceTable, UsageBucket, ZERO_TOKENS, addTokens, bucketCost, bucketTokens } from './session-log';

interface CachedFile { size: number; mtimeMs: number; summary: LogSummary }

interface SessionFiles {
  /** Absolute session folder path (matches ProjectRef.claudeDirs). */
  dir: string;
  id: string;
  main: string;
  subagents: string[];
  /** Logged on this machine (not inside WSL), so `claude --resume` can continue it here. */
  local: boolean;
}

export interface ClaudeQuery {
  from?: string; // YYYY-MM-DD inclusive
  to?: string;   // YYYY-MM-DD inclusive
  projectIds?: string[];
}

const OTHER_NAME = 'Other (not a project)';

/**
 * Token usage and cost estimates from Claude Code session logs (~/.claude/projects).
 * Files are parsed in a streaming fashion and cached by size + mtime, so only
 * new or changed sessions are re-read.
 */
@Injectable()
export class ClaudeUsageService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ClaudeUsageService.name);
  private files = new Map<string, CachedFile>();
  private scanning: Promise<void> | null = null;
  private loaded: Promise<void> | null = null;
  private pool = new LogParserPool(2);
  /** Parsed summaries not yet written to SQLite. */
  private dirty = new Set<string>();

  constructor(
    private projects: ProjectsService,
    private settings: SettingsService,
    @InjectRepository(ParseCacheEntity) private cache: Repository<ParseCacheEntity>,
  ) {}

  async onModuleDestroy() {
    await this.pool.close();
    await this.flush().catch(() => undefined);
  }

  /** Loads the persisted parse cache once, so a restart does not re-read unchanged logs. */
  private loadCache(): Promise<void> {
    this.loaded ??= (async () => {
      const t = Date.now();
      try {
        for (const r of await this.cache.findBy({ version: PARSER_VERSION })) {
          try { this.files.set(r.file, { size: r.size, mtimeMs: r.mtimeMs, summary: JSON.parse(r.summary) }); } catch { /* re-parse */ }
        }
        this.log.log(`Loaded ${this.files.size} cached log summaries in ${Date.now() - t} ms`);
      } catch (e) {
        this.log.warn(`Could not load the parse cache: ${e}`);
      }
    })();
    return this.loaded;
  }

  /** Writes new summaries and drops rows for deleted logs or older parser versions. */
  private async flush(gone: string[] = []) {
    const files = [...this.dirty];
    this.dirty.clear();
    const rows = files.flatMap((f) => {
      const c = this.files.get(f);
      return c ? [{ file: f, size: c.size, mtimeMs: c.mtimeMs, version: PARSER_VERSION, summary: JSON.stringify(c.summary) }] : [];
    });
    for (let i = 0; i < rows.length; i += 200) await this.cache.save(rows.slice(i, i + 200));
    for (let i = 0; i < gone.length; i += 500) await this.cache.delete({ file: In(gone.slice(i, i + 500)) });
    await this.cache.createQueryBuilder().delete().where('version != :v', { v: PARSER_VERSION }).execute();
  }

  onApplicationBootstrap() {
    // Warm the cache in the background so the first page load is fast.
    setTimeout(() => {
      const t = Date.now();
      this.refresh().then(() => this.log.log(`Parsed Claude logs in ${Date.now() - t} ms`)).catch((e) => this.log.warn(`Warm-up failed: ${e}`));
    }, 500);
  }

  async overview(q: ClaudeQuery): Promise<ClaudeOverview> {
    const sessions = await this.refresh();
    const [refs, settings] = await Promise.all([this.projects.refs(), this.settings.get()]);
    const table: PriceTable = {
      prices: settings.modelPrices,
      cacheWrite5mMultiplier: settings.cacheWrite5mMultiplier,
      cacheWrite1hMultiplier: settings.cacheWrite1hMultiplier,
    };
    const byDir = new Map<string, { id: string; name: string }>();
    for (const r of refs) for (const d of r.claudeDirs) byDir.set(d, { id: r.id, name: r.name });

    const inRange = (day: string) => (!q.from || day >= q.from) && (!q.to || day <= q.to);
    const wanted = q.projectIds?.length ? new Set(q.projectIds) : null;
    const matchers = await this.taskMatchers(wanted);

    const days = new Map<string, ClaudeDay>();
    const models = new Map<string, ClaudeOverview['byModel'][number]>();
    const projects = new Map<string, ClaudeOverview['byProject'][number]>();
    const outSessions: ClaudeSession[] = [];
    let unrecognized = 0;
    const unrecognizedExamples: string[] = [];
    for (const [file, c] of this.files) {
      if (c.summary.format && isUnrecognized(c.summary.format)) {
        unrecognized++;
        if (unrecognizedExamples.length < 3) unrecognizedExamples.push(file);
      }
    }
    const totals = { sessions: 0, prompts: 0, turns: 0, tokens: { ...ZERO_TOKENS }, costUsd: 0, unpricedTurns: 0 };
    const dayOf = (d: string) => days.get(d) ?? days.set(d, { date: d, sessions: 0, turns: 0, tokens: { ...ZERO_TOKENS }, costUsd: 0, costByModel: {} }).get(d)!;

    for (const s of sessions) {
      const project = byDir.get(s.dir) ?? null;
      if (wanted && (!project || !wanted.has(project.id))) continue;

      const parts = [s.main, ...s.subagents].map((f) => this.files.get(f)?.summary).filter((x): x is LogSummary => !!x);
      const main = parts[0];
      if (!main) continue;
      const buckets: UsageBucket[] = parts.flatMap((p) => p.buckets).filter((b) => inRange(b.day));
      const prompts = Object.entries(main.promptDays).filter(([d]) => inRange(d)).reduce((n, [, c]) => n + c, 0);
      if (!buckets.length && !prompts) continue;

      let tokens: TokenUsage = { ...ZERO_TOKENS };
      let cost = 0;
      let turns = 0;
      const sessionDays = new Set<string>();
      const sessionModels = new Set<string>();
      for (const b of buckets) {
        const c = bucketCost(b, table);
        const t = bucketTokens(b);
        tokens = addTokens(tokens, t);
        cost += c ?? 0;
        turns += b.turns;
        sessionDays.add(b.day);
        sessionModels.add(b.model);
        if (c === null) totals.unpricedTurns += b.turns;

        const day = dayOf(b.day);
        day.turns += b.turns;
        day.tokens = addTokens(day.tokens, t);
        day.costUsd += c ?? 0;
        day.costByModel[b.model] = (day.costByModel[b.model] ?? 0) + (c ?? 0);

        const m = models.get(b.model) ?? { model: b.model, turns: 0, tokens: { ...ZERO_TOKENS }, costUsd: 0, priced: c !== null };
        m.turns += b.turns;
        m.tokens = addTokens(m.tokens, t);
        m.costUsd += c ?? 0;
        models.set(b.model, m);
      }
      for (const d of sessionDays) dayOf(d).sessions += 1;

      const key = project?.id ?? '__other__';
      const p = projects.get(key) ?? { projectId: project?.id ?? null, name: project?.name ?? OTHER_NAME, sessions: 0, turns: 0, tokens: { ...ZERO_TOKENS }, costUsd: 0, lastActivityAt: null };
      p.sessions += 1;
      p.turns += turns;
      p.tokens = addTokens(p.tokens, tokens);
      p.costUsd += cost;
      const ended = main.endedAt ? new Date(main.endedAt).toISOString() : null;
      if (ended && (!p.lastActivityAt || ended > p.lastActivityAt)) p.lastActivityAt = ended;
      projects.set(key, p);

      totals.sessions += 1;
      totals.prompts += prompts;
      totals.turns += turns;
      totals.tokens = addTokens(totals.tokens, tokens);
      totals.costUsd += cost;

      outSessions.push({
        id: s.id,
        projectId: project?.id ?? null,
        projectName: project?.name ?? OTHER_NAME,
        title: main.title,
        startedAt: new Date(main.startedAt ?? 0).toISOString(),
        endedAt: new Date(main.endedAt ?? main.startedAt ?? 0).toISOString(),
        prompts,
        turns,
        subagents: s.subagents.length,
        models: [...sessionModels].sort(),
        tokens,
        costUsd: cost,
        task: project ? matchers.get(project.id)?.(main) ?? null : null,
        resumable: s.local,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      from: q.from ?? null,
      to: q.to ?? null,
      totals,
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byModel: [...models.values()].sort((a, b) => b.costUsd - a.costUsd || b.turns - a.turns),
      byProject: [...projects.values()].sort((a, b) => b.costUsd - a.costUsd),
      sessions: outSessions.sort((a, b) => b.endedAt.localeCompare(a.endedAt)),
      logFormat: { files: this.files.size, unrecognizedFiles: unrecognized, examples: unrecognizedExamples },
    };
  }

  /**
   * Per project: a function from a session's summary to the plan task it most likely worked on (any status;
   * matched on its title and sampled prompts, the same rules as the live suggestion).
   */
  private async taskMatchers(wanted: Set<string> | null) {
    const out = new Map<string, (s: LogSummary) => { id: string; text: string } | null>();
    let projects;
    try { projects = await this.projects.detailed(); } catch { return out; }
    for (const p of projects) {
      if (wanted && !wanted.has(p.id)) continue;
      const tasks = p.milestones.flatMap((m) => m.tasks).map((t) => ({ id: t.id, text: t.text }));
      if (!tasks.length) continue;
      const match = taskMatcher(tasks, tasks);
      const byId = new Map(tasks.map((t) => [t.id, t]));
      out.set(p.id, (s) => {
        const m = match([s.title ?? '', ...(s.promptSample ?? [])].join('\n'));
        return m ? byId.get(m.taskId) ?? null : null;
      });
    }
    return out;
  }

  /** Task id → the sessions of the last `days` days that worked on it, newest first (at most 5 per task). */
  async taskSessions(projectId: string, days = 90): Promise<Record<string, TaskSessionRef[]>> {
    const from = localDay(new Date(Date.now() - days * 86_400_000));
    const data = await this.overview({ from, projectIds: [projectId] });
    const out: Record<string, TaskSessionRef[]> = {};
    for (const s of data.sessions) {
      if (!s.task) continue;
      const list = (out[s.task.id] ??= []);
      if (list.length < 5) list.push({ id: s.id, title: s.title, endedAt: s.endedAt, resumable: s.resumable });
    }
    return out;
  }

  /** Re-reads any new or changed log files; returns the session file layout. */
  private async refresh(): Promise<SessionFiles[]> {
    await this.loadCache();
    const layout = await this.layout((await this.settings.get()).useWsl);
    if (!this.scanning) {
      const all = layout.flatMap((s) => [s.main, ...s.subagents]);
      this.scanning = mapLimit(all, 4, (f) => this.parseIfChanged(f)).then(async () => {
        const live = new Set(all);
        const gone: string[] = [];
        for (const k of this.files.keys()) if (!live.has(k)) { this.files.delete(k); gone.push(k); }
        await this.flush(gone).catch((e) => this.log.warn(`Could not save the parse cache: ${e}`));
      }).finally(() => { this.scanning = null; });
    }
    await this.scanning;
    return layout;
  }

  private async layout(includeWsl: boolean): Promise<SessionFiles[]> {
    const out: SessionFiles[] = [];
    for (const root of await claudeRoots(includeWsl)) {
      let dirs: string[] = [];
      try {
        dirs = (await readdir(root.dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => join(root.dir, d.name));
      } catch {
        continue;
      }
      out.push(...await this.sessionsIn(dirs, root.label === 'local'));
    }
    return out;
  }

  private async sessionsIn(dirs: string[], local: boolean): Promise<SessionFiles[]> {
    const out: SessionFiles[] = [];
    for (const dir of dirs) {
      let entries: string[];
      try { entries = await readdir(dir); } catch { continue; }
      for (const f of entries.filter((e) => e.endsWith('.jsonl'))) {
        const id = f.slice(0, -'.jsonl'.length);
        let subagents: string[] = [];
        try {
          subagents = (await readdir(join(dir, id, 'subagents'))).filter((e) => e.endsWith('.jsonl')).map((e) => join(dir, id, 'subagents', e));
        } catch { /* no subagents */ }
        out.push({ dir, id, main: join(dir, f), subagents, local });
      }
    }
    return out;
  }

  private async parseIfChanged(file: string) {
    let st;
    try { st = await stat(file); } catch { return; }
    const cached = this.files.get(file);
    if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return;
    try {
      const summary = await this.pool.parse(file);
      this.files.set(file, { size: st.size, mtimeMs: st.mtimeMs, summary });
      this.dirty.add(file);
      if (isUnrecognized(summary.format)) this.log.warn(`Unrecognized log format: ${file}`);
    } catch (e) {
      this.log.warn(`Could not read ${file}: ${e}`);
    }
  }
}
