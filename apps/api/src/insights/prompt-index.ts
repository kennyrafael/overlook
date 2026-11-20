import type { IndexedPrompt } from './session-detail';

/** Plain SQL access (TypeORM's DataSource / EntityManager, or a better-sqlite3 wrapper in tests). */
export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<any[]>;
  transaction<T>(fn: (q: SqlRunner) => Promise<T>): Promise<T>;
}

/** Marks around matched words in a snippet: control characters, so no log text can fake or break them. */
export const MARK_START = '\u0002';
export const MARK_END = '\u0003';

const MAX_TERMS = 12;
const MAX_TERM_CHARS = 64;
/** SQLite's default limit on bound parameters is 32766; stay far below it. */
const IN_CHUNK = 500;

/** One session's rows: a title row (prompt empty) and one row per typed prompt. */
export interface IndexEntry {
  file: string;
  sessionId: string;
  projectDir: string;
  title: string | null;
  startedAt: number | null;
  endedAt: number | null;
  prompts: IndexedPrompt[];
}

export interface IndexHit {
  file: string;
  sessionId: string;
  projectDir: string;
  /** Snippet of the best-matching row, with MARK_START/MARK_END around matches. */
  snippet: string;
  matchedIn: 'title' | 'prompt';
  /** When the matching prompt was typed (session start for a title match). */
  at: number;
  ended: number;
}

/**
 * Turns what the user typed into an FTS5 query that can never be a syntax error or reach FTS5 operators:
 * each whitespace-separated word becomes a quoted string (embedded quotes doubled), all must match, and
 * the last one also matches as a prefix so results follow typing. Null when nothing is left to search.
 */
export function ftsQuery(input: string): string | null {
  // Control characters go first: FTS5 reads a NUL as the end of the query ("unterminated string").
  const terms = input.normalize('NFKC').replace(/\p{Cc}/gu, ' ').split(/\s+/)
    // Words without a letter or digit (`-`, `*`, `"`) produce no tokens; drop them rather than send empty phrases.
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .slice(0, MAX_TERMS)
    .map((t) => `"${t.slice(0, MAX_TERM_CHARS).replace(/"/g, '""')}"`);
  if (!terms.length) return null;
  terms[terms.length - 1] += '*';
  return terms.join(' ');
}

/** The FTS5 search index of session titles and typed prompts (tables from migration PromptSearch1763700000000). */
export class PromptIndex {
  constructor(private db: SqlRunner) {}

  /** Session files that have rows (every indexed session has at least its title row). */
  async files(): Promise<Set<string>> {
    const rows = await this.db.query(`SELECT DISTINCT file FROM claude_prompts`);
    return new Set(rows.map((r: { file: string }) => r.file));
  }

  /** Replaces the rows of each entry's file, in one transaction. */
  async replace(entries: IndexEntry[]) {
    if (!entries.length) return;
    await this.db.transaction(async (q) => {
      await deleteFiles(q, entries.map((e) => e.file));
      const rows: unknown[][] = [];
      for (const e of entries) {
        const ended = e.endedAt ?? e.startedAt ?? 0;
        rows.push([e.file, e.sessionId, e.projectDir, e.title ?? '', '', e.startedAt ?? ended, ended]);
        for (const p of e.prompts) rows.push([e.file, e.sessionId, e.projectDir, '', p.text, p.at, ended]);
      }
      // 7 parameters per row; 100 rows per statement.
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        await q.query(
          `INSERT INTO claude_prompts (file, sessionId, projectDir, title, prompt, ts, ended) VALUES ${chunk.map(() => '(?,?,?,?,?,?,?)').join(',')}`,
          chunk.flat(),
        );
      }
    });
  }

  async remove(files: string[]) {
    if (files.length) await this.db.transaction((q) => deleteFiles(q, files));
  }

  /**
   * Sessions matching `input`, newest first (by the session's last activity), at most `limit`, each with the
   * snippet of its best-ranked matching prompt (the title only when no prompt matches: the title is shown
   * anyway). `dirs` limits the search to these session folders.
   */
  async search(input: string, dirs: string[] | null, limit = 50): Promise<IndexHit[]> {
    const match = ftsQuery(input);
    if (!match || (dirs && !dirs.length)) return [];
    const dirFilter = dirs ? ` AND p.projectDir IN (${dirs.map(() => '?').join(',')})` : '';
    const sessions: { file: string; ended: number }[] = await this.db.query(
      `SELECT p.file AS file, MAX(p.ended) AS ended FROM claude_search JOIN claude_prompts p ON p.id = claude_search.rowid
       WHERE claude_search MATCH ?${dirFilter} GROUP BY p.file ORDER BY ended DESC LIMIT ?`,
      [match, ...(dirs ?? []), limit],
    );
    if (!sessions.length) return [];
    const rows: { file: string; sessionId: string; projectDir: string; isTitle: number; ts: number; ended: number; snip: string }[] = await this.db.query(
      `SELECT p.file AS file, p.sessionId AS sessionId, p.projectDir AS projectDir, (p.prompt = '') AS isTitle, p.ts AS ts, p.ended AS ended,
              snippet(claude_search, -1, ?, ?, '…', 16) AS snip
       FROM claude_search JOIN claude_prompts p ON p.id = claude_search.rowid
       WHERE claude_search MATCH ? AND p.file IN (${sessions.map(() => '?').join(',')})
       ORDER BY (p.prompt = ''), bm25(claude_search)`,
      [MARK_START, MARK_END, match, ...sessions.map((s) => s.file)],
    );
    const best = new Map<string, IndexHit>();
    for (const r of rows) {
      if (best.has(r.file)) continue;
      best.set(r.file, {
        file: r.file, sessionId: r.sessionId, projectDir: r.projectDir, snippet: r.snip,
        matchedIn: r.isTitle ? 'title' : 'prompt', at: r.ts, ended: r.ended,
      });
    }
    return sessions.map((s) => best.get(s.file)).filter((h): h is IndexHit => !!h);
  }
}

async function deleteFiles(q: SqlRunner, files: string[]) {
  for (let i = 0; i < files.length; i += IN_CHUNK) {
    const chunk = files.slice(i, i + IN_CHUNK);
    await q.query(`DELETE FROM claude_prompts WHERE file IN (${chunk.map(() => '?').join(',')})`, chunk);
  }
}
