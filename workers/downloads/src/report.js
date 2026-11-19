// The download and update-check reports, read from the Analytics Engine dataset `overlook` through
// Cloudflare's SQL API. Shared by the /stats page (src/stats-page.js) and the CLI (scripts/stats.mjs).
// Analytics Engine samples at high volume; SUM(_sample_interval) turns samples back into estimated totals.

export const DATASET = 'overlook';

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

/** Number-looking values become numbers (except versions, which stay text: "1.10" is not 1.1). */
const toRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /^\d+(\.\d+)?$/.test(String(v)) && k !== 'version' ? Number(v) : v]));

/**
 * Runs every report. Returns [{ title, rows }] in report order. Errors name the report and Cloudflare's
 * status, never the token.
 */
export async function fetchReports({ accountId, token, days, fetchFn = fetch }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/analytics_engine/sql`;
  return Promise.all(Object.entries(queries(days)).map(async ([title, sql]) => {
    const res = await fetchFn(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: sql });
    const text = await res.text();
    if (!res.ok) throw new Error(`${title}: Cloudflare answered ${res.status}: ${text.slice(0, 300)}`);
    return { title, rows: (JSON.parse(text).data ?? []).map(toRow) };
  }));
}
