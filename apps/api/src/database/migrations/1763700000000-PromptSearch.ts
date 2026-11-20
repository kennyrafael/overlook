import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Full-text search over Claude session titles and typed prompts (SQLite FTS5).
 *
 * `claude_prompts` holds one row per typed prompt plus one per session for its title (session file,
 * session id, project folder, title, prompt text, timestamp, session end). `claude_search` is an FTS5
 * index over its title and prompt columns, kept in step by triggers. An external-content index keeps the
 * text once and lets rows be dropped by file through the plain table's index (an FTS5 column cannot be
 * indexed for that). Neither table is a TypeORM entity: they are written with plain SQL by PromptIndex.
 */
export class PromptSearch1763700000000 implements MigrationInterface {
  name = 'PromptSearch1763700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "claude_prompts" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "file" varchar NOT NULL, "sessionId" varchar NOT NULL, "projectDir" varchar NOT NULL, "title" text NOT NULL DEFAULT (''), "prompt" text NOT NULL DEFAULT (''), "ts" integer NOT NULL, "ended" integer NOT NULL)`);
    await q.query(`CREATE INDEX "IDX_claude_prompts_file" ON "claude_prompts" ("file")`);
    await q.query(`CREATE VIRTUAL TABLE "claude_search" USING fts5(title, prompt, content='claude_prompts', content_rowid='id', tokenize='unicode61 remove_diacritics 2')`);
    await q.query(`CREATE TRIGGER "claude_prompts_ai" AFTER INSERT ON "claude_prompts" BEGIN INSERT INTO claude_search(rowid, title, prompt) VALUES (new.id, new.title, new.prompt); END`);
    await q.query(`CREATE TRIGGER "claude_prompts_ad" AFTER DELETE ON "claude_prompts" BEGIN INSERT INTO claude_search(claude_search, rowid, title, prompt) VALUES ('delete', old.id, old.title, old.prompt); END`);
    await q.query(`CREATE TRIGGER "claude_prompts_au" AFTER UPDATE ON "claude_prompts" BEGIN INSERT INTO claude_search(claude_search, rowid, title, prompt) VALUES ('delete', old.id, old.title, old.prompt); INSERT INTO claude_search(rowid, title, prompt) VALUES (new.id, new.title, new.prompt); END`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const t of ['claude_prompts_au', 'claude_prompts_ad', 'claude_prompts_ai']) await q.query(`DROP TRIGGER IF EXISTS "${t}"`);
    await q.query(`DROP TABLE IF EXISTS "claude_search"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_claude_prompts_file"`);
    await q.query(`DROP TABLE IF EXISTS "claude_prompts"`);
  }
}
