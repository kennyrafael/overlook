import { Injectable, Logger } from '@nestjs/common';
import { stat } from 'fs/promises';
import { basename, dirname } from 'path';
import type { Milestone, ProjectDetail } from '@overlook/shared';
import { git, gitAvailable } from '../common/git';
import { lineRanges, parseBlamePorcelain } from './git-blame';

/** Lines per git blame call, so the command line stays short (Windows caps it at 32 K characters). */
const LINES_PER_CALL = 200;
const MAX_FILES_CACHED = 500;

interface Entry {
  mtimeMs: number;
  size: number;
  lines: Map<number, string | null>;
}

/**
 * When in-progress tasks were set in progress, from git: the author time of the checkbox line's
 * last commit (`git blame --porcelain`, read-only, GIT_OPTIONAL_LOCKS=0 via the git helper).
 * Uncommitted lines, untracked files and folders without git give null ("unknown", never stale).
 * Results are cached per file until its modification time or size changes.
 */
@Injectable()
export class PlanAgeService {
  private readonly log = new Logger(PlanAgeService.name);
  private cache = new Map<string, Entry>();

  /** Blame times for `lines` (1-based) of `file`. */
  async since(file: string, lines: number[]): Promise<Map<number, string | null>> {
    const out = new Map<number, string | null>();
    if (!lines.length) return out;
    let st: { mtimeMs: number; size: number };
    try { st = await stat(file); } catch { return out; }
    const key = file.toLowerCase();
    let entry = this.cache.get(key);
    if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
      entry = { mtimeMs: st.mtimeMs, size: st.size, lines: new Map() };
      this.cache.delete(key);
      if (this.cache.size >= MAX_FILES_CACHED) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, entry);
    }
    const missing = lines.filter((n) => !entry!.lines.has(n));
    if (missing.length) {
      const found = await this.blame(file, missing);
      for (const n of missing) entry.lines.set(n, found.get(n) ?? null);
    }
    for (const n of lines) out.set(n, entry.lines.get(n) ?? null);
    return out;
  }

  private async blame(file: string, lines: number[]): Promise<Map<number, string | null>> {
    const found = new Map<number, string | null>();
    if (!(await gitAvailable())) return found;
    for (let i = 0; i < lines.length; i += LINES_PER_CALL) {
      const ranges = lineRanges(lines.slice(i, i + LINES_PER_CALL));
      try {
        const out = await git(dirname(file), ['blame', '--porcelain', ...ranges, '--', basename(file)]);
        for (const [n, at] of parseBlamePorcelain(out)) found.set(n, at);
      } catch (e) {
        // Not a repository, an untracked file, or lines past the end after an edit: unknown.
        this.log.debug(`git blame skipped for ${file}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
        return found;
      }
    }
    return found;
  }

  /** A copy of the project whose in-progress tasks carry `inProgressSince`. */
  async annotate(project: ProjectDetail): Promise<ProjectDetail> {
    if (!project.exists) return project;
    const byFile = new Map<string, number[]>();
    for (const m of project.milestones) {
      for (const t of m.tasks) if (t.status === 'in_progress') byFile.set(t.file, [...(byFile.get(t.file) ?? []), t.line]);
    }
    if (!byFile.size) return project;
    const times = new Map<string, Map<number, string | null>>();
    await Promise.all([...byFile].map(async ([file, lines]) => times.set(file, await this.since(file, lines))));
    const milestones: Milestone[] = project.milestones.map((m) => (m.tasksInProgress
      ? { ...m, tasks: m.tasks.map((t) => (t.status === 'in_progress' ? { ...t, inProgressSince: times.get(t.file)?.get(t.line) ?? null } : t)) }
      : m));
    return { ...project, milestones };
  }
}
