import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema as `synchronize: true` created it up to v0.1. Databases from those versions already have
 * these tables (and no migrations table), so every statement is IF NOT EXISTS: on an old database
 * this migration only records itself; on a new one it creates the schema.
 */
export class Baseline1763424000000 implements MigrationInterface {
  name = 'Baseline1763424000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS "settings" ("key" varchar PRIMARY KEY NOT NULL, "value" text NOT NULL)`);
    await q.query(`CREATE TABLE IF NOT EXISTS "project_overrides" ("id" varchar PRIMARY KEY NOT NULL, "name" text, "status" text, "tags" text NOT NULL DEFAULT ('[]'), "pinned" boolean NOT NULL DEFAULT (0))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "snapshots" ("projectId" varchar NOT NULL, "day" varchar NOT NULL, "milestonesReached" integer NOT NULL, "milestonesTotal" integer NOT NULL, "tasksDone" integer NOT NULL, "tasksTotal" integer NOT NULL, "source" text NOT NULL DEFAULT ('live'), PRIMARY KEY ("projectId", "day"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "views" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "filters" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const t of ['views', 'snapshots', 'project_overrides', 'settings']) await q.query(`DROP TABLE "${t}"`);
  }
}
