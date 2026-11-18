import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { existsSync } from 'fs';
import { join, relative } from 'path';
import type { GitOverview, ProjectGit, RepoStats } from '@overlook/shared';
import { ProjectRef, ProjectsService } from '../projects/projects.service';
import { mapLimit } from './limit';
import { git, gitAvailable } from '../common/git';

const DAYS = 90;
const CACHE_TTL_MS = 60_000;
/** Parses the first line of `git status --porcelain=v1 -b`. */
export function parseBranchLine(line: string): Pick<RepoStats, 'branch' | 'upstream' | 'ahead' | 'behind'> {
  // "## main...origin/main [ahead 1, behind 2]" | "## main" | "## HEAD (no branch)" | "## No commits yet on main"
  const body = line.replace(/^## /, '');
  const noCommits = /^No commits yet on (.+)$/.exec(body);
  if (noCommits) return { branch: noCommits[1], upstream: null, ahead: 0, behind: 0 };
  if (body.startsWith('HEAD (no branch)')) return { branch: null, upstream: null, ahead: 0, behind: 0 };
  const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(body);
  const branch = m?.[1] ?? null;
  const upstream = m?.[2] ?? null;
  const ahead = Number(/ahead (\d+)/.exec(m?.[3] ?? '')?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(m?.[3] ?? '')?.[1] ?? 0);
  return { branch, upstream, ahead, behind };
}

/** The git repositories inside each project (its folder and nested repos, excluding worktrees). */
export function repoJobs(refs: ProjectRef[]): { projectId: string; root: string; path: string }[] {
  const jobs: { projectId: string; root: string; path: string }[] = [];
  for (const r of refs) {
    for (const p of [r.path, ...r.subpaths]) {
      // Worktrees are other checkouts of the same repo; their history is already counted.
      if (/[\\/]\.claude[\\/]worktrees[\\/]/i.test(p)) continue;
      if (existsSync(join(p, '.git'))) jobs.push({ projectId: r.id, root: r.path, path: p });
    }
  }
  return jobs;
}

/** Read-only git statistics for every repository inside each project. */
@Injectable()
export class GitService implements OnApplicationBootstrap {
  private readonly log = new Logger(GitService.name);

  onApplicationBootstrap() {
    // git is slow to start on Windows; warm the cache so the first page load is quick.
    setTimeout(() => { this.overview().catch((e) => this.log.warn(`Warm-up failed: ${e}`)); }, 1000);
  }
  private cache: { at: number; data: GitOverview } | null = null;
  private inflight: Promise<GitOverview> | null = null;

  async overview(force = false): Promise<GitOverview> {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.data;
    if (!this.inflight) {
      this.inflight = this.compute()
        .then((data) => { this.cache = { at: Date.now(), data }; return data; })
        .finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  /** Re-reads one project's repositories and patches the cache. Returns true if anything changed. */
  async refreshProject(projectId: string): Promise<boolean> {
    if (!this.cache?.data.gitAvailable) return false; // nothing cached yet (or no git); the next overview() computes everything
    const ref = (await this.projects.refs()).find((r) => r.id === projectId && r.exists);
    if (!ref) return false;
    const repos = await mapLimit(repoJobs([ref]), 4, (j) => this.repo(j.path, j.root));
    const before = this.cache.data.projects.find((p) => p.projectId === projectId);
    const changed = JSON.stringify(before?.repos ?? []) !== JSON.stringify(repos);
    const others = this.cache.data.projects.filter((p) => p.projectId !== projectId);
    const projects = repos.length ? [...others, { projectId, name: ref.name, repos }] : others;
    this.cache = { at: this.cache.at, data: { ...this.cache.data, generatedAt: new Date().toISOString(), projects } };
    return changed;
  }

  /** Recomputes everything; returns the ids of projects whose git state changed. */
  async poll(): Promise<string[]> {
    const before = new Map((this.cache?.data.projects ?? []).map((p) => [p.projectId, JSON.stringify(p.repos)]));
    const after = await this.overview(true);
    return after.projects.filter((p) => before.get(p.projectId) !== JSON.stringify(p.repos)).map((p) => p.projectId);
  }

  private async compute(): Promise<GitOverview> {
    if (!(await gitAvailable())) return { generatedAt: new Date().toISOString(), days: DAYS, gitAvailable: false, projects: [] };
    const refs = (await this.projects.refs()).filter((r) => r.exists);
    const jobs = repoJobs(refs);
    const stats = await mapLimit(jobs, 6, (j) => this.repo(j.path, j.root));
    const projects: ProjectGit[] = refs
      .map((r) => ({ projectId: r.id, name: r.name, repos: stats.filter((_, i) => jobs[i].projectId === r.id) }))
      .filter((p) => p.repos.length > 0);
    return { generatedAt: new Date().toISOString(), days: DAYS, gitAvailable: true, projects };
  }

  private async repo(path: string, root: string): Promise<RepoStats> {
    const base: RepoStats = {
      path, relPath: relative(root, path), branch: null, upstream: null, ahead: 0, behind: 0,
      dirtyFiles: 0, lastCommitAt: null, lastCommitSubject: null, commitsPerDay: {},
    };
    try {
      const [status, log, last] = await Promise.all([
        git(path, ['status', '--porcelain=v1', '-b', '--untracked-files=normal']),
        git(path, ['log', `--since=${DAYS}.days.ago`, '--date=format-local:%Y-%m-%d', '--format=%ad']).catch(() => ''),
        git(path, ['log', '-1', '--format=%cI%x09%s']).catch(() => ''),
      ]);
      const lines = status.split('\n').filter(Boolean);
      if (lines[0]?.startsWith('## ')) Object.assign(base, parseBranchLine(lines.shift()!));
      base.dirtyFiles = lines.length;
      for (const day of log.split('\n').filter(Boolean)) base.commitsPerDay[day] = (base.commitsPerDay[day] ?? 0) + 1;
      const [at, ...subject] = last.trim().split('\t');
      if (at) {
        base.lastCommitAt = new Date(at).toISOString();
        base.lastCommitSubject = subject.join('\t') || null;
      }
    } catch (e) {
      base.error = e instanceof Error ? e.message.split('\n')[0] : String(e);
      this.log.warn(`git failed in ${path}: ${base.error}`);
    }
    return base;
  }

  constructor(private projects: ProjectsService) {}
}
