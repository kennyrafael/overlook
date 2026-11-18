import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Persisted Claude log summaries, so a restart does not re-read every session log. */
export class ParseCache1763510400000 implements MigrationInterface {
  name = 'ParseCache1763510400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "parse_cache" ("file" varchar PRIMARY KEY NOT NULL, "size" integer NOT NULL, "mtimeMs" real NOT NULL, "version" integer NOT NULL, "summary" text NOT NULL)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "parse_cache"`);
  }
}
