import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync } from 'fs';
import { basename, join } from 'path';
import type { PlanTemplate, PlanTemplateId, ProjectDetail, StaleTask } from '@overlook/shared';
import { SettingsService } from '../config/settings.service';
import { EventsService } from '../events/events.service';
import { PlanFileService } from '../plans/plan-file.service';
import { PlansService } from '../plans/plans.service';
import { mapLimit } from '../insights/limit';
import { PlanAgeService } from '../plans/plan-age.service';
import { ProjectsService } from './projects.service';

const DAY_MS = 86_400_000;

/** Starter plans. Fixed text; only the project's name (from the server's own list) is filled in. */
const TEMPLATES: Record<PlanTemplateId, { label: string; description: string; body: (name: string) => string }> = {
  basic: {
    label: 'Now / Next / Later',
    description: 'Three milestones for a small project: what you are on now, what comes next, ideas for later.',
    body: (name) => `# ${name}

## Now
- [ ] First task

## Next
- [ ] Another task

## Later
- [ ] An idea for later
`,
  },
  phases: {
    label: 'Phases',
    description: 'Numbered phases from setup to release, each a milestone with a few tasks. One has a target date.',
    body: (name) => `# ${name} plan

## Phase 1: Foundations
- [ ] Set up the project
- [ ] Write down the goal in one paragraph

## Phase 2: First version
- [ ] Build the core feature
- [ ] Try it end to end

## Phase 3: Release (due ${dueIn(30)})
- [ ] Write the README
- [ ] Ship it
`,
  },
};

function dueIn(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** A project name that is safe on a markdown heading line: one line, no leading #, bounded. */
function headingText(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/^[#\s]+/, '').trim().slice(0, 120) || 'Plan';
}

/** Plan health extras: stale in-progress work and starter plan files. */
@Injectable()
export class PlanToolsService {
  constructor(
    private projects: ProjectsService,
    private settings: SettingsService,
    private plans: PlansService,
    private files: PlanFileService,
    private ages: PlanAgeService,
    private events: EventsService,
  ) {}

  /** In-progress tasks whose checkbox line was last committed more than Settings → staleTaskDays ago, oldest first. */
  async staleTasks(): Promise<StaleTask[]> {
    const [settings, projects] = await Promise.all([this.settings.get(), this.projects.detailed()]);
    const limit = Math.max(1, settings.staleTaskDays) * DAY_MS;
    const now = Date.now();
    const busy = projects.filter((p) => p.exists && p.milestones.some((m) => m.tasksInProgress));
    // A few at a time: each plan file with in-progress tasks is one git process (then cached by mtime).
    const annotated = await mapLimit(busy, 4, (p) => this.ages.annotate(p));
    const out: StaleTask[] = [];
    for (const p of annotated) {
      for (const m of p.milestones) {
        for (const t of m.tasks) {
          if (!t.inProgressSince) continue;
          const age = now - Date.parse(t.inProgressSince);
          if (age <= limit) continue;
          out.push({
            projectId: p.id, projectName: p.name, taskId: t.id, text: t.text, milestoneTitle: m.title,
            relFile: m.relFile, line: t.line, since: t.inProgressSince, days: Math.floor(age / DAY_MS),
          });
        }
      }
    }
    return out.sort((a, b) => b.days - a.days || a.projectName.localeCompare(b.projectName));
  }

  /** The starter plans for a project, with the exact text that would be written. */
  async templates(projectId: string): Promise<PlanTemplate[]> {
    const [project, fileName] = await Promise.all([this.projects.get(projectId), this.fileName()]);
    return (Object.keys(TEMPLATES) as PlanTemplateId[]).map((id) => ({
      id, label: TEMPLATES[id].label, description: TEMPLATES[id].description, fileName,
      content: TEMPLATES[id].body(headingText(project.name)),
    }));
  }

  /**
   * Writes a starter plan file in the project folder. Refuses (409) when the project already has a
   * plan (milestones in any configured plan file) or the file name is taken; never overwrites.
   */
  async create(projectId: string, template: unknown): Promise<ProjectDetail> {
    if (typeof template !== 'string' || !Object.prototype.hasOwnProperty.call(TEMPLATES, template)) {
      throw new BadRequestException(`template must be one of: ${Object.keys(TEMPLATES).join(', ')}`);
    }
    const project = await this.projects.refreshPlans(projectId);
    if (!project.exists || !existsSync(project.path)) throw new NotFoundException('The project folder no longer exists');
    const fileName = await this.fileName();
    const settings = await this.settings.get();
    const existing = await this.plans.planFilesIn(project.path, [], settings.planFiles);
    if (project.milestonesTotal > 0) throw new ConflictException('This project already has a plan file with milestones.');
    if (existing.some((f) => basename(f).toLowerCase() === fileName.toLowerCase())) {
      throw new ConflictException(`${fileName} already exists in the project folder.`);
    }
    const file = join(project.path, fileName);
    const content = TEMPLATES[template as PlanTemplateId].body(headingText(project.name));
    try {
      await this.files.create(file, content);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ConflictException(`${fileName} already exists in the project folder.`);
      throw e;
    }
    const updated = await this.projects.refreshPlans(projectId);
    this.events.emit({ type: 'project:updated', projectId, file: fileName, source: 'dashboard' });
    return updated;
  }

  /** First name in Settings → planFiles, if it is a plain file name (no folders). */
  private async fileName(): Promise<string> {
    const name = (await this.settings.get()).planFiles[0]?.trim() || 'PLAN.md';
    if (/[\\/]|^\.\.?$/.test(name) || /[\u0000-\u001f<>:"|?*]/.test(name)) {
      throw new BadRequestException('The first entry of Settings → Plan files must be a plain file name such as PLAN.md');
    }
    return name;
  }
}
