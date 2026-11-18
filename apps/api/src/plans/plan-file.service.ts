import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { dataDir } from '../database/database.config';
import { EventsService } from '../events/events.service';

const KEEP_BACKUPS = 20;

/**
 * Reads and writes plan files safely:
 * - one write at a time per file (in-process lock),
 * - the previous version is backed up under the dashboard's data folder
 *   (never inside the project), keeping the last 20 per file,
 * - the new content is written to a temp file and renamed into place.
 */
@Injectable()
export class PlanFileService {
  private readonly log = new Logger(PlanFileService.name);
  private locks = new Map<string, Promise<unknown>>();

  constructor(private events: EventsService) {}

  /** Applies `edit` to the file's current content. Returns true if the file changed. */
  async edit(file: string, edit: (content: string) => string): Promise<boolean> {
    return this.withLock(file, async () => {
      const before = await readFile(file, 'utf8');
      const after = edit(before);
      if (after === before) return false;
      await this.backup(file, before);
      this.events.markOwnWrite(file, after);
      await this.replace(file, after);
      return true;
    });
  }

  /**
   * Atomic replace via temp file + rename. On Windows the rename fails with
   * EPERM/EBUSY/EACCES while another process (a file watcher, antivirus, an
   * editor) briefly has the file open, so retry with backoff and, as a last
   * resort, write the file in place (the backup was already taken).
   */
  private async replace(file: string, content: string) {
    const tmp = `${file}.cpd-tmp`;
    await writeFile(tmp, content, 'utf8');
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(tmp, file);
          return;
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
          if (!transient) throw e;
          if (attempt >= 8) {
            this.log.warn(`rename kept failing (${code}) for ${file}; writing in place`);
            await writeFile(file, content, 'utf8');
            return;
          }
          await new Promise((r) => setTimeout(r, 25 * 2 ** attempt)); // 25 ms … ~3 s total
        }
      }
    } finally {
      await rm(tmp, { force: true });
    }
  }

  private async withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
    const key = file.toLowerCase();
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.locks.set(key, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === run) this.locks.delete(key);
    }
  }

  private async backup(file: string, content: string) {
    try {
      const dir = join(dataDir, 'backups', createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 12));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SOURCE.txt'), file, 'utf8');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await writeFile(join(dir, `${stamp}_${basename(file)}`), content, 'utf8');
      const old = (await readdir(dir)).filter((n) => n !== 'SOURCE.txt').sort();
      for (const n of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) await rm(join(dir, n), { force: true });
    } catch (e) {
      // A failed backup must not silently allow the write.
      this.log.error(`Backup failed for ${file}: ${e}`);
      throw e;
    }
  }
}
