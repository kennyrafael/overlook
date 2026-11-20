/**
 * End-to-end API tests against the compiled server (dist/), in an isolated
 * temp folder: fixture projects, fixture Claude history, empty database.
 * Run with `npm run test:e2e -w @overlook/api` (builds first).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { request as httpRequest } from 'http';
import type { AddressInfo } from 'net';
import { join } from 'path';
import { createFixture, PLAN, type Fixture } from './fixture';
import { DEFAULT_CLAUDE_TASK_PROMPT } from '@overlook/shared';

let fx: Fixture;
let base = '';
let app: { close(): Promise<void> } | null = null;

const H = { 'Content-Type': 'application/json', 'x-cpd-client': '1' };

async function api<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}/api${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : (undefined as T) };
}

/** Raw request so the Host header can be forged (fetch does not allow it). */
function rawStatus(path: string, headers: Record<string, string>, method = 'GET'): Promise<number> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: url.hostname, port: url.port, path: `/api${path}`, method, headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  fx = createFixture();
  process.env.CPD_DATA_DIR = fx.dataDir;
  process.env.CLAUDE_CONFIG_DIR = fx.claudeDir;
  // Import after the env is set: the data dir is read at module load.
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const { configure } = require('../dist/configure');
  const nest = configure(await NestFactory.create(AppModule, { logger: false }));
  await nest.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(nest.getHttpServer().address() as AddressInfo).port}`;
  app = nest;

  const s = await api('/settings', { method: 'PUT', body: JSON.stringify({ roots: [fx.root], useClaudeHistory: true }) });
  assert.equal(s.status, 200);
});

after(async () => {
  await app?.close();
  // Retries: on Windows a watcher on a fixture repo's .git can hold the folder for a moment after close.
  rmSync(fx.base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const project = async (name: string) => (await api<any[]>('/projects')).body.find((p) => p.name === name);

describe('discovery', () => {
  test('finds both projects and merges Claude history into alpha', async () => {
    const { body } = await api<any[]>('/projects/rescan', { method: 'POST' });
    const names = body.map((p) => p.name).sort();
    assert.deepEqual(names, ['alpha', 'beta']);
    const alpha = body.find((p) => p.name === 'alpha');
    assert.equal(alpha.source, 'both');
    assert.equal(alpha.claudeSessions, 1);
    assert.deepEqual(alpha.planFiles, ['PLAN.md']);
    assert.equal(alpha.milestonesTotal, 2);
    assert.equal(alpha.tasksDone, 1);
    assert.equal(alpha.progress, 0);
    const beta = body.find((p) => p.name === 'beta');
    assert.equal(beta.milestonesTotal, 0); // CLAUDE.md without checklists
  });
});

describe('tasks write-back', () => {
  test('status change rewrites only the checkbox and keeps a backup outside the project', async () => {
    const alpha = await project('alpha');
    const detail = (await api(`/projects/${alpha.id}`)).body;
    const parser = detail.milestones[0].tasks.find((t: any) => t.text.startsWith('parser'));
    const res = await api(`/projects/${alpha.id}/tasks/${parser.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
    assert.equal(res.status, 200);
    assert.equal(res.body.milestonesReached, 1);
    assert.equal(readFileSync(fx.plan, 'utf8'), PLAN.replace('- [ ] parser', '- [x] parser'));
    assert.deepEqual(readdirSync(fx.alpha).sort(), ['PLAN.md']); // nothing else written into the project
    const backups = readdirSync(join(fx.dataDir, 'backups'));
    assert.equal(backups.length, 1);
  });

  test('add and delete a task', async () => {
    const alpha = await project('alpha');
    const ms2 = (await api(`/projects/${alpha.id}`)).body.milestones[1];
    const added = await api(`/projects/${alpha.id}/milestones/${ms2.id}/tasks`, { method: 'POST', body: JSON.stringify({ text: 'monitor', status: 'in_progress' }) });
    assert.equal(added.status, 201);
    assert.match(readFileSync(fx.plan, 'utf8'), /- \[ \] deploy\n- \[~\] monitor\n/);
    const task = added.body.milestones[1].tasks.find((t: any) => t.text === 'monitor');
    const del = await api(`/projects/${alpha.id}/tasks/${task.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.doesNotMatch(readFileSync(fx.plan, 'utf8'), /monitor/);
  });

  test('a task changed on disk returns 409 and the file is left alone', async () => {
    const alpha = await project('alpha');
    const deploy = (await api(`/projects/${alpha.id}`)).body.milestones[1].tasks[0];
    const edited = readFileSync(fx.plan, 'utf8').replace('deploy', 'deploy to prod');
    writeFileSync(fx.plan, edited);
    const res = await api(`/projects/${alpha.id}/tasks/${deploy.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
    assert.equal(res.status, 409);
    assert.equal(readFileSync(fx.plan, 'utf8'), edited);
  });

  test('rejects bad input', async () => {
    const alpha = await project('alpha');
    const t = (await api(`/projects/${alpha.id}`)).body.milestones[0].tasks[0];
    assert.equal((await api(`/projects/${alpha.id}/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'nope' }) })).status, 400);
    assert.equal((await api(`/projects/${alpha.id}/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ text: '   ' }) })).status, 400);
  });
});

describe('live events', () => {
  test('a dashboard edit is pushed over SSE', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const seen: string[] = [];
    const reading = (async () => {
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += new TextDecoder().decode(value);
        for (const m of buf.matchAll(/event: (\S+)/g)) seen.push(m[1]);
        if (seen.includes('project:updated')) return;
      }
    })();

    const alpha = await project('alpha');
    const t = (await api(`/projects/${alpha.id}`)).body.milestones[0].tasks[0];
    await api(`/projects/${alpha.id}/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'todo' }) });
    await Promise.race([reading, new Promise((_, rej) => setTimeout(() => rej(new Error(`no event; saw ${seen}`)), 5000))]);
    ctrl.abort();
    assert.ok(seen.includes('hello'));
    assert.ok(seen.includes('project:updated'));
  });
});

describe('insights', () => {
  test('Claude usage is deduplicated and priced', async () => {
    const { body } = await api('/insights/claude');
    assert.equal(body.totals.sessions, 1);
    assert.equal(body.totals.prompts, 1);
    assert.equal(body.totals.turns, 2); // m1 counted once + m2
    const opus = body.byModel.find((m: any) => m.model === 'claude-opus-5-5');
    // 1000×$4 + 2000×$20 + 1000×$4×2 (1 h cache write) + 10000×$0.20, per million
    assert.ok(Math.abs(opus.costUsd - 0.054) < 1e-9, `opus cost ${opus.costUsd}`);
    assert.equal(body.sessions[0].title, 'Parser work');
    assert.equal(body.byProject[0].name, 'alpha');
  });

  test('progress snapshot exists for today', async () => {
    const alpha = await project('alpha');
    const { body } = await api(`/insights/progress?projects=${alpha.id}&days=7`);
    assert.ok(body.length >= 1);
    assert.equal(body.at(-1).milestonesTotal, 2);
  });

  test('bad date is rejected', async () => {
    assert.equal((await api('/insights/claude?from=yesterday')).status, 400);
  });
});

describe('saved views', () => {
  test('create, rename, list, delete; unknown fields are dropped', async () => {
    const c = await api('/views', { method: 'POST', body: JSON.stringify({ name: ' Mine ', filters: { statuses: ['active', 'bad'], evil: 1 } }) });
    assert.equal(c.status, 201);
    assert.equal(c.body.name, 'Mine');
    assert.deepEqual(c.body.filters.statuses, ['active']);
    assert.equal('evil' in c.body.filters, false);
    assert.equal((await api(`/views/${c.body.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Ours' }) })).body.name, 'Ours');
    assert.equal((await api('/views')).body.length, 1);
    assert.equal((await api(`/views/${c.body.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await api('/views')).body.length, 0);
  });
});

describe('quick actions', () => {
  test('only whitelisted actions for known projects', async () => {
    const alpha = await project('alpha');
    assert.equal((await api(`/projects/${alpha.id}/actions/rm`, { method: 'POST' })).status, 400);
    assert.equal((await api('/projects/unknown/actions/explorer', { method: 'POST' })).status, 404);
  });
  // None of these reach a launch: each is refused first (503 where Claude Code is not installed, e.g. in CI).
  test('Claude task and resume requests are validated before anything starts', async () => {
    const alpha = await project('alpha');
    const post = (action: string, body: unknown) => api(`/projects/${alpha.id}/actions/${action}`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal((await post('vscode', { taskId: 'x' })).status, 400);
    assert.equal((await post('claude', { taskId: 'x', resume: '3f2b9c1e-8a4d-4e2f-9b6a-1c2d3e4f5a6b' })).status, 400);
    assert.ok([400, 503].includes((await post('claude', { resume: '..\\..\\evil; rm -rf ~' })).status));
    assert.ok([404, 503].includes((await post('claude', { resume: '3f2b9c1e-8a4d-4e2f-9b6a-1c2d3e4f5a6b' })).status));
    assert.ok([404, 503].includes((await post('claude', { taskId: 'no-such-task' })).status));
  });
  test('task sessions need a project and answer a map', async () => {
    const alpha = await project('alpha');
    assert.equal((await api('/insights/task-sessions')).status, 400);
    const r = await api(`/insights/task-sessions?project=${alpha.id}`);
    assert.equal(r.status, 200);
    assert.equal(typeof r.body, 'object');
  });
  test('the task prompt setting is one bounded line that mentions the task', async () => {
    const put = (claudeTaskPrompt: string) => api('/settings', { method: 'PUT', body: JSON.stringify({ claudeTaskPrompt }) });
    assert.equal((await put('Do\nthis')).body.claudeTaskPrompt, 'Do this {task}');
    assert.equal((await put('   ')).body.claudeTaskPrompt, DEFAULT_CLAUDE_TASK_PROMPT);
    assert.equal((await put('Fix {task} now' + 'x'.repeat(900))).body.claudeTaskPrompt.length, 500);
    await put(DEFAULT_CLAUDE_TASK_PROMPT);
  });
  test('tool detection reports what is installed', async () => {
    const { status, body } = await api('/system/tools');
    assert.equal(status, 200);
    for (const k of ['git', 'claude', 'vscode']) assert.equal(typeof body[k], 'boolean', k);
    assert.ok(Array.isArray(body.wslClaude));
    // The fixture's Claude history folder is reported as the local source.
    assert.ok(body.claudeHistory.some((h: { label: string }) => h.label === 'local'));
  });
});

describe('first-run setup', () => {
  test('onboarded and useWsl are settings that can be saved', async () => {
    const before = (await api('/settings')).body;
    assert.equal(typeof before.onboarded, 'boolean');
    assert.equal(typeof before.useWsl, 'boolean');
    const after = (await api('/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true, useWsl: 'yes' }) })).body;
    assert.equal(after.onboarded, true);
    assert.equal(after.useWsl, before.useWsl, 'wrong type is ignored');
  });
});

describe('local-only protection', () => {
  test('changes need the client header', async () => {
    assert.equal(await rawStatus('/settings', { 'Content-Type': 'application/json' }, 'PUT'), 403);
  });
  test('foreign Host (DNS rebinding) is refused', async () => {
    assert.equal(await rawStatus('/projects', { Host: 'evil.example' }), 403);
  });
  test('foreign Origin is refused', async () => {
    assert.equal(await rawStatus('/projects', { Origin: 'https://evil.example' }), 403);
  });
  test('plain reads still work', async () => {
    assert.equal(await rawStatus('/health', {}), 200);
    assert.ok(existsSync(fx.plan));
  });
});

describe('about', () => {
  test('returns version, MIT license and third-party notices', async () => {
    const { status, body } = await api('/system/about');
    assert.equal(status, 200);
    assert.match(body.version, /^\d+\.\d+\.\d+/);
    assert.match(body.license, /MIT License/);
    assert.match(body.notices, /\S/);
  });
});

describe('feedback', () => {
  /** A stand-in for the feedback Worker: records what the API forwards and answers with `status`. */
  async function inbox(status = 201) {
    const { createServer } = require('http') as typeof import('http');
    const got: { body: any; headers: Record<string, unknown> }[] = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        got.push({ body: JSON.parse(raw), headers: req.headers });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status < 300 ? { ok: true } : { ok: false, error: 'Inbox down' }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.OVERLOOK_FEEDBACK_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/feedback`;
    return { got, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  test('forwards only the validated answers, marked as from the app', async () => {
    const box = await inbox();
    try {
      const r = await api('/feedback', { method: 'POST', body: JSON.stringify({ kind: 'pro', pay: 'yes', features: ['sync'], price: 'lt5', email: 'a@b.co', consent: true, source: 'site', path: 'C:/secret', extra: 1 }) });
      assert.equal(r.status, 201);
      assert.deepEqual(r.body, { ok: true });
      assert.equal(box.got.length, 1);
      const { version, ...rest } = box.got[0].body;
      assert.match(version, /^\d+\.\d+\.\d+/);
      assert.deepEqual(rest, { kind: 'pro', source: 'app', pay: 'yes', features: ['sync'], price: 'lt5', email: 'a@b.co', consent: true });
      assert.equal(box.got[0].headers.cookie, undefined);
    } finally { await box.close(); }
  });

  test('invalid answers are refused locally and never sent', async () => {
    const box = await inbox();
    try {
      const r = await api('/feedback', { method: 'POST', body: JSON.stringify({ kind: 'idea', text: '', email: 'a@b.co' }) });
      assert.equal(r.status, 400);
      assert.deepEqual(Object.keys(r.body.errors).sort(), ['consent', 'text']);
      assert.equal(box.got.length, 0);
    } finally { await box.close(); }
  });

  test('an inbox error becomes a readable 502', async () => {
    const box = await inbox(500);
    try {
      const r = await api('/feedback', { method: 'POST', body: JSON.stringify({ kind: 'idea', text: 'Hello' }) });
      assert.equal(r.status, 502);
      assert.equal(r.body.message, 'Inbox down');
    } finally { await box.close(); delete process.env.OVERLOOK_FEEDBACK_URL; }
  });

  test('Network activity lists the feedback endpoint', async () => {
    const r = await api('/system/info');
    assert.ok(r.body.network.some((c: any) => c.what === 'Feedback' && c.destination.includes('overlook-feedback')));
  });
});

describe('phase 7: time and tokens', () => {
  const sessionId = async () => (await api('/insights/claude')).body.sessions[0].id as string;

  test('session detail: prompts, tools, edited files and cost per prompt', async () => {
    const overview = (await api('/insights/claude')).body;
    const s = overview.sessions[0];
    const { status, body } = await api(`/insights/sessions/${s.id}`);
    assert.equal(status, 200);
    assert.equal(body.title, 'Parser work');
    assert.equal(body.projectName, 'alpha');
    assert.deepEqual(body.prompts.map((p: any) => p.text), ['build the parser']);
    assert.deepEqual(body.tools, [{ tool: 'Bash', calls: 1, errors: 1 }, { tool: 'Edit', calls: 1, errors: 0 }]);
    assert.deepEqual(body.edited, [{ path: 'src/parser.ts', edits: 1 }]);
    assert.equal(body.totals.turns, 2);
    assert.ok(Math.abs(body.totals.costUsd - s.costUsd) < 1e-9);
    assert.equal(body.perPrompt.length, 1);
    assert.equal(body.perPrompt[0].turns, 2);
    assert.ok(Math.abs(body.perPrompt[0].costUsd - s.costUsd) < 1e-9);
    assert.equal(body.durationMs, 3_600_000);
  });

  test('session ids must be UUIDs; unknown ones are 404', async () => {
    assert.equal((await api('/insights/sessions/s1')).status, 400);
    assert.equal((await api(`/insights/sessions/${encodeURIComponent('../../etc/passwd')}`)).status, 400);
    assert.equal((await api('/insights/sessions/3f2b9c1e-8a4d-4e2f-9b6a-1c2d3e4f5a6b')).status, 404);
  });

  test('overview has tool counts and the rolling usage windows', async () => {
    const { body } = await api('/insights/claude');
    assert.deepEqual(body.byTool, [{ tool: 'Bash', calls: 1, errors: 1 }, { tool: 'Edit', calls: 1, errors: 0 }]);
    assert.deepEqual(body.toolsOverall, { calls: 2, errors: 1 });
    assert.deepEqual(body.rolling.map((w: any) => [w.key, w.hours]), [['5h', 5], ['7d', 168]]);
    const beta = await project('beta');
    const other = (await api(`/insights/claude?projects=${beta.id}`)).body;
    assert.deepEqual(other.byTool, []);
    assert.deepEqual(other.toolsOverall, { calls: 2, errors: 1 });
  });

  test('search finds prompts and titles, highlights them, and never fails on odd input', async () => {
    const id = await sessionId();
    const hits = (await api('/insights/search?q=parser')).body;
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, id);
    assert.equal(hits[0].title, 'Parser work');
    assert.equal(hits[0].projectName, 'alpha');
    assert.ok(hits[0].snippet.includes('\u0002parser\u0003'), hits[0].snippet);
    const title = (await api('/insights/search?q=work')).body;
    assert.equal(title[0]?.matchedIn, 'title');
    assert.equal((await api('/insights/search?q=bui')).body.length, 1);
    for (const q of ['"build', 'build"the', 'NOT OR AND (', 'title:parser', "'; DROP TABLE claude_prompts; --", '*', 'NEAR(build parser)', '\u0000']) {
      const r = await api(`/insights/search?q=${encodeURIComponent(q)}`);
      assert.equal(r.status, 200, q);
      assert.ok(Array.isArray(r.body), q);
    }
    assert.equal((await api(`/insights/search?q=${encodeURIComponent('"build" parser')}`)).body.length, 1);
    assert.deepEqual((await api('/insights/search?q=')).body, []);
    const beta = await project('beta');
    assert.deepEqual((await api(`/insights/search?q=parser&projects=${beta.id}`)).body, []);
    const alpha = await project('alpha');
    assert.equal((await api(`/insights/search?q=parser&projects=${alpha.id}`)).body.length, 1);
  });

  test('milestone costs: a session that matches no task is reported apart', async () => {
    const alpha = await project('alpha');
    assert.equal((await api('/insights/milestone-costs')).status, 400);
    const { body } = await api(`/insights/milestone-costs?project=${alpha.id}`);
    const s = (await api('/insights/claude')).body.sessions[0];
    // "build the parser" shares one word with the task "parser"; the matcher needs two, so nothing is claimed.
    assert.equal(s.task, null);
    assert.deepEqual(body.milestones, []);
    assert.equal(body.unmatched.sessions, 1);
    assert.ok(Math.abs(body.unmatched.costUsd - s.costUsd) < 1e-9);
  });
});

describe('phase 8 daily overview', () => {
  const { execFileSync } = require('child_process') as typeof import('child_process');
  const hasGit = (() => { try { execFileSync('git', ['--version']); return true; } catch { return false; } })();
  const device = 'e2e-device-0123456789';
  const OLD = new Date(Date.now() - 60 * 86_400_000).toISOString();
  /** git in a fixture folder (never in the user's repos), with a fixed identity and optional dates. */
  const gitIn = (cwd: string, args: string[], date?: string) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  });
  const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shift = (days: number) => localDay(new Date(Date.now() + days * 86_400_000));
  // Yesterday..tomorrow covers the fixture session (UTC today) and "now" in any time zone.
  const range = { from: shift(-1), to: shift(1) };
  const openTask = async (name: string) => {
    const p = await project(name);
    const detail = (await api(`/projects/${p.id}`)).body;
    return { project: p, task: detail.milestones.flatMap((m: any) => m.tasks).find((t: any) => t.status === 'todo') };
  };

  test('away: the first visit shows nothing; "mark as seen" starts the count', async () => {
    const first = await api(`/insights/away?device=${device}`);
    assert.equal(first.status, 200);
    assert.equal(first.body.since, null);
    assert.equal(first.body.tasksCompleted, 0);
    const seen = await api('/insights/away/seen', { method: 'POST', body: JSON.stringify({ device }) });
    assert.equal(seen.status, 200);
    const again = await api(`/insights/away?device=${device}`);
    assert.equal(again.body.since, seen.body.lastSeenAt);
    assert.deepEqual([again.body.tasksCompleted, again.body.commits, again.body.completed], [0, 0, []]);
  });

  test('away: device ids are validated and marking needs the client header', async () => {
    assert.equal((await api('/insights/away?device=short')).status, 400);
    assert.equal((await api('/insights/away')).status, 400);
    assert.equal((await api('/insights/away/seen', { method: 'POST', body: JSON.stringify({ device: 'a b/../c-0123456789' }) })).status, 400);
    assert.equal(await rawStatus('/insights/away/seen', { host: new URL(base).host }, 'POST'), 403);
  });

  test('away: a task completed through the API and new commits are counted', { skip: !hasGit && 'git not installed' }, async () => {
    // beta becomes a git repository: an old commit on a branch that goes stale, then two commits today.
    gitIn(fx.beta, ['init', '-q']);
    gitIn(fx.beta, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    writeFileSync(join(fx.beta, 'a.txt'), 'a\n');
    gitIn(fx.beta, ['add', '-A']);
    gitIn(fx.beta, ['commit', '-q', '-m', 'Old start'], OLD);
    gitIn(fx.beta, ['branch', 'old-spike']);
    for (const f of ['b', 'c']) {
      writeFileSync(join(fx.beta, `${f}.txt`), `${f}\n`);
      gitIn(fx.beta, ['add', '-A']);
      gitIn(fx.beta, ['commit', '-q', '-m', `Add ${f}`]);
    }

    const { project: alpha, task } = await openTask('alpha');
    assert.ok(task, 'alpha has an open task');
    assert.equal((await api(`/projects/${alpha.id}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })).status, 200);

    const away = (await api(`/insights/away?device=${device}`)).body;
    assert.equal(away.tasksCompleted, 1);
    assert.equal(away.completed[0].text, task.text);
    assert.equal(away.completed[0].projectName, 'alpha');
    assert.equal(away.commits, 2);
    assert.equal(away.projects.find((p: any) => p.name === 'beta').commits, 2);
  });

  test('summary: the edit is a task move and the commits match git log', { skip: !hasGit && 'git not installed' }, async () => {
    const r = await api(`/insights/summary?from=${range.from}&to=${range.to}`);
    assert.equal(r.status, 200);
    const s = r.body;
    const alpha = s.projects.find((p: any) => p.name === 'alpha');
    const beta = s.projects.find((p: any) => p.name === 'beta');
    assert.ok(alpha.moved.some((m: any) => m.to === 'done' && m.file === 'PLAN.md'), 'the API edit is in the history');
    assert.equal(alpha.tasksCompleted, alpha.moved.filter((m: any) => m.to === 'done').length);
    assert.ok(alpha.sessions >= 1 && alpha.durationMs > 0 && alpha.costUsd > 0, 'fixture session counted');

    const since = new Date(`${range.from}T00:00:00`).toISOString();
    const until = new Date(new Date(`${range.to}T00:00:00`).getTime() + 86_400_000).toISOString();
    const log = gitIn(fx.beta, ['log', `--since=${since}`, `--until=${until}`, '--format=%H%x09%s', 'HEAD']).trim().split('\n').map((l) => l.split('\t'));
    assert.deepEqual(beta.recentCommits.map((c: any) => [c.hash, c.subject]), log);
    assert.equal(beta.commits, log.length);
    assert.deepEqual(log.map(([, subject]) => subject), ['Add c', 'Add b']);

    const sum = (k: string) => s.projects.reduce((n: number, p: any) => n + p[k], 0);
    assert.equal(s.totals.commits, sum('commits'));
    assert.equal(s.totals.sessions, sum('sessions'));
    assert.equal(s.totals.tasksCompleted, sum('tasksCompleted'));
  });

  test('summary: dates are validated and limited to 31 days', async () => {
    for (const q of ['', '?from=2026-11-01', '?from=2026-11-10&to=2026-11-01', '?from=2026-02-30&to=2026-03-01', '?from=2026-01-01&to=2026-02-15', '?from=x&to=y']) {
      assert.equal((await api(`/insights/summary${q}`)).status, 400, q);
    }
    assert.equal((await api('/insights/summary?from=2026-01-01&to=2026-01-31')).status, 200);
  });

  test('branches and worktrees of a repository, read-only and only for known repos', { skip: !hasGit && 'git not installed' }, async () => {
    const beta = await project('beta');
    const r = await api(`/insights/git/branches?project=${beta.id}&repo=`);
    assert.equal(r.status, 200);
    const byName = Object.fromEntries(r.body.branches.map((b: any) => [b.name, b]));
    assert.deepEqual([byName.main.current, byName.main.stale, byName.main.upstream], [true, false, null]);
    assert.deepEqual([byName['old-spike'].stale, byName['old-spike'].merged], [true, true]);
    assert.equal(r.body.worktrees.length, 1);
    assert.equal(r.body.worktrees[0].main, true);
    assert.equal(r.body.worktrees[0].branch, 'main');
    assert.equal((await api(`/insights/git/branches?project=${beta.id}&repo=..`)).status, 404);
    assert.equal((await api('/insights/git/branches?project=000000000000')).status, 404);
    assert.equal((await api('/insights/git/branches?project=../x')).status, 400);
  });
});

describe('phase 6: plans you can trust', () => {
  const { execFileSync } = require('child_process') as typeof import('child_process');
  const gitOk = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  const detail = async (name: string) => (await api(`/projects/${(await project(name)).id}`)).body;

  before(async () => {
    // The messy and fresh projects live in a second root, so the tests above keep seeing two projects.
    if (gitOk) {
      // Commit the messy plan 30 days ago: its in-progress task is then stale.
      const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const env = { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old };
      const g = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: fx.messy, env, stdio: 'ignore' });
      g('init', '-q');
      g('add', 'PLAN.md');
      g('commit', '-q', '-m', 'plan');
    }
    await api('/settings', { method: 'PUT', body: JSON.stringify({ roots: [fx.root, fx.extraRoot], staleTaskDays: 7 }) });
    await api('/projects/rescan', { method: 'POST' });
  });

  after(async () => {
    await api('/settings', { method: 'PUT', body: JSON.stringify({ roots: [fx.root] }) });
    await api('/projects/rescan', { method: 'POST' });
  });

  test('the fixture project with known mistakes gets every warning', async () => {
    const d = await detail('messy');
    const got = d.planWarnings.map((w: any) => `${w.relFile}:${w.line} ${w.kind}`).sort();
    const want = [
      'PLAN.md:1 task-outside-milestone',
      'PLAN.md:5 malformed-heading', // ##Phase 1
      'PLAN.md:8 malformed-heading', // ✓
      'PLAN.md:11 malformed-heading', // (due 2026-02-30)
      ...[12, 13, 14, 15, 16, 17, 18].map((l) => `PLAN.md:${l} malformed-task`),
      'PLAN.md:20 duplicate-task',
      'TODO.md:0 file-too-large',
    ].sort();
    assert.deepEqual(got, want);
    for (const w of d.planWarnings) {
      assert.ok(w.message && w.fix, `message and fix for ${w.kind}`);
      assert.equal(w.file, join(fx.messy, w.relFile));
    }
    // Healthy plans show nothing, and the list endpoint stays small.
    assert.deepEqual((await detail('alpha')).planWarnings, []);
    assert.equal('planWarnings' in (await project('alpha')), false);
  });

  test('due dates: title without the suffix, date on the milestone', async () => {
    const d = await detail('messy');
    const p4 = d.milestones.find((m: any) => m.title === 'Phase 4');
    assert.equal(p4.due, '2020-01-15');
    assert.equal(d.milestones.find((m: any) => m.title.startsWith('Phase 3')).due, null); // not a real date
    assert.ok((await detail('alpha')).milestones.every((m: any) => m.due === null));
  });

  test('stale work comes from git blame and Settings → staleTaskDays', { skip: !gitOk && 'git not installed' }, async () => {
    const d = await detail('messy');
    const t = d.milestones.find((m: any) => m.title === 'Phase 4').tasks[0];
    assert.ok(t.inProgressSince, 'committed line has a time');
    const stale = (await api('/plans/stale')).body;
    const s = stale.find((x: any) => x.text === 'overdue work');
    assert.ok(s && s.days >= 29 && s.projectName === 'messy', JSON.stringify(stale));
    // An uncommitted change to the line resets it to "unknown", never stale.
    const res = await api(`/projects/${d.id}/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ text: 'overdue work, again' }) });
    const changed = res.body.milestones.find((m: any) => m.title === 'Phase 4').tasks[0];
    assert.equal(changed.inProgressSince, null);
    assert.ok(!(await api('/plans/stale')).body.some((x: any) => x.projectName === 'messy'));
    // The setting is validated: below 1 keeps the old value.
    assert.equal((await api('/settings', { method: 'PUT', body: JSON.stringify({ staleTaskDays: 0 }) })).body.staleTaskDays, 7);
    assert.equal((await api('/settings', { method: 'PUT', body: JSON.stringify({ staleTaskDays: 3.7 }) })).body.staleTaskDays, 3);
  });

  test('move a task to a milestone in another plan file; both backed up; stale ids are a 409', async () => {
    const d = await detail('messy');
    const task = d.milestones.find((m: any) => m.title.startsWith('Phase 2')).tasks[0];
    const backlog = d.milestones.find((m: any) => m.title === 'Backlog');
    const backupsBefore = readdirSync(join(fx.dataDir, 'backups')).length;
    const r = await api(`/projects/${d.id}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ milestoneId: backlog.id }) });
    assert.equal(r.status, 200);
    assert.doesNotMatch(readFileSync(join(fx.messy, 'PLAN.md'), 'utf8'), /done thing/);
    assert.match(readFileSync(join(fx.messy, 'TODO.md'), 'utf8'), /^- \[ \] someday\n- \[x\] done thing\n/m);
    assert.ok(readdirSync(join(fx.dataDir, 'backups')).length >= backupsBefore + 1);
    // The old id is gone: refused, nothing written.
    const todo = readFileSync(join(fx.messy, 'TODO.md'), 'utf8');
    assert.equal((await api(`/projects/${d.id}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ milestoneId: backlog.id }) })).status, 409);
    assert.equal((await api(`/projects/${d.id}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ milestoneId: 7 }) })).status, 400);
    assert.equal(readFileSync(join(fx.messy, 'TODO.md'), 'utf8'), todo);
    assert.deepEqual(readdirSync(fx.messy).sort(), ['.git', 'PLAN.md', 'TODO.md'].filter((n) => gitOk || n !== '.git'));
  });

  test('create a plan file: fixed templates, preview equals what is written, never overwrites', async () => {
    const fresh = await project('fresh');
    assert.equal(fresh.milestonesTotal, 0);
    const templates = (await api(`/projects/${fresh.id}/plan-templates`)).body;
    assert.deepEqual(templates.map((t: any) => t.id), ['basic', 'phases']);
    assert.equal(templates[0].fileName, 'PLAN.md');
    const post = (id: string, body: unknown) => api(`/projects/${id}/plan-file`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal((await post(fresh.id, { template: '# my own text' })).status, 400);
    assert.equal(existsSync(join(fx.fresh, 'PLAN.md')), false, 'nothing written before a valid request');
    const made = await post(fresh.id, { template: 'basic' });
    assert.equal(made.status, 201);
    assert.equal(made.body.milestonesTotal, 3);
    assert.equal(readFileSync(join(fx.fresh, 'PLAN.md'), 'utf8'), templates[0].content);
    assert.equal((await post(fresh.id, { template: 'phases' })).status, 409);
    assert.equal(readFileSync(join(fx.fresh, 'PLAN.md'), 'utf8'), templates[0].content);
    assert.equal((await post((await project('alpha')).id, { template: 'basic' })).status, 409);
  });
});
