#!/usr/bin/env node
// Writes a consistent snapshot of the live SQLite database using better-sqlite3's
// online backup API. Safe to run while CrossPaste is running and being written to.
// Usage: node scripts/backup.js <destination-path>
import Database from 'better-sqlite3';
import path from 'node:path';
import { backupDatabaseTo } from '../server/services/backup-service.js';

const destination = process.argv[2];
if (!destination) {
  console.error('Usage: node scripts/backup.js <destination-path>');
  process.exit(1);
}

const dataDirectory = process.env.DATA_DIRECTORY || path.resolve('./data');
const databasePath = path.join(dataDirectory, 'crosspaste.db');

const db = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  await backupDatabaseTo(db, destination);
  console.log(`Backup snapshot written to ${destination}`);
} finally {
  db.close();
}
