import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Phase 8: task history (events + last seen task list per project) and "last seen" per device. */
export class DailyOverview1763800000000 implements MigrationInterface {
  name = 'DailyOverview1763800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "task_events" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "projectId" varchar NOT NULL, "file" text NOT NULL, "taskText" text NOT NULL, "from" varchar, "to" varchar, "at" varchar NOT NULL, "source" varchar NOT NULL DEFAULT ('file'))`);
    await q.query(`CREATE INDEX "IDX_task_events_at" ON "task_events" ("at") `);
    await q.query(`CREATE TABLE "task_states" ("projectId" varchar PRIMARY KEY NOT NULL, "tasks" text NOT NULL, "updatedAt" varchar NOT NULL)`);
    await q.query(`CREATE TABLE "devices" ("id" varchar PRIMARY KEY NOT NULL, "lastSeenAt" varchar NOT NULL)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "devices"`);
    await q.query(`DROP TABLE "task_states"`);
    await q.query(`DROP INDEX "IDX_task_events_at"`);
    await q.query(`DROP TABLE "task_events"`);
  }
}
