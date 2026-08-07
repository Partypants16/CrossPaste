#!/usr/bin/env node
// Exports the current clipboard text and every stored image and shared file
// (stored data + metadata) into a self-contained folder that import-state.js can
// later restore from.
// Usage: node scripts/export-state.js [destination-directory]
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../server/config.js';
import { openDatabase, closeDatabase } from '../server/database.js';
import { getClipboardState } from '../server/services/clipboard-service.js';
import { listImages } from '../server/services/image-service.js';
import { listFiles, getFileRowById } from '../server/services/file-service.js';

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

  const fileList = listFiles();
  const exportFiles = await Promise.all(fileList.map(async (file) => {
    const row = getFileRowById(file.id);
    const storedName = row.stored_filename;
    const dataBase64 = (await fs.readFile(path.join(config.filesDirectory, storedName))).toString('base64');
    return {
      id: file.id,
      storedFilename: storedName,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      contentBase64: dataBase64
    };
  }));

  await fs.writeFile(
    path.join(destination, 'state.json'),
    JSON.stringify({ files: exportFiles }, null, 2)
  );

  console.log(`Exported clipboard state, ${images.length} image(s), and ${fileList.length} file(s) to: ${destination}`);
}

main()
  .catch((error) => {
    console.error('Export failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDatabase();
  });