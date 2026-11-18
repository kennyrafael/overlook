import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs';
import { join } from 'path';

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 5;

/**
 * Nest logger that also appends to `<logDir>/overlook.log`, rotating at 5 MB and keeping
 * overlook.1.log … overlook.5.log. Never throws: a failing disk only loses log lines.
 */
export class FileLogger extends ConsoleLogger {
  private readonly file: string;
  private size = 0;

  constructor(private readonly dir: string) {
    super();
    this.file = join(dir, 'overlook.log');
    try {
      mkdirSync(dir, { recursive: true });
      this.size = existsSync(this.file) ? statSync(this.file).size : 0;
    } catch { /* logging to the console still works */ }
  }

  protected printMessages(messages: unknown[], context?: string, logLevel: LogLevel = 'log', writeStreamType?: 'stdout' | 'stderr') {
    super.printMessages(messages, context, logLevel, writeStreamType);
    const at = new Date().toISOString();
    const text = messages.map((m) => {
      const s = m instanceof Error ? m.stack ?? m.message : typeof m === 'string' ? m : JSON.stringify(m);
      return `${at} ${logLevel.toUpperCase().padEnd(7)} [${context ?? this.context ?? 'App'}] ${s}\n`;
    }).join('');
    this.write(text);
  }

  private write(text: string) {
    try {
      if (this.size + text.length > MAX_BYTES) this.rotate();
      appendFileSync(this.file, text);
      this.size += Buffer.byteLength(text);
    } catch { /* ignore */ }
  }

  private rotate() {
    const n = (i: number) => join(this.dir, `overlook.${i}.log`);
    rmSync(n(KEEP), { force: true });
    for (let i = KEEP - 1; i >= 1; i--) if (existsSync(n(i))) renameSync(n(i), n(i + 1));
    if (existsSync(this.file)) renameSync(this.file, n(1));
    this.size = 0;
  }
}
