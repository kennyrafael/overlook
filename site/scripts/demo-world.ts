// Builds the demo projects from src/demo/data.ts on disk, for the screenshot script: one git repo per
// project with 90 days of history (the plan file is ticked on the day each task was finished, so the
// app's burnup chart backfills from it), uncommitted and unpushed work, and a Claude Code history
// folder with matching sessions. Everything lives in one temp folder.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { commitsByDay, DAYS, PROJECTS, planMarkdown, sessions, type DemoProject } from '../src/demo/data.ts';

export interface World {
  base: string;
  root: string;
  claudeDir: string;
  dataDir: string;
  projects: Record<string, string>;
}

const AUTHOR = 'Demo Developer <demo@example.com>';
const DAY_MS = 86_400_000;

/** Midnight (local) `daysAgo` days ago, plus `hour` hours. */
function at(daysAgo: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - daysAgo * DAY_MS + hour * 3_600_000 + minute * 60_000);
}

const MESSAGES = ['Fix edge case in', 'Tidy up', 'Add tests for', 'Speed up', 'Refactor', 'Handle errors in', 'Document'];
const AREAS = ['the store', 'settings', 'the parser', 'sync', 'the API client', 'routing', 'the build'];

const git = (cwd: string, args: string[], input?: Buffer) =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], { cwd, input, stdio: ['pipe', 'pipe', 'pipe'] }).toString();

/** One repo, written with `git fast-import` (hundreds of commits in well under a second). */
function buildRepo(dir: string, remotes: string, p: DemoProject): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  const perDay = commitsByDay(p);
  const chunks: Buffer[] = [];
  const data = (s: string) => { const b = Buffer.from(s, 'utf8'); chunks.push(Buffer.from(`data ${b.length}\n`), b, Buffer.from('\n')); };
  let mark = 0;
  let lastPlan = '';
  let changelog = `# ${p.name} changelog\n`;
  perDay.forEach((n, i) => {
    const ago = DAYS - 1 - i;
    for (let c = 0; c < n; c++) {
      const when = at(ago, 10 + Math.floor((c * 8) / Math.max(1, n)), (c * 17) % 60);
      const plan = planMarkdown(p, ago);
      const ticked = plan !== lastPlan && c === n - 1;
      const msg = mark === 0 ? 'Initial commit' : ticked ? 'Update plan' : `${MESSAGES[(i + c) % MESSAGES.length]} ${AREAS[(i * 3 + c) % AREAS.length]}`;
      changelog += `- ${when.toISOString().slice(0, 10)} ${msg}\n`;
      const stamp = `${Math.floor(when.getTime() / 1000)} +0000`;
      chunks.push(Buffer.from(`commit refs/heads/main\nmark :${++mark}\nauthor ${AUTHOR} ${stamp}\ncommitter ${AUTHOR} ${stamp}\n`));
      data(msg);
      if (mark > 1) chunks.push(Buffer.from(`from :${mark - 1}\n`));
      chunks.push(Buffer.from('M 100644 inline CHANGELOG.md\n'));
      data(changelog);
      if (mark === 1 || ticked) {
        chunks.push(Buffer.from(`M 100644 inline ${p.planFile}\n`));
        data(mark === 1 ? planMarkdown(p, DAYS) : plan);
        lastPlan = mark === 1 ? planMarkdown(p, DAYS) : plan;
      }
      if (mark === 1) {
        chunks.push(Buffer.from('M 100644 inline README.md\n'));
        data(`# ${p.name}\n\n${p.tagline}.\n`);
      }
      chunks.push(Buffer.from('\n'));
    }
  });
  git(dir, ['fast-import', '--quiet'], Buffer.concat(chunks));
  git(dir, ['reset', '-q', '--hard', 'main']);

  // Today's plan (with [~] in-progress tasks) is saved but not committed yet, like a real working day.
  writeFileSync(join(dir, p.planFile), planMarkdown(p, 0));

  // A remote that is `unpushed` commits behind.
  // Kept outside the scanned folder so it is not listed as a project.
  const remote = join(remotes, `${p.name}.git`);
  git(remotes, ['init', '-q', '--bare', remote]);
  git(dir, ['remote', 'add', 'origin', remote]);
  git(dir, ['push', '-q', 'origin', `main~${p.unpushed}:refs/heads/main`]);
  git(dir, ['fetch', '-q', 'origin']);
  git(dir, ['branch', '-q', '--set-upstream-to=origin/main', 'main']);

  for (const f of p.uncommitted) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), `// work in progress\n`);
  }

  // The app reads "last activity" from file times, so make them match the story: everything as of
  // the last commit, and today's edits (plan, uncommitted files) on the last active day.
  const lastCommit = new Date(Number(git(dir, ['log', '-1', '--format=%ct']).trim()) * 1000);
  setTimes(dir, lastCommit);
  const lastEdit = p.quietSince ? at(p.quietSince, 17) : new Date(Date.now() - 25 * 60_000);
  const edited = [...p.uncommitted, ...(planMarkdown(p, 0) === planMarkdown(p, 1) ? [] : [p.planFile])];
  for (const f of edited) utimesSync(join(dir, f), lastEdit, lastEdit);
}

/** Sets the access and modified time of every file and folder under `dir` (including .git). */
function setTimes(dir: string, when: Date): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) setTimes(path, when);
    utimesSync(path, when, when);
  }
  utimesSync(dir, when, when);
}

/** Claude Code history: ~/.claude/projects/<path with non-alphanumerics as '-'>/<session>.jsonl */
function buildClaudeHistory(claudeDir: string, projects: Record<string, string>): void {
  let n = 0;
  for (const s of sessions()) {
    const cwd = projects[s.project];
    const dir = join(claudeDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(dir, { recursive: true });
    const id = `demo-${String(++n).padStart(4, '0')}`;
    const lines: object[] = [];
    let minute = 0;
    const ts = () => at(s.daysAgo, s.hour, (minute += 2) % 60).toISOString();
    s.prompts.forEach((prompt, pi) => {
      lines.push({ type: 'user', timestamp: ts(), sessionId: id, cwd, message: { role: 'user', content: prompt } });
      const turns = s.turns.filter((_, ti) => ti % s.prompts.length === pi);
      turns.forEach((t, ti) => {
        lines.push({
          type: 'assistant', timestamp: ts(), sessionId: id, cwd,
          message: {
            id: `${id}-m${pi}-${ti}`, model: t.model, role: 'assistant',
            usage: {
              input_tokens: t.input, output_tokens: t.output, cache_read_input_tokens: t.cacheRead, cache_creation_input_tokens: t.cacheWrite,
              cache_creation: { ephemeral_5m_input_tokens: t.cacheWrite, ephemeral_1h_input_tokens: 0 },
            },
          },
        });
      });
    });
    lines.push({ type: 'custom-title', customTitle: s.title, sessionId: id });
    const file = join(dir, `${id}.jsonl`);
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const end = at(s.daysAgo, s.hour, minute % 60);
    utimesSync(file, end, end);
  }
}

export function createWorld(): World {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'overlook-demo-')));
  const root = join(base, 'code');
  const claudeDir = join(base, 'claude');
  const dataDir = join(base, 'data');
  const projects: Record<string, string> = {};
  const remotes = join(base, 'remotes');
  for (const d of [root, claudeDir, dataDir, remotes]) mkdirSync(d, { recursive: true });
  for (const p of PROJECTS) {
    projects[p.name] = join(root, p.name);
    buildRepo(projects[p.name], remotes, p);
  }
  buildClaudeHistory(claudeDir, projects);
  return { base, root, claudeDir, dataDir, projects };
}

export const removeWorld = (w: World) => rmSync(w.base, { recursive: true, force: true });
