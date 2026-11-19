// Download and update-check counts from the Analytics Engine dataset `overlook` (written by the
// download Worker, see src/count.js), via Cloudflare's SQL API.
//
//   CLOUDFLARE_ACCOUNT_ID=…  CLOUDFLARE_API_TOKEN=…  npm run stats [-- --days 30]
//
// The token needs only "Account Analytics: Read". Keep it in your shell or a password manager, never
// in this repository. Counts are sampled by Analytics Engine at high volume; SUM(_sample_interval)
// turns samples back into estimated totals.

const DATASET = 'overlook';

/** The SQL for each report, for the last `days` days. Columns: blob1 kind, blob2 platform, blob3 arch, blob4 version, blob6 country, blob7 source. */
export function queries(days) {
  const since = `timestamp > NOW() - INTERVAL '${days}' DAY`;
  return {
    'Downloads by version and platform': `SELECT blob4 AS version, blob2 AS platform, blob3 AS arch, SUM(_sample_interval) AS downloads FROM ${DATASET} WHERE blob1 = 'download' AND ${since} GROUP BY version, platform, arch ORDER BY downloads DESC`,
    'Downloads per day': `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, SUM(_sample_interval) AS downloads FROM ${DATASET} WHERE blob1 = 'download' AND ${since} GROUP BY day ORDER BY day`,
    'Downloads by country (top 15)': `SELECT blob6 AS country, SUM(_sample_interval) AS downloads FROM ${DATASET} WHERE blob1 = 'download' AND ${since} GROUP BY country ORDER BY downloads DESC LIMIT 15`,
    'Update checks per day (about one per running copy)': `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob2 AS platform, SUM(_sample_interval) AS checks FROM ${DATASET} WHERE blob1 = 'update-check' AND ${since} GROUP BY day, platform ORDER BY day, platform`,
    'Totals': `SELECT blob1 AS kind, SUM(_sample_interval) AS count FROM ${DATASET} WHERE ${since} GROUP BY kind ORDER BY count DESC`,
  };
}

/** Plain-text table for an array of row objects. */
export function table(rows) {
  if (!rows.length) return '  (none yet)';
  const cols = Object.keys(rows[0]);
  const fmt = (v) => (typeof v === 'number' ? String(Math.round(v)) : String(v ?? '').replace(/ 00:00:00$/, '') || '–');
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => fmt(r[c]).length)));
  const line = (vals) => ('  ' + vals.map((v, i) => v.padEnd(width[i])).join('  ')).trimEnd();
  return [line(cols), line(width.map((w) => '-'.repeat(w))), ...rows.map((r) => line(cols.map((c) => fmt(r[c]))))].join('\n');
}

export async function run({ accountId, token, days, fetchFn = fetch, log = console.log }) {
  for (const [title, sql] of Object.entries(queries(days))) {
    const res = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/analytics_engine/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: sql,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${title}: Cloudflare answered ${res.status}: ${text.slice(0, 300)}`);
    const rows = (JSON.parse(text).data ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /^\d+(\.\d+)?$/.test(String(v)) && k !== 'version' ? Number(v) : v])));
    log(`\n${title} (last ${days} days)\n${table(rows)}`);
  }
}

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with "Account Analytics: Read") first.');
    process.exit(2);
  }
  const i = process.argv.indexOf('--days');
  const days = i > 0 ? Number(process.argv[i + 1]) : 30;
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    console.error('--days must be a whole number from 1 to 90 (Analytics Engine keeps 3 months).');
    process.exit(2);
  }
  await run({ accountId, token, days });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch((e) => {
    // fetch's own message is just "fetch failed"; the reason (DNS, proxy, TLS certificate, …) is in e.cause.
    const cause = e.cause ? ` (${[e.cause.code, e.cause.message].filter(Boolean).join(': ')})` : '';
    console.error(`${e.message}${cause}`);
    process.exit(1);
  });
}
