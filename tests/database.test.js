import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setupTestEnvironment, teardownTestEnvironment } from './helpers/test-env.js';

const tempDir = await setupTestEnvironment();

const { openDatabase, closeDatabase, getDatabase, isDatabaseHealthy } = await import('../server/database.js');

test('openDatabase creates the data directory and initialises the schema', async () => {
  await openDatabase();

  const db = getDatabase();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

  assert.ok(tables.includes('clipboard'));
  assert.ok(tables.includes('images'));
  assert.ok(tables.includes('files'));
  assert.ok(tables.includes('schema_migrations'));

  const clipboardRows = db.prepare('SELECT * FROM clipboard').all();
  assert.equal(clipboardRows.length, 1);
  assert.equal(clipboardRows[0].id, 1);

  const appliedMigrations = db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id);
  assert.ok(appliedMigrations.includes('001-initial.sql'));
  assert.ok(appliedMigrations.includes('002-files.sql'));
});

test('re-running migrations on an existing database does not duplicate the clipboard row', async () => {
  const { runMigrations } = await import('../server/migrations.js');
  const db = getDatabase();
  runMigrations(db);
  runMigrations(db);

  const clipboardRows = db.prepare('SELECT * FROM clipboard').all();
  assert.equal(clipboardRows.length, 1);

  const migrationRows = db.prepare("SELECT COUNT(*) AS total FROM schema_migrations WHERE id = '001-initial.sql'").get();
  assert.equal(migrationRows.total, 1);
});

test('isDatabaseHealthy reflects the open/closed state of the connection', async () => {
  assert.equal(isDatabaseHealthy(), true);
  closeDatabase();
  assert.equal(isDatabaseHealthy(), false);
});

test.after(async () => {
  await teardownTestEnvironment(tempDir);
});
