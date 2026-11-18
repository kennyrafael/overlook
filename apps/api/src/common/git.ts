import { execFile } from 'child_process';

const GIT_TIMEOUT_MS = 15_000;

/** Runs a read-only git command (no shell, never takes the index lock). */
export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

let available: { at: number; ok: boolean } | null = null;

/** Whether a git executable is on PATH. A "missing" answer is re-checked after a minute, so installing git is picked up without a restart. */
export async function gitAvailable(): Promise<boolean> {
  if (available && (available.ok || Date.now() - available.at < 60_000)) return available.ok;
  const ok = await new Promise<boolean>((resolve) => {
    execFile('git', ['--version'], { timeout: GIT_TIMEOUT_MS, windowsHide: true }, (err) => resolve(!err));
  });
  available = { at: Date.now(), ok };
  return ok;
}
