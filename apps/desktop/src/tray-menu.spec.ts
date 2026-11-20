import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, dynamicItems, label, liveLabel, recentProjects, sseEventNames, startClaudePath, topProjects, type TrayData } from './tray-menu';

const A = 'aaaaaaaaaaaa';
const B = 'bbbbbbbbbbbb';
const p = (id: string, name: string, lastActivityAt: string | null, pinned = false, exists = true) => ({ id, name, lastActivityAt, pinned, exists });

test('API requests carry the launch token cookie and the client header; Start Claude posts an empty body', () => {
  const get = apiRequest('http://127.0.0.1:5000', 'tok', '/api/insights/live');
  assert.equal(get.url, 'http://127.0.0.1:5000/api/insights/live');
  assert.deepEqual(get.init.headers, { 'x-cpd-client': '1', Cookie: 'cpd_token=tok' });
  assert.equal(get.init.method, 'GET');
  assert.equal(get.init.body, undefined);

  const post = apiRequest('http://127.0.0.1:5000', 'tok', startClaudePath(A), 'POST');
  assert.equal(post.url, `http://127.0.0.1:5000/api/projects/${A}/actions/claude`);
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.body, '{}');
  assert.equal((post.init.headers as Record<string, string>)['Content-Type'], 'application/json');

  assert.throws(() => startClaudePath('../../system'));
  assert.throws(() => apiRequest('http://127.0.0.1:5000', 'tok', 'https://example.com/'));
});

test('labels are one bounded line; & stays literal outside macOS', () => {
  assert.equal(label('a\nb\t c', 60, 'win32'), 'a b c');
  assert.equal(label('R&D', 60, 'win32'), 'R&&D');
  assert.equal(label('R&D', 60, 'darwin'), 'R&D');
  assert.equal(label('x'.repeat(100), 10, 'darwin'), `${'x'.repeat(9)}…`);
  const s = { id: 's', projectId: A, title: 'Parser work', state: 'idle' as const, waiting: true };
  assert.equal(liveLabel(s, 'alpha', 'darwin'), 'alpha: Parser work — waiting');
  assert.equal(liveLabel({ ...s, state: 'working', title: null }, 'alpha', 'darwin'), 'alpha: Untitled session — working');
});

test('recent projects by last activity; Start Claude puts pinned first; missing projects are left out', () => {
  const list = [p(A, 'alpha', '2026-11-01T00:00:00Z'), p(B, 'beta', '2026-11-19T00:00:00Z'), p('cccccccccccc', 'gone', '2026-11-20T00:00:00Z', false, false),
    p('dddddddddddd', 'pinned', null, true), ...Array.from({ length: 6 }, (_, i) => p(`e${i}`.padEnd(12, '0'), `old${i}`, '2025-01-01T00:00:00Z'))];
  assert.deepEqual(recentProjects(list).map((x) => x.name), ['beta', 'alpha', 'old0', 'old1', 'old2']);
  assert.deepEqual(topProjects(list).map((x) => x.name), ['pinned', 'beta', 'alpha', 'old0', 'old1']);
});

test('menu items: live sessions open their project, Start Claude calls the action; bad ids are dropped', () => {
  const calls: string[] = [];
  const data: TrayData = {
    live: [{ id: 's1', projectId: A, title: 'Fix', state: 'working', waiting: false }, { id: 's2', projectId: 'not-an-id', title: 'x', state: 'idle', waiting: false }],
    projects: [p(A, 'alpha', '2026-11-19T00:00:00Z')],
  };
  const items = dynamicItems(data, { openProject: (id) => calls.push(`open ${id}`), startClaude: (id) => calls.push(`claude ${id}`) }, 'darwin');
  const labels = items.map((i) => i.label ?? i.type);
  assert.deepEqual(labels, ['separator', 'Live sessions', 'alpha: Fix — working', 'separator', 'Recent projects', 'alpha', 'separator', 'Start Claude in…']);
  (items[2].click as () => void)();
  (items[5].click as () => void)();
  const sub = items[7].submenu as { label: string; click: () => void }[];
  sub[0].click();
  assert.deepEqual(calls, [`open ${A}`, `open ${A}`, `claude ${A}`]);
  assert.deepEqual(dynamicItems({ live: [], projects: [] }, { openProject() {}, startClaude() {} }), []);
});

test('event names are read from an SSE chunk', () => {
  assert.deepEqual(sseEventNames('event: hello\ndata: {}\n\nevent: claude:updated\ndata: {"type":"claude:updated"}\n\n'), ['hello', 'claude:updated']);
});
