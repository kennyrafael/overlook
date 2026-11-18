import { Injectable, Logger } from '@nestjs/common';
import { open, readdir, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { encodeClaudeDir, normalizePath } from './path-utils';

export interface ClaudeHistoryEntry {
  /** Resolved working folder of the project. */
  path: string;
  /** Name of the folder under ~/.claude/projects. */
  dirName: string;
  sessions: number;
  lastActivityAt: Date | null;
}

const HEAD_BYTES = 256 * 1024;
const CWD_RE = /"cwd":"((?:[^"\\]|\\.)*)"/g;

export function claudeProjectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return join(base, 'projects');
}

/**
 * Reads ~/.claude/projects. The folder name is a lossy encoding of the path
 * (all non-alphanumerics become '-'), so the real path is recovered from the
 * `cwd` field recorded in the session .jsonl files.
 */
@Injectable()
export class ClaudeHistoryReader {
  private readonly log = new Logger(ClaudeHistoryReader.name);

  async read(): Promise<ClaudeHistoryEntry[]> {
    const root = claudeProjectsDir();
    let dirs: string[];
    try {
      dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      this.log.warn(`No Claude history at ${root}`);
      return [];
    }
    const entries = await Promise.all(dirs.map((d) => this.readDir(join(root, d), d).catch(() => null)));
    return entries.filter((e): e is ClaudeHistoryEntry => e !== null);
  }

  private async readDir(dir: string, dirName: string): Promise<ClaudeHistoryEntry | null> {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
    if (!files.length) return null;

    const withTimes = await Promise.all(
      files.map(async (f) => ({ file: join(dir, f), mtime: (await stat(join(dir, f))).mtime })),
    );
    withTimes.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    const target = dirName.toLowerCase();
    const seen = new Set<string>();
    for (const { file } of withTimes) {
      for (const cwd of await this.cwdsIn(file)) {
        const p = normalizePath(cwd);
        if (encodeClaudeDir(p).toLowerCase() === target) {
          return this.entry(p, dirName, withTimes);
        }
        seen.add(p);
      }
    }
    // No exact match: fall back to the shortest recorded cwd (sessions often cd deeper).
    const fallback = [...seen].sort((a, b) => a.length - b.length)[0];
    return fallback ? this.entry(fallback, dirName, withTimes) : null;
  }

  private entry(path: string, dirName: string, files: { mtime: Date }[]): ClaudeHistoryEntry {
    return { path, dirName, sessions: files.length, lastActivityAt: files[0]?.mtime ?? null };
  }

  private async cwdsIn(file: string): Promise<string[]> {
    const fh = await open(file, 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
      const text = buf.subarray(0, bytesRead).toString('utf8');
      const out = new Set<string>();
      for (const m of text.matchAll(CWD_RE)) {
        try { out.add(JSON.parse(`"${m[1]}"`)); } catch { /* malformed */ }
      }
      return [...out];
    } finally {
      await fh.close();
    }
  }
}
