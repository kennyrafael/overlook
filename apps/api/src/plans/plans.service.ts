import { Injectable, Logger } from '@nestjs/common';
import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';
import type { Milestone, PlanWarning } from '@overlook/shared';
import { parsePlan } from './plan-parser';
import { PLAN_SIZE_MAX_BYTES, lintPlan, sizeWarning } from './plan-lint';

@Injectable()
export class PlansService {
  private readonly log = new Logger(PlansService.name);

  /**
   * Reads the configured plan files from the project folder and its included
   * subfolders (case-insensitive file names) and returns all milestones, plus
   * plan health warnings for every plan file found (also those without milestones,
   * where a broken checkbox is the likely reason).
   */
  async milestonesFor(projectPath: string, subpaths: string[], planFiles: string[]): Promise<{ milestones: Milestone[]; files: string[]; warnings: PlanWarning[] }> {
    const milestones: Milestone[] = [];
    const files: string[] = [];
    const warnings: PlanWarning[] = [];

    for (const file of await this.planFilesIn(projectPath, subpaths, planFiles)) {
      const rel = relative(projectPath, file);
      try {
        // Too large to read: say so instead of silently showing no milestones.
        const size = (await stat(file)).size;
        if (size > PLAN_SIZE_MAX_BYTES) {
          warnings.push({ ...sizeWarning(size)!, file, relFile: rel });
          continue;
        }
        const content = await readFile(file, 'utf8');
        const parsed = parsePlan(content, file, rel);
        if (parsed.length) {
          milestones.push(...parsed);
          files.push(rel);
        }
        warnings.push(...lintPlan(content, rel).map((w) => ({ ...w, file, relFile: rel })));
      } catch (e) {
        this.log.warn(`Could not read ${file}: ${e}`);
      }
    }
    return { milestones, files, warnings };
  }

  /** Existing plan files (absolute paths) in the project folder and its included subfolders, in Settings order. */
  async planFilesIn(projectPath: string, subpaths: string[], planFiles: string[]): Promise<string[]> {
    const wanted = planFiles.map((f) => f.toLowerCase());
    const out: string[] = [];
    for (const dir of [projectPath, ...subpaths]) {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      // Keep the order of the planFiles setting.
      for (const w of wanted) {
        const name = names.find((n) => n.toLowerCase() === w);
        if (name) out.push(join(dir, name));
      }
    }
    return out;
  }
}
