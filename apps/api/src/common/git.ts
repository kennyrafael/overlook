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
