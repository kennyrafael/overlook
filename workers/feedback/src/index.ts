// Overlook feedback inbox: POST /feedback stores one "Would you pay?" or feature-idea response in D1.
// Called by the landing page (CORS: https://overlook.agenthub.pt only) and by the desktop app's local
// API server (no Origin header). Nothing is sent automatically: every row is a form someone submitted.
// Privacy: no IP address, user agent, cookie or project data is stored. The IP is only used, hashed and
// in memory, as the key of Cloudflare's rate limiter.
import { FEEDBACK_LIMITS, validateFeedback, type FeedbackRecord } from '../../../packages/shared/src/feedback';

export const ALLOWED_ORIGIN = 'https://overlook.agenthub.pt';
/** At most this many stored responses per UTC day, whatever the source (abuse guard). */
export const DAILY_CAP = 2000;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    version TEXT,
    pay TEXT,
    features TEXT NOT NULL DEFAULT '[]',
    other TEXT,
    price TEXT,
    text TEXT,
    category TEXT,
    email TEXT,
    consent_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created_at)',
  'CREATE INDEX IF NOT EXISTS feedback_email ON feedback (email)',
];

// The few D1 / rate-limiter shapes used here (no @cloudflare/workers-types dependency).
interface Statement { bind(...v: unknown[]): Statement; run(): Promise<unknown>; first<T>(): Promise<T | null> }
export interface Env {
  DB: { prepare(sql: string): Statement; batch(s: Statement[]): Promise<unknown> };
  LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

let schemaReady: Promise<unknown> | null = null;
/** Creates the table on first use (once per Worker instance), so no migration step is needed. */
function ensureSchema(env: Env) {
  schemaReady ??= env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function store(env: Env, r: FeedbackRecord, now = new Date()): Promise<void> {
  const at = now.toISOString();
  await env.DB.prepare(
    'INSERT INTO feedback (created_at, kind, source, version, pay, features, other, price, text, category, email, consent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(at, r.kind, r.source, r.version, r.pay, JSON.stringify(r.features), r.other, r.price, r.text, r.category, r.email, r.consent ? at : null).run();
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get('Origin');
  // Browsers send Origin on cross-site POSTs: only the landing page may call this from a browser.
  // The app's API server (Node) sends none.
  if (origin && origin !== ALLOWED_ORIGIN) return json({ ok: false, error: 'Forbidden origin' }, 403);
  const cors: Record<string, string> = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
  const reply = (body: unknown, status: number, extra: Record<string, string> = {}) => json(body, status, { ...cors, ...extra });

  if (url.pathname !== '/feedback') return reply({ ok: false, error: 'Not found' }, 404);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
  }
  if (req.method !== 'POST') return reply({ ok: false, error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' });
  if (!(req.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) return reply({ ok: false, error: 'Send JSON' }, 415);
  if (Number(req.headers.get('Content-Length') ?? 0) > FEEDBACK_LIMITS.body) return reply({ ok: false, error: 'Too large' }, 413);

  if (env.LIMITER) {
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.LIMITER.limit({ key: await sha256(`overlook-feedback:${ip}`) });
    if (!success) return reply({ ok: false, error: 'Too many responses from your network. Try again in a minute.' }, 429, { 'Retry-After': '60' });
  }

  const raw = await req.text();
  if (raw.length > FEEDBACK_LIMITS.body) return reply({ ok: false, error: 'Too large' }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ ok: false, error: 'Invalid JSON' }, 400); }

  const result = validateFeedback(body);
  if (!result.ok) return reply({ ok: false, errors: result.errors }, 400);
  if (result.spam) return reply({ ok: true }, 201); // honeypot filled in: pretend it worked, store nothing

  try {
    await ensureSchema(env);
    const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE created_at >= ?').bind(new Date().toISOString().slice(0, 10)).first<{ n: number }>();
    if ((today?.n ?? 0) >= DAILY_CAP) return reply({ ok: false, error: 'The inbox is full for today. Try again tomorrow.' }, 503);
    await store(env, result.record);
  } catch (e) {
    console.error('feedback: storing failed', e);
    return reply({ ok: false, error: 'Could not save your response. Try again later.' }, 500);
  }
  return reply({ ok: true }, 201);
}

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

export default { fetch: handle };
