// GET /stats: the download and update-check reports (src/report.js) as one HTML page, for the owner only.
//
// Off (404) unless all three Worker secrets are set:
//   STATS_PASSWORD         the page's password (HTTP Basic auth; any user name). Use a long random one.
//   CLOUDFLARE_ACCOUNT_ID  the account that holds the `overlook` Analytics Engine dataset
//   CLOUDFLARE_API_TOKEN   a token with only "Account Analytics: Read"
// Analytics Engine has no read binding, so the Worker reads its own dataset through the SQL API.
// Server-rendered, no JavaScript; never cached, never indexed.
import { fetchReports } from './report.js';

const DAYS = [7, 30, 90];

export const statsEnabled = (env) => !!(env.STATS_PASSWORD && env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);

/** Constant-time password check: both sides are hashed first, so lengths and early mismatches don't leak. */
async function passwordOk(req, password) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m) return false;
  let given;
  try { given = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))); } catch { return false; }
  given = given.slice(given.indexOf(':') + 1);
  const hash = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([hash(given), hash(password)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export async function statsPage(req, env, fetchFn = fetch) {
  if (!(await passwordOk(req, env.STATS_PASSWORD))) {
    return new Response('Password required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Overlook stats", charset="UTF-8"', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }
  const asked = Number(new URL(req.url).searchParams.get('days'));
  const days = DAYS.includes(asked) ? asked : 30;
  let body;
  let status = 200;
  try {
    const reports = await fetchReports({ accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN, days, fetchFn });
    body = render(days, Object.fromEntries(reports.map((r) => [r.title, r.rows])));
  } catch (e) {
    status = 502;
    body = page(days, `<p class="error">Could not read the numbers from Cloudflare.</p><pre>${esc(String(e.message ?? e))}</pre>`);
  }
  return new Response(req.method === 'HEAD' ? null : body, { status, headers: HEADERS });
}

// ---- Rendering ----

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
const day = (v) => String(v ?? '').slice(0, 10);
const PLATFORM = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
const sum = (rows, col) => rows.reduce((t, r) => t + (Number(r[col]) || 0), 0);

/** Every day in the window, oldest first, so gaps show as zero instead of disappearing. */
function daysBack(days) {
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) out.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10));
  return out;
}

function table(cols, rows, empty = 'None yet.') {
  if (!rows.length) return `<p class="empty">${empty}</p>`;
  return `<div class="table"><table><thead><tr>${cols.map(([label, , n]) => `<th${n ? ' class="n"' : ''}>${esc(label)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${cols.map(([, f, n]) => `<td${n ? ' class="n"' : ''}>${f(r)}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;
}

function render(days, r) {
  const totals = Object.fromEntries((r['Totals'] ?? []).map((row) => [row.kind, row.count]));
  const byVersion = r['Downloads by version and platform'] ?? [];
  const perDay = new Map((r['Downloads per day'] ?? []).map((row) => [day(row.day), Number(row.downloads) || 0]));
  const checks = r['Update checks per day (about one per running copy)'] ?? [];

  // Downloads per platform, for the tiles.
  const platforms = ['windows', 'macos', 'linux'].map((p) => [p, sum(byVersion.filter((row) => row.platform === p), 'downloads')]);

  // Update checks: one row per day, one column per platform. The latest full day is the best "copies in use" estimate.
  const checkDays = [...new Set(checks.map((c) => day(c.day)))].sort().reverse();
  const checkPlatforms = [...new Set(checks.map((c) => c.platform))].sort();
  const checkRows = checkDays.map((d) => ({ d, ...Object.fromEntries(checkPlatforms.map((p) => [p, sum(checks.filter((c) => day(c.day) === d && c.platform === p), 'checks')])) }));
  const today = new Date().toISOString().slice(0, 10);
  const lastFull = checkRows.find((row) => row.d !== today);
  const inUse = lastFull ? checkPlatforms.reduce((t, p) => t + lastFull[p], 0) : 0;

  const series = daysBack(days).map((d) => [d, perDay.get(d) ?? 0]);
  const max = Math.max(1, ...series.map(([, n]) => n));

  return page(days, `
    <section class="tiles">
      <div class="tile"><span>Downloads</span><strong>${num(totals.download)}</strong><small>from the website</small></div>
      <div class="tile"><span>Update downloads</span><strong>${num(totals['update-download'])}</strong><small>fetched by the app</small></div>
      <div class="tile"><span>Copies in use</span><strong>${num(inUse)}</strong><small>${lastFull ? `update checks on ${esc(lastFull.d)}` : 'no update checks yet'}</small></div>
    </section>
    <section class="tiles">
      ${platforms.map(([p, n]) => `<div class="tile small"><span>${PLATFORM[p]}</span><strong>${num(n)}</strong></div>`).join('')}
    </section>

    <h2>Downloads per day</h2>
    <div class="bars" role="img" aria-label="Downloads per day for the last ${days} days">
      ${series.map(([d, n]) => `<div class="bar" title="${esc(d)}: ${num(n)}"><i style="height:${((n / max) * 100).toFixed(1)}%"></i></div>`).join('')}
    </div>
    <div class="axis"><span>${esc(series[0][0])}</span><span>max ${num(max)} / day</span><span>${esc(series.at(-1)[0])}</span></div>

    <h2>Downloads by version and platform</h2>
    ${table([['Version', (x) => esc(x.version)], ['Platform', (x) => esc(PLATFORM[x.platform] ?? x.platform)], ['Arch', (x) => esc(x.arch)], ['Downloads', (x) => num(x.downloads), true]], byVersion)}

    <h2>Downloads by country</h2>
    ${table([['Country', (x) => esc(x.country || '–')], ['Downloads', (x) => num(x.downloads), true]], r['Downloads by country (top 15)'] ?? [])}

    <h2>Update checks per day</h2>
    <p class="note">Each running copy checks about once a day, so a full day's checks are roughly the number of copies in use.</p>
    ${table([['Day', (x) => esc(x.d)], ...checkPlatforms.map((p) => [PLATFORM[p] ?? p, (x) => num(x[p]), true])], checkRows)}
  `);
}

function page(days, content) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Overlook stats</title>
<style>
  :root { --bg: #f7f7f5; --card: #fff; --text: #1b1d1f; --muted: #6a6f76; --line: #e3e3df; --accent: #2f6fd6; }
  @media (prefers-color-scheme: dark) { :root { --bg: #131416; --card: #1c1e21; --text: #e9eaec; --muted: #9aa0a8; --line: #2c2f33; --accent: #6ea2ff; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  header { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; justify-content: space-between; margin-bottom: 20px; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 16px; margin: 32px 0 10px; }
  nav a { color: var(--muted); text-decoration: none; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); margin-left: 4px; }
  nav a[aria-current] { color: var(--text); border-color: var(--accent); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; }
  .tile span { color: var(--muted); font-size: 13px; }
  .tile strong { font-size: 28px; font-variant-numeric: tabular-nums; line-height: 1.2; }
  .tile.small strong { font-size: 20px; }
  .tile small { color: var(--muted); font-size: 12px; }
  .bars { display: flex; align-items: flex-end; gap: 2px; height: 140px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
  .bar { flex: 1; height: 100%; display: flex; align-items: flex-end; }
  .bar i { display: block; width: 100%; min-height: 1px; background: var(--accent); border-radius: 2px 2px 0 0; }
  .axis { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; margin-top: 4px; }
  .table { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  @media (max-width: 480px) { th, td { padding: 8px; } .tile strong { font-size: 24px; } }
  th { color: var(--muted); font-weight: 500; font-size: 13px; }
  tr:last-child td { border-bottom: 0; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .note, .empty, footer { color: var(--muted); font-size: 13px; }
  .error { color: #c0392b; }
  pre { white-space: pre-wrap; word-break: break-word; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
  footer { margin-top: 40px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Overlook downloads</h1>
    <nav aria-label="Time range">${DAYS.map((d) => `<a href="?days=${d}"${d === days ? ' aria-current="page"' : ''}>${d} days</a>`).join('')}</nav>
  </header>
  ${content}
  <footer>Last ${days} days, UTC. At high volume Cloudflare samples, so large numbers are estimates. No IP addresses or user agents are stored.</footer>
</main>
</body>
</html>`;
}
