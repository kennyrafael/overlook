import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ClaudeUsageService } from './claude-usage.service';
import { GitService } from './git.service';
import { LiveActivityService } from './live-activity.service';
import { SnapshotsService } from '../projects/snapshots.service';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function ids(raw?: string): string[] | undefined {
  const list = raw?.split(',').map((s) => s.trim()).filter(Boolean);
  return list?.length ? list : undefined;
}

@Controller('insights')
export class InsightsController {
  constructor(private git: GitService, private claude: ClaudeUsageService, private snapshots: SnapshotsService, private live: LiveActivityService) {}

  /** Git stats per project. `refresh=1` bypasses the 60 s cache. */
  @Get('git')
  async gitOverview(@Query('projects') projects?: string, @Query('refresh') refresh?: string) {
    const data = await this.git.overview(refresh === '1');
    const wanted = ids(projects);
    return wanted ? { ...data, projects: data.projects.filter((p) => wanted.includes(p.projectId)) } : data;
  }

  /** Claude usage between `from` and `to` (YYYY-MM-DD, inclusive, local time). */
  @Get('claude')
  claudeOverview(@Query('from') from?: string, @Query('to') to?: string, @Query('projects') projects?: string) {
    for (const d of [from, to]) {
      if (d && !DAY_RE.test(d)) throw new BadRequestException(`Invalid date ${d}; use YYYY-MM-DD`);
    }
    return this.claude.overview({ from: from || undefined, to: to || undefined, projectIds: ids(projects) });
  }

  /** Claude sessions with recent activity: their own task list and a guess at the plan task they are on. */
  @Get('live')
  liveSessions(@Query('projects') projects?: string) {
    return this.live.sessions(ids(projects));
  }

  /** Daily plan progress (milestones / tasks) summed over the projects, last `days` days. */
  @Get('progress')
  progress(@Query('projects') projects?: string, @Query('days') days?: string) {
    const n = Math.min(365, Math.max(1, Number(days) || 90));
    return this.snapshots.series(ids(projects), n);
  }
}
