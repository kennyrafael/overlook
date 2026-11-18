import { Injectable, Logger } from '@nestjs/common';
import { open, readdir, stat } from 'fs/promises';
import { basename, join } from 'path';
import { ClaudeRoot, claudeRoots, localClaudeRoot } from './claude-roots';
import { encodeClaudeDir } from './path-utils';

export interface ClaudeHistoryEntry {
  /** Resolved working folder of the project. */
  path: string;
  /** Absolute path of the session folder (`<claude>/projects/<encoded-path>`); identifies it across roots. */
  dir: string;
  sessions: number;
  lastActivityAt: Date | null;
}

const HEAD_BYTES = 256 * 1024;
const CWD_RE = /"cwd":"((?:[^"\\]|\\.)*)"/g;

/** The local `~/.claude/projects` folder (or `$CLAUDE_CONFIG_DIR/projects`). */
export function claudeProjectsDir(): string {
  return localClaudeRoot().dir;
}

/**
 * Reads ~/.claude/projects (and the same folders inside running WSL distros). The folder name is a
 * lossy encoding of the path (all non-alphanumerics become '-'), so the real path is recovered from
 * the `cwd` field recorded in the session .jsonl files.
 */
@Injectable()
export class ClaudeHistoryReader {
  private readonly log = new Logger(ClaudeHistoryReader.name);

  async read(includeWsl = true): Promise<ClaudeHistoryEntry[]> {
    const out: ClaudeHistoryEntry[] = [];
    for (const root of await claudeRoots(includeWsl)) {
      let dirs: string[];
      try {
        dirs = (await readdir(root.dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
      } catch {
        this.log.warn(`No Claude history at ${root.dir}`);
        continue;
      }
      const entries = await Promise.all(dirs.map((d) => this.readDir(root, join(root.dir, d)).catch(() => null)));
      out.push(...entries.filter((e): e is ClaudeHistoryEntry => e !== null));
    }
    return out;
  }

  private async readDir(root: ClaudeRoot, dir: string): Promise<ClaudeHistoryEntry | null> {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
    if (!files.length) return null;

    const withTimes = await Promise.all(
      files.map(async (f) => ({ file: join(dir, f), mtime: (await stat(join(dir, f))).mtime })),
    );
    withTimes.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    const target = basename(dir).toLowerCase();
    const seen = new Set<string>();
    for (const { file } of withTimes) {
      for (const cwd of await this.cwdsIn(file)) {
        const p = root.toLocal(cwd);
        // Claude encodes the path as it saw it (a Linux path inside WSL, a Windows path otherwise).
        if (encodeClaudeDir(cwd).toLowerCase() === target || encodeClaudeDir(p).toLowerCase() === target) {
          return this.entry(p, dir, withTimes);
        }
        seen.add(p);
      }
    }
    // No exact match: fall back to the shortest recorded cwd (sessions often cd deeper).
    const fallback = [...seen].sort((a, b) => a.length - b.length)[0];
    return fallback ? this.entry(fallback, dir, withTimes) : null;
  }

  private entry(path: string, dir: string, files: { mtime: Date }[]): ClaudeHistoryEntry {
    return { path, dir, sessions: files.length, lastActivityAt: files[0]?.mtime ?? null };
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
