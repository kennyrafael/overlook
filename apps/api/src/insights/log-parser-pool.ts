import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';
import type { LogSummary } from './session-log';

type Pending = { resolve: (s: LogSummary) => void; reject: (e: Error) => void };

/**
 * Parses log files on worker threads. Falls back to the main thread when workers are unavailable
 * (for example when running from TypeScript sources).
 */
export class LogParserPool {
  private readonly log = new Logger(LogParserPool.name);
  private workers: { w: Worker; busy: number }[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private failed = false;

  constructor(private size = 2) {}

  async parse(file: string): Promise<LogSummary> {
    const slot = this.slot();
    if (!slot) {
      const { parseLogFile } = await import('./log-parse.worker');
      return parseLogFile(file);
    }
    const id = this.nextId++;
    slot.busy++;
    try {
      return await new Promise<LogSummary>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        slot.w.postMessage({ id, file });
      });
    } finally {
      slot.busy--;
    }
  }

  async close() {
    const ws = this.workers;
    this.workers = [];
    await Promise.all(ws.map(({ w }) => w.terminate()));
    for (const p of this.pending.values()) p.reject(new Error('parser closed'));
    this.pending.clear();
  }

  private slot() {
    if (this.failed) return null;
    if (this.workers.length < this.size) {
      const script = join(__dirname, 'log-parse.worker.js');
      if (!existsSync(script)) { this.failed = true; return null; }
      try {
        const w = new Worker(script);
        w.unref();
        w.on('message', (m: { id: number; summary?: LogSummary; error?: string }) => {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          if (m.summary) p.resolve(m.summary); else p.reject(new Error(m.error ?? 'parse failed'));
        });
        w.on('error', (e) => {
          this.log.warn(`Log parser worker failed: ${e}`);
          this.workers = this.workers.filter((x) => x.w !== w);
          for (const [id, p] of this.pending) { p.reject(e); this.pending.delete(id); }
        });
        this.workers.push({ w, busy: 0 });
      } catch (e) {
        this.log.warn(`Cannot start log parser worker, parsing on the main thread: ${e}`);
        this.failed = true;
        return null;
      }
    }
    return this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
  }
}
