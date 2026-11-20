import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { DailyService } from './daily.service';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Device ids are random strings the web app keeps in localStorage. */
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const PROJECT_RE = /^[0-9a-f]{12}$/;
export const MAX_SUMMARY_DAYS = 31;

function device(id: unknown): string {
  if (typeof id !== 'string' || !DEVICE_RE.test(id)) throw new BadRequestException('device must be 16–64 letters, digits, - or _');
  return id;
}

/** A real calendar day (rejects 2026-02-30, which Date would roll over). */
function day(name: string, v: unknown): string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) throw new BadRequestException(`${name} must be a date (YYYY-MM-DD)`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new BadRequestException(`${name} is not a valid date`);
  return v;
}

/** Phase 8: "Since you were away", the weekly summary and per-repository branches. */
@Controller('insights')
export class DailyController {
  constructor(private daily: DailyService) {}

  /** What happened since this device last pressed "Mark as seen" (`since: null` on its first visit). */
  @Get('away')
  away(@Query('device') id?: string) {
    return this.daily.away(device(id));
  }

  @Post('away/seen')
  @HttpCode(200)
  seen(@Body() body?: { device?: unknown }) {
    return this.daily.markSeen(device(body?.device));
  }

  /** Per-project summary between two local days, inclusive (at most 31 days). */
  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    const a = day('from', from);
    const b = day('to', to);
    if (a > b) throw new BadRequestException('from must not be after to');
    const days = (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_SUMMARY_DAYS) throw new BadRequestException(`At most ${MAX_SUMMARY_DAYS} days`);
    return this.daily.summary(a, b);
  }

  /** Local branches and worktrees of one repository (loaded when its row is expanded on the Git page). */
  @Get('git/branches')
  branches(@Query('project') project?: string, @Query('repo') repo?: string) {
    if (typeof project !== 'string' || !PROJECT_RE.test(project)) throw new BadRequestException('project is required');
    if (repo !== undefined && (typeof repo !== 'string' || repo.length > 1000)) throw new BadRequestException('Invalid repo');
    return this.daily.branches(project, repo ?? '');
  }
}
