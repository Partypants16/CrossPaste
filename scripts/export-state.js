#!/usr/bin/env node
// Exports the current clipboard text and every stored image (files + metadata) into a
// self-contained folder that import-state.js can later restore from.
// Usage: node scripts/export-state.js [destination-directory]
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../server/config.js';
import { openDatabase, closeDatabase } from '../server/database.js';
import { getClipboardState } from '../server/services/clipboard-service.js';
import { listImages } from '../server/services/image-service.js';

async function main() {
  await openDatabase();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.resolve(process.argv[2] || path.join('backups', 'exports', `export-${timestamp}`));
  await fs.mkdir(path.join(destination, 'uploads'), { recursive: true });
  await fs.mkdir(path.join(destination, 'thumbnails'), { recursive: true });

  const clipboard = getClipboardState();
  const images = listImages();

  for (const image of images) {
    await fs.copyFile(
      path.join(config.uploadDirectory, image.storedFilename),
      path.join(destination, 'uploads', image.storedFilename)
    );
    if (image.thumbnailFilename) {
      await fs.copyFile(
        path.join(config.thumbnailDirectory, image.thumbnailFilename),
        path.join(destination, 'thumbnails', image.thumbnailFilename)
      );
    }
  }

  await fs.writeFile(
    path.join(destination, 'manifest.json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), clipboard, images }, null, 2)
  );

  console.log(`Exported clipboard state and ${images.length} image(s) to: ${destination}`);
}

main()
  .catch((error) => {
    console.error('Export failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDatabase();
  });
