import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import 'reflect-metadata';
import { DataSource } from 'typeorm';

// The data dir is read at import; point it at a temp folder before loading the config.
const dir = mkdtempSync(join(tmpdir(), 'overlook-mig-'));
process.env.CPD_DATA_DIR = dir;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { entities, migrations } = require('../../dist/database/database.config') as typeof import('./database.config') // dist: tsx emits no decorator metadata;

/** Exactly what `synchronize: true` created in v0.1 (no migrations table). */
const V0_SCHEMA = [
  `CREATE TABLE "settings" ("key" varchar PRIMARY KEY NOT NULL, "value" text NOT NULL)`,
  `CREATE TABLE "project_overrides" ("id" varchar PRIMARY KEY NOT NULL, "name" text, "status" text, "tags" text NOT NULL DEFAULT ('[]'), "pinned" boolean NOT NULL DEFAULT (0))`,
  `CREATE TABLE "snapshots" ("projectId" varchar NOT NULL, "day" varchar NOT NULL, "milestonesReached" integer NOT NULL, "milestonesTotal" integer NOT NULL, "tasksDone" integer NOT NULL, "tasksTotal" integer NOT NULL, "source" text NOT NULL DEFAULT ('live'), PRIMARY KEY ("projectId", "day"))`,
  `CREATE TABLE "views" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "filters" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`,
];

const open = (database: string) =>
  new DataSource({ type: 'better-sqlite3', database, entities, migrations, migrationsRun: true, synchronize: false });

after(() => rmSync(dir, { recursive: true, force: true }));

test('upgrading a v0 database keeps settings, overrides, snapshots and views', async () => {
  const file = join(dir, 'v0.sqlite');
  const db = new Database(file);
  for (const q of V0_SCHEMA) db.exec(q);
  db.prepare(`INSERT INTO settings VALUES ('settings', ?)`).run(JSON.stringify({ roots: ['C:\\code'], staleDays: 7 }));
  db.prepare(`INSERT INTO project_overrides VALUES ('p1', 'Renamed', 'paused', '["a","b"]', 1)`).run();
  db.prepare(`INSERT INTO snapshots VALUES ('p1', '2026-01-01', 1, 2, 3, 4, 'git')`).run();
  db.prepare(`INSERT INTO views VALUES ('v1', 'Mine', '{"search":"x"}', '2026-01-01 00:00:00')`).run();
  db.close();

  const ds = open(file);
  await ds.initialize();
  const ran = await ds.query(`SELECT name FROM migrations ORDER BY id`);
  assert.deepEqual(ran.map((r: { name: string }) => r.name), migrations.map((m) => m.name));
  assert.deepEqual(await ds.query(`SELECT * FROM project_overrides`), [{ id: 'p1', name: 'Renamed', status: 'paused', tags: '["a","b"]', pinned: 1 }]);
  assert.equal(JSON.parse((await ds.query(`SELECT value FROM settings`))[0].value).staleDays, 7);
  assert.equal((await ds.query(`SELECT source FROM snapshots`))[0].source, 'git');
  assert.equal((await ds.query(`SELECT name FROM views`))[0].name, 'Mine');
  assert.deepEqual(await ds.query(`SELECT * FROM parse_cache`), []);
  // The schema matches the entities exactly: nothing left for synchronize to change.
  assert.deepEqual((await ds.driver.createSchemaBuilder().log()).upQueries, []);
  await ds.destroy();

  // Opening again runs nothing new.
  const again = open(file);
  await again.initialize();
  assert.equal((await again.query(`SELECT COUNT(*) AS n FROM migrations`))[0].n, migrations.length);
  await again.destroy();
});

test('a new database gets the full schema', async () => {
  const ds = open(join(dir, 'new.sqlite'));
  await ds.initialize();
  assert.deepEqual((await ds.driver.createSchemaBuilder().log()).upQueries, []);
  await ds.destroy();
});
