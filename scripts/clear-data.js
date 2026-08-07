#!/usr/bin/env node
// Clears the shared text and deletes every stored image and file (database rows and contents).
// This is a destructive maintenance operation intended for the command line only.
// Usage: node scripts/clear-data.js --yes
import readline from 'node:readline/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDatabase, closeDatabase, getDatabase } from '../server/database.js';
import { clearClipboard } from '../server/services/clipboard-service.js';
import { listImages, deleteImage } from '../server/services/image-service.js';
import { listFiles, deleteFile } from '../server/services/file-service.js';
import { config } from '../server/config.js';
import { logger } from '../server/utilities/logger.js';

const skipConfirmation = process.argv.includes('--yes');

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

async function deleteAllFilesData(db) {
  // Ensure filesDirectory is a safe absolute path.
  const dirPath = config.filesDirectory;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(dirPath, entry.name);
      try {
        await fs.unlink(filePath);
      } catch (e) {
        logger.error('Failed to delete physical file', { file: filePath, error: e.message });
      }
    }
  } catch (err) {
    logger.error('Error reading files directory during cleanup', { dir: dirPath, error: err.message });
  }

  // Delete all rows from the `files` table.
  try {
    db.exec('DELETE FROM files');
  } catch (e) {
    logger.error('Failed to delete DB rows for files', { error: e.message });
  }
}

async function main() {
  await openDatabase();
  const db = getDatabase();

  const images = listImages();
  const files = listFiles();
  console.log(`This will clear the shared text, delete ${images.length} stored image(s), and delete ${files.length} stored file(s).`);

  if (!skipConfirmation) {
    const confirmed = await confirm('Type "yes" to continue: ');
    if (!confirmed) {
      console.log('Cancelled. Nothing was changed.');
      return;
    }
  }

  clearClipboard();
  for (const image of images) {
    try { await deleteImage(image.id); } catch (e) { logger.error('Failed to delete image', { id: image.id, error: e.message }); }
  }
  for (const file of files) {
    try { await deleteFile(file.id); } catch (e) { logger.error('Failed to delete file', { id: file.id, error: e.message }); }
  }

  // Additional cleanup: remove any remaining orphan files and table rows.
  await deleteAllFilesData(db);

  console.log('Cleared the shared text and deleted all stored images and files.');
}

main()
  .catch((error) => { console.error('Failed to clear data:', error.message); process.exitCode = 1; })
  .finally(() => { closeDatabase(); });
