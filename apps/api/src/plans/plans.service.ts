import { Injectable, Logger } from '@nestjs/common';
import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import type { Milestone } from '@overlook/shared';
import { parsePlan } from './plan-parser';

const MAX_PLAN_BYTES = 2 * 1024 * 1024;

@Injectable()
export class PlansService {
  private readonly log = new Logger(PlansService.name);

  /**
   * Reads the configured plan files from the project folder and its included
   * subfolders (case-insensitive file names) and returns all milestones.
   */
  async milestonesFor(projectPath: string, subpaths: string[], planFiles: string[]): Promise<{ milestones: Milestone[]; files: string[] }> {
    const wanted = planFiles.map((f) => f.toLowerCase());
    const milestones: Milestone[] = [];
    const files: string[] = [];

    for (const dir of [projectPath, ...subpaths]) {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      // Keep the order of the planFiles setting.
      const matches = wanted
        .map((w) => names.find((n) => n.toLowerCase() === w))
        .filter((n): n is string => !!n);

      for (const name of matches) {
        const file = join(dir, name);
        try {
          const content = await readFile(file, 'utf8');
          if (content.length > MAX_PLAN_BYTES) continue;
          const rel = relative(projectPath, file);
          const parsed = parsePlan(content, file, rel);
          if (parsed.length) {
            milestones.push(...parsed);
            files.push(rel);
          }
        } catch (e) {
          this.log.warn(`Could not read ${file}: ${e}`);
        }
      }
    }
    return { milestones, files };
  }
}
