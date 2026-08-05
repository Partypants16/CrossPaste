/**
 * Uses SQLite's online backup API (via better-sqlite3's db.backup) instead of copying
 * the .db file directly, so a backup taken while the server is running is never corrupted
 * by a concurrent write.
 */
export async function backupDatabaseTo(db, destinationPath) {
  await db.backup(destinationPath);
}
