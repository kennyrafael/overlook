import { Injectable, Logger } from '@nestjs/common';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { normalizePath } from './path-utils';

export interface ScannedFolder {
  path: string;
  markers: string[];
  /** Nested folders with their own markers (sub-repos), folded into this project. */
  subpaths: string[];
}

const PROJECT_MARKERS = ['.git', 'CLAUDE.md', '.claude'];

/** Marker file names (case-insensitively de-duplicated) that identify a project folder. */
export function projectMarkers(planFiles: string[]): string[] {
  const seen = new Set<string>();
  return [...PROJECT_MARKERS, ...planFiles].filter((m) => {
    const k = m.toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/**
 * Walks each root. The outermost folder with a marker (.git, CLAUDE.md, .claude
 * or a plan file) is a project; marked folders below it are recorded as subpaths.
 */
@Injectable()
export class RootScanner {
  private readonly log = new Logger(RootScanner.name);

  async scan(roots: string[], opts: { ignore: string[]; planFiles: string[]; maxDepth: number }): Promise<ScannedFolder[]> {
    const ignore = new Set(opts.ignore.map((i) => i.toLowerCase()));
    const markerNames = projectMarkers(opts.planFiles);
    const results: ScannedFolder[] = [];

    for (const raw of roots) {
      const root = normalizePath(raw);
      try {
        if (!(await stat(root)).isDirectory()) continue;
      } catch {
        this.log.warn(`Root not found: ${root}`);
        continue;
      }
      // The root itself is a container, not a project: start from its children.
      for (const child of await this.subdirs(root, ignore)) {
        await this.walk(child, 1, opts.maxDepth, ignore, markerNames, results);
      }
    }
    return results;
  }

  private async walk(dir: string, depth: number, maxDepth: number, ignore: Set<string>, markers: string[], out: ScannedFolder[]) {
    const found = await this.markersIn(dir, markers);
    if (found.length) {
      const subpaths: string[] = [];
      await this.collectNested(dir, 1, 2, ignore, markers, subpaths);
      out.push({ path: dir, markers: found, subpaths });
      return;
    }
    if (depth >= maxDepth) return;
    for (const child of await this.subdirs(dir, ignore)) {
      await this.walk(child, depth + 1, maxDepth, ignore, markers, out);
    }
  }

  private async collectNested(dir: string, depth: number, maxDepth: number, ignore: Set<string>, markers: string[], out: string[]) {
    for (const child of await this.subdirs(dir, ignore)) {
      if ((await this.markersIn(child, markers)).length) out.push(child);
      if (depth < maxDepth) await this.collectNested(child, depth + 1, maxDepth, ignore, markers, out);
    }
  }

  private async markersIn(dir: string, markers: string[]): Promise<string[]> {
    try {
      const names = new Set((await readdir(dir)).map((n) => n.toLowerCase()));
      return markers.filter((m) => names.has(m.toLowerCase()));
    } catch {
      return [];
    }
  }

  private async subdirs(dir: string, ignore: Set<string>): Promise<string[]> {
    try {
      return (await readdir(dir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !ignore.has(d.name.toLowerCase()))
        .map((d) => join(dir, d.name));
    } catch {
      return [];
    }
  }
}
