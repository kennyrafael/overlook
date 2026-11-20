import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { EntityManager, In, Repository } from 'typeorm';
import type {
  ClaudeDay, ClaudeMilestoneCosts, ClaudeOverview, ClaudeSearchHit, ClaudeSession, ClaudeSessionDetail, ClaudeToolCount,
  ClaudeUsageWindow, TaskSessionRef, TokenUsage,
} from '@overlook/shared';
import { SettingsService } from '../config/settings.service';
import { claudeRoots } from '../discovery/claude-roots';
import { ProjectsService } from '../projects/projects.service';
import { localDay, mapLimit } from './limit';
import { taskMatcher } from './task-match';
import { LogParserPool } from './log-parser-pool';
import { ParseCacheEntity } from './parse-cache.entity';
import { PromptIndex, type IndexEntry, type SqlRunner } from './prompt-index';
import { relativeInside } from './session-detail';
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
const HOUR_MS = 3_600_000;
/** Search re-reads changed logs first unless that happened this recently (typing should not rescan every folder). */
const SEARCH_FRESH_MS = 10_000;
const WINDOWS: { key: ClaudeUsageWindow['key']; hours: number }[] = [{ key: '5h', hours: 5 }, { key: '7d', hours: 7 * 24 }];

function managerRunner(m: EntityManager): SqlRunner {
  return {
    query: (sql, params) => m.query(sql, params),
    transaction: (fn) => m.transaction((t) => fn(managerRunner(t))),
  };
}

const sortTools = (m: Map<string, ClaudeToolCount>) => [...m.values()].sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));

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
  private index: PromptIndex;
  /** Main session logs that have rows in the search index (null until loaded). */
  private indexed: Set<string> | null = null;
  /** Search rows of freshly parsed main logs, written with the next flush. */
  private pendingIndex = new Map<string, IndexEntry>();
  /** Set when writing the search index failed, so logs are not re-parsed for it again and again. */
  private indexBroken = false;
  /** Main log path → its session, from the last scan. */
  private sessionsByFile = new Map<string, SessionFiles>();
  private lastRefresh = 0;

  constructor(
    private projects: ProjectsService,
    private settings: SettingsService,
    @InjectRepository(ParseCacheEntity) private cache: Repository<ParseCacheEntity>,
  ) {
    this.index = new PromptIndex(managerRunner(cache.manager));
  }

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
      try {
        this.indexed = await this.index.files();
      } catch (e) {
        this.log.warn(`Search index unavailable: ${e}`);
        this.indexBroken = true;
      }
    })();
    return this.loaded;
  }

  /**
   * Writes new summaries and drops rows for deleted logs or older parser versions. The search index follows the
   * parse cache: a log's rows are replaced whenever it is parsed (so a PARSER_VERSION bump re-indexes everything)
   * and dropped with its cache row.
   */
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

    const entries = [...this.pendingIndex.values()];
    this.pendingIndex.clear();
    if (this.indexBroken || (!entries.length && !gone.length)) return;
    try {
      await this.index.replace(entries);
      await this.index.remove(gone);
      for (const e of entries) this.indexed?.add(e.file);
      for (const g of gone) this.indexed?.delete(g);
    } catch (e) {
      this.log.warn(`Could not update the search index: ${e}`);
      this.indexBroken = true;
    }
  }

  onApplicationBootstrap() {
    // Warm the cache in the background so the first page load is fast.
    setTimeout(() => {
      const t = Date.now();
      this.refresh().then(() => this.log.log(`Parsed Claude logs in ${Date.now() - t} ms`)).catch((e) => this.log.warn(`Warm-up failed: ${e}`));
    }, 500);
  }

  private async priceTable(): Promise<PriceTable> {
    const settings = await this.settings.get();
    return {
      prices: settings.modelPrices,
      cacheWrite5mMultiplier: settings.cacheWrite5mMultiplier,
      cacheWrite1hMultiplier: settings.cacheWrite1hMultiplier,
    };
  }

  async overview(q: ClaudeQuery): Promise<ClaudeOverview> {
    const sessions = await this.refresh();
    const [refs, table] = await Promise.all([this.projects.refs(), this.priceTable()]);
    const byDir = new Map<string, { id: string; name: string }>();
    for (const r of refs) for (const d of r.claudeDirs) byDir.set(d, { id: r.id, name: r.name });

    const inRange = (day: string) => (!q.from || day >= q.from) && (!q.to || day <= q.to);
    const wanted = q.projectIds?.length ? new Set(q.projectIds) : null;
    const matchers = await this.taskMatchers(wanted);

    const days = new Map<string, ClaudeDay>();
    const models = new Map<string, ClaudeOverview['byModel'][number]>();
    const projects = new Map<string, ClaudeOverview['byProject'][number]>();
    const tools = new Map<string, ClaudeToolCount>();
    const toolsOverall = { calls: 0, errors: 0 };
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
      const parts = [s.main, ...s.subagents].map((f) => this.files.get(f)?.summary).filter((x): x is LogSummary => !!x);
      const main = parts[0];
      if (!main) continue;
      const isWanted = !wanted || (!!project && wanted.has(project.id));

      // Tool counts: over all projects for the comparison figure, per tool for the selection.
      for (const p of parts) {
        for (const t of p.tools ?? []) {
          if (!inRange(t.day)) continue;
          toolsOverall.calls += t.calls;
          toolsOverall.errors += t.errors;
          if (!isWanted) continue;
          const x = tools.get(t.name) ?? tools.set(t.name, { tool: t.name, calls: 0, errors: 0 }).get(t.name)!;
          x.calls += t.calls;
          x.errors += t.errors;
        }
      }
      if (!isWanted) continue;

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
      byTool: sortTools(tools),
      toolsOverall,
      rolling: this.rolling(table),
    };
  }

  /**
   * Usage in the last 5 hours and 7 days over every log (main and subagent), from the hour buckets. An hour that
   * overlaps the window counts whole, so "5 hours" covers 5 to 6 hours of clock time.
   */
  private rolling(table: PriceTable, now = Date.now()): ClaudeUsageWindow[] {
    return WINDOWS.map(({ key, hours }) => {
      const from = Math.floor((now - hours * HOUR_MS) / HOUR_MS) * HOUR_MS;
      const w: ClaudeUsageWindow = { key, hours, from: new Date(from).toISOString(), turns: 0, tokens: { ...ZERO_TOKENS }, costUsd: 0, unpricedTurns: 0, byModel: [] };
      const models = new Map<string, ClaudeUsageWindow['byModel'][number]>();
      for (const { summary } of this.files.values()) {
        for (const h of summary.hours ?? []) {
          if (h.hour < from || h.hour > now) continue;
          const c = bucketCost(h, table);
          const t = bucketTokens(h);
          w.turns += h.turns;
          w.tokens = addTokens(w.tokens, t);
          w.costUsd += c ?? 0;
          if (c === null) w.unpricedTurns += h.turns;
          const m = models.get(h.model) ?? models.set(h.model, { model: h.model, turns: 0, tokens: { ...ZERO_TOKENS }, costUsd: 0, priced: c !== null }).get(h.model)!;
          m.turns += h.turns;
          m.tokens = addTokens(m.tokens, t);
          m.costUsd += c ?? 0;
        }
      }
      w.byModel = [...models.values()].sort((a, b) => b.costUsd - a.costUsd || b.turns - a.turns);
      return w;
    });
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

  /**
   * Estimated cost per milestone of the project: the sessions matched to one of its tasks (all time), summed.
   * Sessions that matched nothing are reported apart, so the split never looks more exact than it is.
   */
  async milestoneCosts(projectId: string): Promise<ClaudeMilestoneCosts> {
    const data = await this.overview({ projectIds: [projectId] });
    let milestones: { id: string; title: string; reached: boolean; tasks: { id: string }[] }[] = [];
    try { milestones = (await this.projects.detailed()).find((p) => p.id === projectId)?.milestones ?? []; } catch { /* no plan */ }
    const ofTask = new Map<string, string>();
    for (const m of milestones) for (const t of m.tasks) ofTask.set(t.id, m.id);
    const per = new Map<string, ClaudeMilestoneCosts['milestones'][number]>();
    const unmatched = { sessions: 0, costUsd: 0 };
    for (const s of data.sessions) {
      const mid = s.task ? ofTask.get(s.task.id) : undefined;
      const m = mid ? milestones.find((x) => x.id === mid) : undefined;
      if (!m) { unmatched.sessions++; unmatched.costUsd += s.costUsd; continue; }
      const row = per.get(m.id) ?? per.set(m.id, { id: m.id, title: m.title, reached: m.reached, sessions: 0, turns: 0, tokens: { ...ZERO_TOKENS }, costUsd: 0 }).get(m.id)!;
      row.sessions++;
      row.turns += s.turns;
      row.tokens = addTokens(row.tokens, s.tokens);
      row.costUsd += s.costUsd;
    }
    // Plan order.
    return { milestones: milestones.map((m) => per.get(m.id)).filter((x): x is NonNullable<typeof x> => !!x), unmatched };
  }

  /**
   * One session read on demand from its log (and its subagents' logs), streamed on the parser workers and not
   * cached: prompts, Claude's work per prompt, tools, edited files. Null when no claude root has `<id>.jsonl`.
   */
  async sessionDetail(id: string): Promise<ClaudeSessionDetail | null> {
    const s = await this.findSession(id);
    if (!s) return null;
    const [refs, table] = await Promise.all([this.projects.refs(), this.priceTable()]);
    const ref = refs.find((r) => r.claudeDirs.includes(s.dir)) ?? null;
    const [main, ...subs] = await Promise.all([s.main, ...s.subagents].map((f) => this.pool.run(f, 'detail')));
    const all = [main, ...subs];

    const totals = { prompts: main.summary.prompts, turns: 0, tokens: { ...ZERO_TOKENS }, costUsd: 0, unpricedTurns: 0, subagentCostUsd: 0 };
    const models = new Set<string>();
    all.forEach((d, i) => {
      for (const b of d.summary.buckets) {
        const c = bucketCost(b, table);
        totals.turns += b.turns;
        totals.tokens = addTokens(totals.tokens, bucketTokens(b));
        totals.costUsd += c ?? 0;
        if (i > 0) totals.subagentCostUsd += c ?? 0;
        if (c === null) totals.unpricedTurns += b.turns;
        models.add(b.model);
      }
    });

    const tools = new Map<string, ClaudeToolCount>();
    const edited = new Map<string, number>();
    const show = (p: string) => {
      const r = relativeInside(ref?.path, p);
      return r !== p ? r : relativeInside(main.summary.cwd, p);
    };
    for (const d of all) {
      for (const t of d.summary.tools) {
        const x = tools.get(t.name) ?? tools.set(t.name, { tool: t.name, calls: 0, errors: 0 }).get(t.name)!;
        x.calls += t.calls;
        x.errors += t.errors;
      }
      for (const e of d.edited) edited.set(show(e.path), (edited.get(show(e.path)) ?? 0) + e.edits);
    }

    const matcher = ref ? (await this.taskMatchers(new Set([ref.id]))).get(ref.id) : undefined;
    const started = main.summary.startedAt ?? 0;
    const ended = main.summary.endedAt ?? started;
    return {
      id: s.id,
      title: main.summary.title,
      projectId: ref?.id ?? null,
      projectName: ref?.name ?? OTHER_NAME,
      cwd: main.summary.cwd,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      durationMs: Math.max(0, ended - started),
      resumable: s.local,
      subagents: s.subagents.length,
      models: [...models].sort(),
      task: matcher?.(main.summary) ?? null,
      totals,
      prompts: main.prompts.map((p) => ({ at: new Date(p.at).toISOString(), text: p.text, truncated: p.truncated })),
      promptsOmitted: main.promptsOmitted,
      perPrompt: main.exchanges.map((e) => {
        let tokens: TokenUsage = { ...ZERO_TOKENS };
        let cost = 0;
        let turns = 0;
        for (const u of e.usage) {
          tokens = addTokens(tokens, bucketTokens(u));
          cost += bucketCost(u, table) ?? 0;
          turns += u.turns;
        }
        return { prompt: e.prompt, at: new Date(e.at).toISOString(), turns, tokens, costUsd: cost };
      }),
      tools: sortTools(tools),
      edited: [...edited].map(([path, edits]) => ({ path, edits })).sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path)),
    };
  }

  /** Sessions whose title or typed prompts match `q` (newest first, at most 50), optionally within some projects. */
  async search(q: string, projectIds?: string[]): Promise<ClaudeSearchHit[]> {
    if (Date.now() - this.lastRefresh > SEARCH_FRESH_MS) await this.refresh();
    else if (this.scanning) await this.scanning;
    if (this.indexBroken) return [];
    const refs = await this.projects.refs();
    const byDir = new Map<string, { id: string; name: string }>();
    for (const r of refs) for (const d of r.claudeDirs) byDir.set(d, { id: r.id, name: r.name });
    const dirs = projectIds?.length ? refs.filter((r) => projectIds.includes(r.id)).flatMap((r) => r.claudeDirs) : null;
    const hits = await this.index.search(q, dirs);
    return hits.map((h) => {
      const project = byDir.get(h.projectDir) ?? null;
      return {
        id: h.sessionId,
        title: this.files.get(h.file)?.summary.title ?? null,
        projectId: project?.id ?? null,
        projectName: project?.name ?? OTHER_NAME,
        endedAt: new Date(h.ended).toISOString(),
        matchedIn: h.matchedIn,
        at: new Date(h.at).toISOString(),
        snippet: h.snippet,
        resumable: this.sessionsByFile.get(h.file)?.local ?? false,
      };
    });
  }

  /** Re-reads any new or changed log files; returns the session file layout. */
  private async refresh(): Promise<SessionFiles[]> {
    await this.loadCache();
    const layout = await this.layout((await this.settings.get()).useWsl);
    if (!this.scanning) {
      const mains = new Map(layout.map((s) => [s.main, s]));
      this.sessionsByFile = mains;
      const all = layout.flatMap((s) => [s.main, ...s.subagents]);
      this.scanning = mapLimit(all, 4, (f) => this.parseIfChanged(f, mains.get(f))).then(async () => {
        const live = new Set(all);
        const gone: string[] = [];
        for (const k of this.files.keys()) if (!live.has(k)) { this.files.delete(k); gone.push(k); }
        // Index rows of logs that were deleted while the app was closed (no cache row to notice it by).
        const goneSet = new Set(gone);
        for (const k of this.indexed ?? []) if (!live.has(k) && !goneSet.has(k)) gone.push(k);
        await this.flush(gone).catch((e) => this.log.warn(`Could not save the parse cache: ${e}`));
        this.lastRefresh = Date.now();
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

  /** The session whose main log is `<id>.jsonl` in any project folder of any claude root. */
  private async findSession(id: string): Promise<SessionFiles | null> {
    for (const root of await claudeRoots((await this.settings.get()).useWsl)) {
      let dirs: string[] = [];
      try {
        dirs = (await readdir(root.dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => join(root.dir, d.name));
      } catch {
        continue;
      }
      for (const dir of dirs) {
        try {
          if (!(await stat(join(dir, `${id}.jsonl`))).isFile()) continue;
        } catch {
          continue;
        }
        let subagents: string[] = [];
        try {
          subagents = (await readdir(join(dir, id, 'subagents'))).filter((e) => e.endsWith('.jsonl')).map((e) => join(dir, id, 'subagents', e));
        } catch { /* no subagents */ }
        return { dir, id, main: join(dir, `${id}.jsonl`), subagents, local: root.label === 'local' };
      }
    }
    return null;
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

  /** Parses a log that is new or changed; a main log also when the search index has no rows for it yet. */
  private async parseIfChanged(file: string, session?: SessionFiles) {
    let st;
    try { st = await stat(file); } catch { return; }
    const cached = this.files.get(file);
    const forIndex = !!session && !this.indexBroken;
    if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs && (!forIndex || this.indexed?.has(file))) return;
    try {
      let summary: LogSummary;
      if (forIndex) {
        const r = await this.pool.run(file, 'index');
        summary = r.summary;
        this.pendingIndex.set(file, {
          file, sessionId: session.id, projectDir: session.dir, title: summary.title,
          startedAt: summary.startedAt, endedAt: summary.endedAt, prompts: r.prompts,
        });
      } else {
        summary = await this.pool.parse(file);
      }
      this.files.set(file, { size: st.size, mtimeMs: st.mtimeMs, summary });
      this.dirty.add(file);
      if (isUnrecognized(summary.format)) this.log.warn(`Unrecognized log format: ${file}`);
    } catch (e) {
      this.log.warn(`Could not read ${file}: ${e}`);
    }
  }
}
