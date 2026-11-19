// Feedback Worker and form validation. Run from the repo root: npm test (or
// node --import tsx --test workers/feedback/test/worker.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDEA_CATEGORIES, PAY_ANSWERS, PRICE_RANGES, PRO_FEATURES, validateFeedback } from '../../../packages/shared/src/feedback';
import * as site from '../../../site/src/feedback-model';
import { ALLOWED_ORIGIN, handle, type Env } from '../src/index';

/** In-memory stand-in for D1: records the statements and keeps inserted rows. */
function fakeEnv(opts: { limited?: boolean; count?: number } = {}) {
  const rows: unknown[][] = [];
  const sql: string[] = [];
  const statement = (q: string) => {
    let args: unknown[] = [];
    const st = {
      bind: (...v: unknown[]) => { args = v; return st; },
      run: async () => { sql.push(q); if (q.startsWith('INSERT')) rows.push(args); return {}; },
      first: async <T>() => { sql.push(q); return { n: opts.count ?? rows.length } as T; },
    };
    return st;
  };
  const keys: string[] = [];
  const env: Env = {
    DB: { prepare: statement, batch: async (list) => { for (const s of list) await s.run(); } },
    LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: !opts.limited }; } },
  };
  return { env, rows, sql, keys };
}

const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://overlook-feedback.example/feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN, 'CF-Connecting-IP': '203.0.113.9', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const PRO = { kind: 'pro', pay: 'maybe', features: ['sync', 'budgets'], other: 'A CLI', price: '5-10' };

test('stores a Pro answer with CORS for the landing page and no IP', async () => {
  const { env, rows, keys } = fakeEnv();
  const res = await handle(post({ ...PRO, email: 'dev@example.com', consent: true, extra: 'ignored' }), env);
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN);
  assert.equal(rows.length, 1);
  const [at, kind, source, version, pay, features, other, price, text, category, email, consentAt] = rows[0];
  assert.match(String(at), /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual([kind, source, version, pay, features, other, price, text, category, email], ['pro', 'site', null, 'maybe', '["sync","budgets"]', 'A CLI', '5-10', null, null, 'dev@example.com']);
  assert.equal(consentAt, at);
  assert.ok(!JSON.stringify(rows).includes('203.0.113.9'), 'the IP address is not stored');
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes('203.0.113.9'), 'the limiter key is a hash');
});

test('stores an idea sent by the app (no Origin header)', async () => {
  const { env, rows } = fakeEnv();
  const res = await handle(post({ kind: 'idea', text: '  Dark mode for the board \r\n please ', category: 'board', source: 'app', version: '0.3.0' }, { Origin: '' }), env);
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(rows[0][1], 'idea');
  assert.equal(rows[0][2], 'app');
  assert.equal(rows[0][3], '0.3.0');
  assert.equal(rows[0][8], 'Dark mode for the board \n please');
  assert.equal(rows[0][10], null);
});

test('rejects other origins, wrong methods, paths and content types', async () => {
  const { env, rows } = fakeEnv();
  assert.equal((await handle(post(PRO, { Origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await handle(new Request('https://x.example/feedback'), env)).status, 405);
  assert.equal((await handle(new Request('https://x.example/other', { method: 'POST' }), env)).status, 404);
  assert.equal((await handle(post(PRO, { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal((await handle(post('{nope'), env)).status, 400);
  assert.equal((await handle(post({ kind: 'pro', pay: 'yes', other: 'x'.repeat(9000) }), env)).status, 413);
  assert.equal(rows.length, 0);
});

test('answers the CORS preflight for the landing page only', async () => {
  const { env } = fakeEnv();
  const ok = await handle(new Request('https://x.example/feedback', { method: 'OPTIONS', headers: { Origin: ALLOWED_ORIGIN } }), env);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Methods'), 'POST');
  const bad = await handle(new Request('https://x.example/feedback', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(bad.status, 403);
});

test('returns field errors and stores nothing for invalid answers', async () => {
  const { env, rows } = fakeEnv();
  const res = await handle(post({ kind: 'pro', pay: 'perhaps', features: ['sync', 'rocket'], price: 'free!!', email: 'not-an-email' }), env);
  assert.equal(res.status, 400);
  const body = await res.json() as { errors: Record<string, string> };
  assert.deepEqual(Object.keys(body.errors).sort(), ['email', 'features', 'pay', 'price']);
  assert.equal(rows.length, 0);
});

test('an email needs the consent box', () => {
  const r = validateFeedback({ kind: 'idea', text: 'x', email: 'a@b.co' });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.consent);
  const noEmail = validateFeedback({ kind: 'idea', text: 'x', consent: true });
  assert.ok(noEmail.ok && noEmail.record.email === null && noEmail.record.consent === false, 'consent without an email stores nothing');
});

test('rate limited and honeypot requests store nothing', async () => {
  const limited = fakeEnv({ limited: true });
  const r1 = await handle(post(PRO), limited.env);
  assert.equal(r1.status, 429);
  assert.equal(r1.headers.get('Retry-After'), '60');
  const bot = fakeEnv();
  assert.equal((await handle(post({ ...PRO, website: 'http://spam.example' }), bot.env)).status, 201);
  assert.equal(bot.rows.length, 0);
});

test('stops at the daily cap', async () => {
  const { env, rows } = fakeEnv({ count: 2000 });
  assert.equal((await handle(post(PRO), env)).status, 503);
  assert.equal(rows.length, 0);
});

test('the landing page offers exactly the choices the Worker accepts', () => {
  const values = (l: readonly { value: string }[]) => l.map((x) => x.value);
  assert.deepEqual(site.PAY_ANSWERS.map((x) => x.value), [...PAY_ANSWERS]);
  assert.deepEqual(values(site.PRO_FEATURES), values(PRO_FEATURES));
  assert.deepEqual(values(site.PRICE_RANGES), values(PRICE_RANGES));
  assert.deepEqual(values(site.IDEA_CATEGORIES), values(IDEA_CATEGORIES));
  assert.deepEqual(site.PRO_FEATURES.map((x) => x.label), PRO_FEATURES.map((x) => x.label));
});
