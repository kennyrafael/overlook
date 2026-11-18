import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { Subject } from 'rxjs';
import type { LiveEvent } from '@overlook/shared';

const hash = (s: string) => createHash('sha1').update(s).digest('hex');

/** In-process event bus feeding the SSE stream and internal listeners. */
@Injectable()
export class EventsService {
  readonly stream = new Subject<LiveEvent>();
  /** file (lower-cased) → hash of the content the dashboard last wrote */
  private ownWrites = new Map<string, string>();

  emit(event: LiveEvent) {
    this.stream.next(event);
  }

  /** Remember what the dashboard wrote, so the watcher does not report it as an external change. */
  markOwnWrite(file: string, content: string) {
    this.ownWrites.set(file.toLowerCase(), hash(content));
  }

  /**
   * True when the file still holds exactly what the dashboard wrote. Content-based
   * (not time-based), so an outside edit right after a dashboard edit is still reported.
   */
  async isOwnWrite(file: string): Promise<boolean> {
    const expected = this.ownWrites.get(file.toLowerCase());
    if (!expected) return false;
    try {
      return hash(await readFile(file, 'utf8')) === expected;
    } catch {
      return false;
    }
  }
}
