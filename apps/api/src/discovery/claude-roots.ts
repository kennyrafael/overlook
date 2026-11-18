import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { normalizePath } from './path-utils';

/**
 * A folder that holds Claude Code session logs (`<config>/projects/<encoded-path>/*.jsonl`), plus how
 * to turn a `cwd` recorded in those logs into a path this machine can open.
 */
export interface ClaudeRoot {
  /** Absolute path of the `projects` folder. */
  dir: string;
  /** Shown in logs and the UI, e.g. "local" or "WSL: Ubuntu". */
  label: string;
  /** Maps a recorded cwd to a native path. */
  toLocal(cwd: string): string;
}

const IS_WIN = process.platform === 'win32';

export function localClaudeRoot(): ClaudeRoot {
  const base = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return { dir: join(base, 'projects'), label: 'local', toLocal: normalizePath };
}

/**
 * Maps a Linux path recorded inside a WSL distro to a Windows path:
 * `/mnt/c/Users/x` → `C:\Users\x` (the Windows drive), anything else → `<distroRoot>\home\…`.
 */
export function wslToWindows(cwd: string, distroRoot: string): string {
  const drive = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(cwd);
  if (drive) return normalizePath(`${drive[1].toUpperCase()}:${(drive[2] ?? '/').replace(/\//g, '\\')}`);
  if (!cwd.startsWith('/')) return normalizePath(cwd);
  const rest = cwd.replace(/\/+$/, '').replace(/\//g, '\\');
  return distroRoot.replace(/[\\/]+$/, '') + rest;
}

/** Claude `projects` folders inside one distro: every /home/<user>/.claude and /root/.claude. */
export function wslRootsIn(distro: string, distroRoot: string): ClaudeRoot[] {
  const candidates: string[] = [join(distroRoot, 'root', '.claude', 'projects')];
  try {
    for (const user of readdirSync(join(distroRoot, 'home'))) candidates.push(join(distroRoot, 'home', user, '.claude', 'projects'));
  } catch { /* no /home */ }
  return candidates.filter((d) => {
    try { return existsSync(d); } catch { return false; }
  }).map((dir) => ({ dir, label: `WSL: ${distro}`, toLocal: (cwd: string) => wslToWindows(cwd, distroRoot) }));
}

/** Names of the WSL distros that are running now. Never starts a distro (that would boot its VM). */
export function runningWslDistros(): Promise<string[]> {
  if (!IS_WIN) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('wsl.exe', ['--list', '--quiet', '--running'], { windowsHide: true, timeout: 5000, encoding: 'buffer' }, (err, out) => {
      if (err || !out) return resolve([]);
      // wsl.exe writes UTF-16LE.
      const text = out.toString('utf16le').replace(/\0/g, '').replace(/^\uFEFF/, '');
      if (/not installed|no running/i.test(text)) return resolve([]);
      resolve(text.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[\w.\-]+$/.test(s)));
    });
  });
}

let wslCache: { at: number; roots: ClaudeRoot[] } | null = null;
const WSL_CACHE_MS = 60_000;

/**
 * Every place Claude Code keeps logs on this machine: the local config folder and, on Windows,
 * the users' config folders inside running WSL distros (\\wsl.localhost\<distro>).
 */
export async function claudeRoots(includeWsl: boolean): Promise<ClaudeRoot[]> {
  const roots = [localClaudeRoot()];
  if (!includeWsl || !IS_WIN || process.env.CPD_NO_WSL) return roots;
  if (!wslCache || Date.now() - wslCache.at > WSL_CACHE_MS) {
    const distros = await runningWslDistros();
    const found: ClaudeRoot[] = [];
    for (const d of distros) {
      const base = [`\\\\wsl.localhost\\${d}`, `\\\\wsl$\\${d}`].find((b) => {
        try { return existsSync(b); } catch { return false; }
      });
      if (base) found.push(...wslRootsIn(d, base));
    }
    wslCache = { at: Date.now(), roots: found };
  }
  return [...roots, ...wslCache.roots];
}
