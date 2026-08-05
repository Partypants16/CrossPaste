#!/usr/bin/env node
// Checks SQLite database integrity and foreign-key consistency without modifying
// anything. Intended to be run from the command line, not exposed over HTTP.
import Database from 'better-sqlite3';
import path from 'node:path';

const dataDirectory = process.env.DATA_DIRECTORY || path.resolve('./data');
const databasePath = path.join(dataDirectory, 'crosspaste.db');

const db = new Database(databasePath, { readonly: true, fileMustExist: true });

try {
  const integrityRows = db.pragma('integrity_check');
  const integrityOk = integrityRows.length === 1 && integrityRows[0].integrity_check === 'ok';

  const foreignKeyIssues = db.pragma('foreign_key_check');

  console.log(`Integrity check: ${integrityOk ? 'OK' : 'FAILED'}`);
  if (!integrityOk) {
    for (const row of integrityRows) console.log(`  - ${row.integrity_check}`);
  }

  console.log(`Foreign key check: ${foreignKeyIssues.length === 0 ? 'OK' : 'ISSUES FOUND'}`);
  for (const issue of foreignKeyIssues) {
    console.log(`  - table=${issue.table} rowid=${issue.rowid}`);
  }

  const clipboardCount = db.prepare('SELECT COUNT(*) AS total FROM clipboard').get().total;
  const imageCount = db.prepare('SELECT COUNT(*) AS total FROM images').get().total;
  console.log(`Clipboard rows: ${clipboardCount} (expected 1)`);
  console.log(`Image rows: ${imageCount}`);

  if (!integrityOk || foreignKeyIssues.length > 0 || clipboardCount !== 1) {
    process.exitCode = 1;
  }
} finally {
  db.close();
}
