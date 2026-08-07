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
  await fs.mkdir(path.join(destination, 'files'), { recursive: true });

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
  const exportedFiles = [];
  for (const file of fileList) {
    const row = getFileRowById(file.id);
    await fs.copyFile(
      path.join(config.filesDirectory, row.stored_filename),
      path.join(destination, 'files', row.stored_filename)
    );
    exportedFiles.push({
      storedFilename: row.stored_filename,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
    });
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    clipboard: { contentHtml: clipboard.contentHtml },
    images,
    files: exportedFiles,
  };

  await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`Exported clipboard state, ${images.length} image(s), and ${exportedFiles.length} file(s) to: ${destination}`);
}

main()
  .catch((error) => {
    console.error('Export failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDatabase();
  });
