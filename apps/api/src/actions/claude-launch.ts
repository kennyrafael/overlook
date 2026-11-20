import { open } from 'fs/promises';

/**
 * Helpers for "Start Claude on this task" and "Resume session". Kept free of Nest so they can be tested.
 *
 * The prompt is built on the server from a plan task (never taken from the request), flattened to one line and
 * handed to `claude` as a single argument. Where the launch path would re-parse that argument (a .cmd wrapper,
 * the cmd.exe fallback, a terminal that re-splits on spaces), the caller does not pass it at all.
 */

/** Claude Code session ids are UUIDs; anything else is refused before it gets near a command line. */
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_PROMPT_CHARS = 2000;

/** Fills the template's {task}, {milestone} and {file}; one line, bounded, never starting with '-' (an option). */
export function taskPrompt(template: string, vars: { task: string; milestone: string; file: string }): string {
  const filled = template.replace(/\{(task|milestone|file)\}/g, (_, k: 'task' | 'milestone' | 'file') => vars[k]);
  let p = filled.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (p.startsWith('-')) p = `Task: ${p}`;
  return p.slice(0, MAX_PROMPT_CHARS);
}

/**
 * Windows Terminal reads ';' as "new tab" anywhere on its command line, and a '"' inside an argument would be
 * re-quoted on the way to the new process. Neither matters to Claude, so swap them for look-alikes.
 */
export function windowsTerminalText(p: string): string {
  return p.replace(/;/g, ',').replace(/"/g, "'");
}

/** On Windows, a .cmd/.bat program runs through cmd.exe, which would interpret &, | and ^ in free text. */
export function isBatchFile(file: string): boolean {
  return /\.(cmd|bat)$/i.test(file);
}

/** The folder a session ran in: the first `"cwd"` in the first 256 KB of its log, or null. */
export async function sessionCwd(logFile: string): Promise<string | null> {
  let fh;
  try {
    fh = await open(logFile, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
      if (!line.includes('"cwd"')) continue;
      try {
        const j = JSON.parse(line);
        if (typeof j?.cwd === 'string' && j.cwd) return j.cwd;
      } catch { /* a cut-off last line */ }
    }
    return null;
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/**
 * First prompt for "Open in Claude app": the desktop app cannot resume a CLI session by id (its claude://code/new
 * link only starts a new session), so the new session is pointed at the old one's transcript instead.
 */
export function desktopResumePrompt(transcript: string): string {
  return `Pick up an earlier Claude Code session. Its transcript is ${transcript} (JSON lines). `
    + 'Read the end of it to see what was being worked on and where it stopped, sum that up in a few lines, then ask me how to continue.';
}

/** Claude desktop's deep link for a new Code session in `folder` with a prefilled prompt (the app asks to confirm the folder). */
export function desktopNewSessionUrl(folder: string, prompt: string): string {
  return `claude://code/new?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(prompt)}`;
}
