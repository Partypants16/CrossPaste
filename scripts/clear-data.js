#!/usr/bin/env node
// Clears the shared text and deletes every stored image (database rows and files).
// This is a destructive maintenance operation intended for the command line only.
// Usage: node scripts/clear-data.js --yes
import readline from 'node:readline/promises';
import { openDatabase, closeDatabase, getDatabase } from '../server/database.js';
import { clearClipboard } from '../server/services/clipboard-service.js';
import { listImages, deleteImage } from '../server/services/image-service.js';

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

async function main() {
  await openDatabase();
  getDatabase();

  const images = listImages();
  console.log(`This will clear the shared text and delete ${images.length} stored image(s).`);

  if (!skipConfirmation) {
    const confirmed = await confirm('Type "yes" to continue: ');
    if (!confirmed) {
      console.log('Cancelled. Nothing was changed.');
      return;
    }
  }

  clearClipboard();
  for (const image of images) {
    await deleteImage(image.id);
  }

  console.log('Cleared the shared text and deleted all stored images.');
}

main()
  .catch((error) => {
    console.error('Failed to clear data:', error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDatabase();
  });
