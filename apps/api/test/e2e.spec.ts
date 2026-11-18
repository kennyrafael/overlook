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
  rmSync(fx.base, { recursive: true, force: true });
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
