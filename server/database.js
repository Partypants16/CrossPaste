import Database from 'better-sqlite3';
import { config } from './config.js';
import { logger } from './utilities/logger.js';
import { ensureDirectory } from './utilities/files.js';
import { runMigrations } from './migrations.js';

let db = null;

export async function openDatabase() {
  await ensureDirectory(config.dataDirectory);
  await ensureDirectory(config.uploadDirectory);
  await ensureDirectory(config.thumbnailDirectory);
  await ensureDirectory(config.filesDirectory);

  db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);

  logger.info('Database initialised', { path: 'data-directory' });
  return db;
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database has not been initialised yet');
  }
  return db;
}

export function isDatabaseHealthy() {
  if (!db || !db.open) return false;
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

export function closeDatabase() {
  if (db && db.open) {
    db.close();
    logger.info('Database connection closed');
  }
}
