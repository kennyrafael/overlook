import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ClaudeUsageService } from './claude-usage.service';
import { GitService } from './git.service';
import { LiveActivityService } from './live-activity.service';
import { SnapshotsService } from '../projects/snapshots.service';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Claude Code names session logs `<uuid>.jsonl`; anything else is refused before it can reach a path. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUERY_CHARS = 500;

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

  /** Plan task id → recent sessions of the project that worked on it (matched, never written anywhere). */
  @Get('task-sessions')
  taskSessions(@Query('project') project?: string) {
    if (!project) throw new BadRequestException('project is required');
    return this.claude.taskSessions(project);
  }

  /** One session read from its log: prompts, Claude's work per prompt, tools, edited files. */
  @Get('sessions/:id')
  async session(@Param('id') id: string) {
    if (!UUID_RE.test(id)) throw new BadRequestException('Invalid session id');
    const s = await this.claude.sessionDetail(id);
    if (!s) throw new NotFoundException('No such session');
    return s;
  }

  /** Sessions whose title or typed prompts match `q` (any text; it is never read as FTS5 syntax). */
  @Get('search')
  search(@Query('q') q?: string, @Query('projects') projects?: string) {
    if (typeof q !== 'string' || !q.trim()) return [];
    return this.claude.search(q.slice(0, MAX_QUERY_CHARS), ids(projects));
  }

  /** Estimated Claude cost of the sessions matched to each milestone's tasks. */
  @Get('milestone-costs')
  milestoneCosts(@Query('project') project?: string) {
    if (!project) throw new BadRequestException('project is required');
    return this.claude.milestoneCosts(project);
  }

  /** Daily plan progress (milestones / tasks) summed over the projects, last `days` days. */
  @Get('progress')
  progress(@Query('projects') projects?: string, @Query('days') days?: string) {
    const n = Math.min(365, Math.max(1, Number(days) || 90));
    return this.snapshots.series(ids(projects), n);
  }
}
