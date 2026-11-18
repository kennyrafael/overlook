import { createHash } from 'crypto';
import { resolve, sep } from 'path';

const IS_WIN = process.platform === 'win32';

/** Normalize any path form Claude may record (Windows, Git-Bash `/c/...`) to an absolute native path. */
export function normalizePath(p: string): string {
  let out = p.trim();
  if (IS_WIN) {
    const m = /^\/([a-zA-Z])(\/|$)(.*)$/.exec(out); // /c/Users/... → C:\Users\...
    if (m) out = `${m[1].toUpperCase()}:\\${m[3]}`;
    out = out.replace(/\//g, '\\');
    if (/^[a-z]:/.test(out)) out = out[0].toUpperCase() + out.slice(1);
  }
  out = resolve(out);
  if (out.length > 3 && out.endsWith(sep)) out = out.slice(0, -1);
  return out;
}

/** Key used for comparisons (Windows paths are case-insensitive). */
export function pathKey(p: string): string {
  return IS_WIN ? p.toLowerCase() : p;
}

export function projectId(p: string): string {
  return createHash('sha1').update(pathKey(p)).digest('hex').slice(0, 12);
}

/** True if `child` is `parent` or inside it. */
export function isInside(child: string, parent: string): boolean {
  const c = pathKey(child);
  const pa = pathKey(parent);
  return c === pa || c.startsWith(pa.endsWith(sep) ? pa : pa + sep);
}

/** How Claude Code names its per-project history folder: every non-alphanumeric char → '-'. */
export function encodeClaudeDir(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

/** `<repo>\.claude\worktrees\<name>` belongs to `<repo>`. */
export function stripWorktree(p: string): string {
  const m = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/]/i.exec(p);
  return m ? m[1] : p;
}

export function isScratchWorkspace(p: string): boolean {
  return /[\\/]Claude[\\/]scratch-workspaces[\\/]/i.test(p);
}
