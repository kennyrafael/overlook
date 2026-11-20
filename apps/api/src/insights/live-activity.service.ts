import { Injectable, Logger } from '@nestjs/common';
import { open, readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { LiveSession } from '@overlook/shared';
import { ProjectsService } from '../projects/projects.service';
import { LiveAccumulator } from './live-activity';
import { matchTask } from './task-match';

/** A session counts as live while its log changed within this window. */
export const LIVE_WINDOW_MS = 20 * 60_000;
/** Mid-turn but silent for this long: treat as idle (interrupted, or waiting on a prompt). */
const QUIET_MS = 5 * 60_000;
const CHUNK = 1 << 20;

interface Followed {
  offset: number;
  rest: string;
  acc: LiveAccumulator;
  mtimeMs: number;
}

/**
 * What Claude is doing right now in each project, read from session logs that changed recently.
 * Logs are followed incrementally: each call reads only the bytes appended since the last one.
 */
@Injectable()
export class LiveActivityService {
  private readonly log = new Logger(LiveActivityService.name);
  private followed = new Map<string, Followed>();
  private reading: Promise<unknown> | null = null;

  constructor(private projects: ProjectsService) {}

  async sessions(projectIds?: string[], now = Date.now()): Promise<LiveSession[]> {
    // One read at a time, so overlapping requests never read the same bytes twice.
    while (this.reading) await this.reading.catch(() => undefined);
    const job = this.collect(projectIds, now);
    this.reading = job;
    try { return await job; } finally { this.reading = null; }
  }

  private async collect(projectIds: string[] | undefined, now: number): Promise<LiveSession[]> {
    const wanted = projectIds?.length ? new Set(projectIds) : null;
    const refs = (await this.projects.refs()).filter((r) => !wanted || wanted.has(r.id));
    const out: LiveSession[] = [];
    const seen = new Set<string>();

    for (const ref of refs) {
      const found: { id: string; acc: LiveAccumulator }[] = [];
      for (const dir of ref.claudeDirs) {
        let names: string[];
        try { names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
        for (const name of names) {
          const file = join(dir, name);
          let st;
          try { st = await stat(file); } catch { continue; }
          if (now - st.mtimeMs > LIVE_WINDOW_MS) continue;
          seen.add(file);
          const acc = await this.follow(file, st.size, st.mtimeMs);
          if (acc) found.push({ id: name.slice(0, -'.jsonl'.length), acc });
        }
      }
      if (!found.length) continue;

      const tasks = await this.planTasks(ref.id);
      for (const { id, acc } of found) {
        if (acc.lastAt === null) continue;
        const steps = acc.visibleSteps();
        const current = steps.find((s) => s.status === 'in_progress')?.text ?? null;
        const working = !acc.waiting && now - acc.lastAt < QUIET_MS;
        let suggestion: LiveSession['suggestion'] = null;
        if (tasks.open.length) {
          // Recent intent only: the last two prompts and the step list, not the whole session.
          const text = [acc.title ?? '', ...acc.prompts.slice(-2), ...steps.map((s) => s.text)].join('\n');
          const m = matchTask(text, tasks.open, tasks.all);
          const t = m && tasks.open.find((x) => x.id === m.taskId);
          if (m && t) suggestion = { taskId: t.id, text: t.text, score: m.score };
        }
        out.push({
          id,
          projectId: ref.id,
          title: acc.title,
          lastActivityAt: new Date(acc.lastAt).toISOString(),
          state: working ? 'working' : 'idle',
          waiting: acc.waiting,
          steps,
          current,
          suggestion,
        });
      }
    }

    // Forget logs that left the window (only those we looked at, so a filtered call keeps the rest).
    for (const file of this.followed.keys()) {
      const ref = refs.find((r) => r.claudeDirs.some((d) => file.startsWith(d)));
      if (ref && !seen.has(file)) this.followed.delete(file);
    }
    return out.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  private async planTasks(projectId: string) {
    try {
      const p = await this.projects.get(projectId);
      const all = p.milestones.flatMap((m) => m.tasks);
      return {
        all: all.map((t) => ({ id: t.id, text: t.text })),
        open: all.filter((t) => t.status === 'todo').map((t) => ({ id: t.id, text: t.text })),
      };
    } catch {
      return { all: [], open: [] };
    }
  }

  /** Reads what was appended since the last call; starts over if the file shrank. */
  private async follow(file: string, size: number, mtimeMs: number): Promise<LiveAccumulator | null> {
    let f = this.followed.get(file);
    if (!f || size < f.offset) {
      f = { offset: 0, rest: '', acc: new LiveAccumulator(), mtimeMs: 0 };
      this.followed.set(file, f);
    }
    if (size === f.offset && mtimeMs === f.mtimeMs) return f.acc;
    let fh;
    try {
      fh = await open(file, 'r');
      const buf = Buffer.alloc(CHUNK);
      while (f.offset < size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - f.offset), f.offset);
        if (!bytesRead) break;
        f.offset += bytesRead;
        // Split on raw newlines so a multi-byte character cut at a chunk edge stays whole.
        let chunk = f.rest + buf.subarray(0, bytesRead).toString('latin1');
        const last = chunk.lastIndexOf('\n');
        f.rest = last < 0 ? chunk : chunk.slice(last + 1);
        chunk = last < 0 ? '' : chunk.slice(0, last);
        for (const line of chunk.split('\n')) f.acc.add(Buffer.from(line, 'latin1').toString('utf8'));
      }
      f.mtimeMs = mtimeMs;
      return f.acc;
    } catch (e) {
      this.log.warn(`Could not read ${file}: ${e}`);
      this.followed.delete(file);
      return null;
    } finally {
      await fh?.close().catch(() => undefined);
    }
  }
}
