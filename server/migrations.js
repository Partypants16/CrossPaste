import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './utilities/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIRECTORY = path.join(__dirname, '..', 'migrations');

function hasMigrationsTable(db) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  return Boolean(row);
}

/**
 * Migrations are plain numbered .sql files applied in order and tracked in
 * schema_migrations, so re-running the server never re-applies a migration twice.
 */
export function runMigrations(db) {
  const files = fs
    .readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const applied = new Set();
  if (hasMigrationsTable(db)) {
    for (const row of db.prepare('SELECT id FROM schema_migrations').all()) {
      applied.add(row.id);
    }
  }

  for (const fileName of files) {
    if (applied.has(fileName)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, fileName), 'utf8');
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (id, applied_at) VALUES (?, strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\'))'
      ).run(fileName);
    });

    applyMigration();
    logger.info('Applied database migration', { migration: fileName });
  }
}
