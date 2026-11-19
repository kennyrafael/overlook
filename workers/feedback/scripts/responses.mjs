#!/usr/bin/env node
// Reads the feedback responses from D1 (through Wrangler, with your own Cloudflare login).
//
//   node workers/feedback/scripts/responses.mjs                 summary and the latest 20 responses
//   node workers/feedback/scripts/responses.mjs --all           every response
//   node workers/feedback/scripts/responses.mjs --csv out.csv   export everything as CSV
//   node workers/feedback/scripts/responses.mjs --pro-emails    emails of people who asked to hear about Pro
//   node workers/feedback/scripts/responses.mjs --delete-email someone@example.com
//                                                               erase an email on request (GDPR); keeps the anonymous answers
// Add --local to read the local development database (`npx wrangler dev`) instead of the live one.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const where = flag('--local') ? '--local' : '--remote';

function query(sql) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'overlook-feedback', where, '--json', '--command', JSON.stringify(sql)], {
    cwd: here, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status ?? 1);
  }
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
  return out[0]?.results ?? [];
}
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

const deleteEmail = value('--delete-email');
if (deleteEmail) {
  const before = query(`SELECT COUNT(*) AS n FROM feedback WHERE lower(email) = lower(${sqlString(deleteEmail)})`)[0]?.n ?? 0;
  query(`UPDATE feedback SET email = NULL, consent_at = NULL WHERE lower(email) = lower(${sqlString(deleteEmail)})`);
  console.log(`Erased ${deleteEmail} from ${before} response(s).`);
  process.exit(0);
}

if (flag('--pro-emails')) {
  for (const r of query("SELECT email, MIN(created_at) AS since FROM feedback WHERE kind = 'pro' AND email IS NOT NULL GROUP BY lower(email) ORDER BY since")) {
    console.log(`${r.email}\t${r.since}`);
  }
  process.exit(0);
}

const csv = value('--csv');
const rows = query(`SELECT * FROM feedback ORDER BY id DESC${csv || flag('--all') ? '' : ' LIMIT 20'}`);

if (csv) {
  const cols = ['id', 'created_at', 'kind', 'source', 'version', 'pay', 'features', 'other', 'price', 'text', 'category', 'email', 'consent_at'];
  const cell = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  writeFileSync(csv, [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
  console.log(`Wrote ${rows.length} responses to ${csv}`);
  process.exit(0);
}

const count = (sql) => query(sql).map((r) => `${r.k ?? '(none)'}: ${r.n}`).join(', ') || 'none';
console.log(`Responses: ${count('SELECT kind AS k, COUNT(*) AS n FROM feedback GROUP BY kind')}`);
console.log(`Would pay: ${count("SELECT pay AS k, COUNT(*) AS n FROM feedback WHERE kind = 'pro' GROUP BY pay ORDER BY n DESC")}`);
console.log(`Fair price: ${count("SELECT price AS k, COUNT(*) AS n FROM feedback WHERE kind = 'pro' GROUP BY price ORDER BY n DESC")}`);
console.log(`Features: ${count("SELECT j.value AS k, COUNT(*) AS n FROM feedback, json_each(feedback.features) AS j WHERE kind = 'pro' GROUP BY j.value ORDER BY n DESC")}`);
console.log(`Idea categories: ${count("SELECT category AS k, COUNT(*) AS n FROM feedback WHERE kind = 'idea' GROUP BY category ORDER BY n DESC")}`);
console.log(`Emails for Pro: ${query("SELECT COUNT(DISTINCT lower(email)) AS n FROM feedback WHERE kind = 'pro' AND email IS NOT NULL")[0]?.n ?? 0}\n`);
for (const r of rows) {
  const what = r.kind === 'pro'
    ? `pay=${r.pay} price=${r.price ?? '-'} features=${JSON.parse(r.features || '[]').join('+') || '-'}${r.other ? ` other="${r.other}"` : ''}`
    : `[${r.category ?? 'no category'}] ${r.text}`;
  console.log(`#${r.id} ${r.created_at.slice(0, 16)} ${r.source}${r.version ? ` v${r.version}` : ''} ${what}${r.email ? ` <${r.email}>` : ''}`);
}
