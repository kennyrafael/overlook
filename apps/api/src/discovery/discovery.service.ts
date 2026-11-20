import { Injectable } from '@nestjs/common';
import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { basename, join } from 'path';
import { Milestone, PlanWarning, ProjectSource, Settings } from '@overlook/shared';
import { PlansService } from '../plans/plans.service';
import { ClaudeHistoryReader } from './claude-history.reader';
import { RootScanner, projectMarkers } from './root-scanner';
import { isInside, isScratchWorkspace, pathKey, stripWorktree } from './path-utils';

export interface DiscoveredProject {
  path: string;
  name: string;
  source: ProjectSource;
  exists: boolean;
  markers: string[];
  subpaths: string[];
  claudeSessions: number;
  lastActivityAt: Date | null;
  milestones: Milestone[];
  planFiles: string[];
  planWarnings: PlanWarning[];
  /** Claude session folders (absolute paths, local or WSL) that belong to this project. */
  claudeDirs: string[];
}

/** Merges root-folder scan with Claude Code history into one project list. */
@Injectable()
export class DiscoveryService {
  constructor(private scanner: RootScanner, private history: ClaudeHistoryReader, private plans: PlansService) {}

  async discover(settings: Settings): Promise<DiscoveredProject[]> {
    const byKey = new Map<string, DiscoveredProject>();

    const scanned = await this.scanner.scan(settings.roots, settings);
    for (const s of scanned) {
      byKey.set(pathKey(s.path), {
        path: s.path,
        name: basename(s.path),
        source: 'root',
        exists: true,
        markers: s.markers,
        subpaths: s.subpaths,
        claudeSessions: 0,
        lastActivityAt: null,
        milestones: [],
        planFiles: [],
        planWarnings: [],
        claudeDirs: [],
      });
    }

    if (settings.useClaudeHistory) {
      // Shortest paths first so parents exist before children get folded in.
      const entries = (await this.history.read(settings.useWsl)).sort((a, b) => a.path.length - b.path.length);
      for (const e of entries) {
        if (!settings.includeScratch && isScratchWorkspace(e.path)) continue;
        const path = stripWorktree(e.path);
        const parent = [...byKey.values()].find((p) => isInside(path, p.path));
        if (parent) {
          if (parent.source === 'root') parent.source = 'both';
          parent.claudeSessions += e.sessions;
          parent.claudeDirs.push(e.dir);
          if (pathKey(path) !== pathKey(parent.path) && !parent.subpaths.some((s) => pathKey(s) === pathKey(path))) {
            parent.subpaths.push(path);
          }
          parent.lastActivityAt = latest(parent.lastActivityAt, e.lastActivityAt);
          continue;
        }
        const exists = existsSync(path);
        if (!exists && !settings.includeMissing) continue;
        byKey.set(pathKey(path), {
          path,
          name: basename(path),
          source: 'claude',
          exists,
          markers: [],
          subpaths: [],
          claudeSessions: e.sessions,
          lastActivityAt: e.lastActivityAt,
          milestones: [],
          planFiles: [],
          planWarnings: [],
          claudeDirs: [e.dir],
        });
      }
    }

    const projects = [...byKey.values()];
    await Promise.all(projects.map((p) => this.enrich(p, settings)));
    return projects;
  }

  /** Last activity = newest of Claude sessions, git index/HEAD log, and plan files. */
  private async enrich(p: DiscoveredProject, settings: Settings) {
    if (!p.exists) return;
    const candidates = [join('.git', 'index'), join('.git', 'logs', 'HEAD'), ...settings.planFiles];
    for (const base of [p.path, ...p.subpaths]) {
      for (const rel of candidates) {
        try {
          const m = (await stat(join(base, rel))).mtime;
          p.lastActivityAt = latest(p.lastActivityAt, m);
        } catch { /* not present */ }
      }
    }
    const plan = await this.plans.milestonesFor(p.path, p.subpaths, settings.planFiles);
    p.milestones = plan.milestones;
    p.planFiles = plan.files;
    p.planWarnings = plan.warnings;
    if (!p.markers.length) {
      p.markers = projectMarkers(settings.planFiles).filter((m) => existsSync(join(p.path, m)));
    }
  }
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
