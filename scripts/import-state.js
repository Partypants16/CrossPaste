#!/usr/bin/env node
// Restores a clipboard text + image + shared-file export created by export-state.js.
// This replaces whatever is currently stored, so it always asks for confirmation
// unless --yes is given.
// Usage: node scripts/import-state.js <export-directory> [--yes]
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { config } from '../server/config.js';
import { openDatabase, closeDatabase, getDatabase } from '../server/database.js';
import { saveClipboard, clearClipboard } from '../server/services/clipboard-service.js';
import { listImages, deleteImage } from '../server/services/image-service.js';
import { listFiles, deleteFile } from '../server/services/file-service.js';
import { generateStoredFilename, sanitiseOriginalFilename } from '../server/utilities/files.js';

const skipConfirmation = process.argv.includes('--yes');
const sourceDirectory = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : null;

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

function isSafeStoredFilename(name) {
  return typeof name === 'string' && name.length > 0 && name === path.basename(name) && !name.includes('..');
}

function extensionOf(storedFilename) {
  const ext = path.extname(storedFilename || '').replace(/^\./, '');
  return ext || 'bin';
}

async function main() {
  if (!sourceDirectory) {
    console.error('Usage: node scripts/import-state.js <export-directory> [--yes]');
    process.exitCode = 1;
    return;
  }

  const manifestRaw = await fs.readFile(path.join(sourceDirectory, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];

  console.log(`This will REPLACE the current clipboard text, all images, and all shared files with the export from:`);
  console.log(`  ${sourceDirectory}`);
  console.log(`  (${manifest.images.length} image(s), ${manifestFiles.length} file(s), exported at ${manifest.exportedAt})`);

  if (!skipConfirmation) {
    const confirmed = await confirm('Type "yes" to continue: ');
    if (!confirmed) {
      console.log('Cancelled. Nothing was changed.');
      return;
    }
  }

  await openDatabase();
  const db = getDatabase();

  for (const image of listImages()) {
    await deleteImage(image.id);
  }
  for (const file of listFiles()) {
    await deleteFile(file.id);
  }
  clearClipboard();

  saveClipboard({ html: manifest.clipboard.contentHtml, baseRevision: null, force: true });

  const imagesToImport = manifest.images.slice(0, config.imageCountLimit);
  if (manifest.images.length > imagesToImport.length) {
    console.warn(
      `Skipping ${manifest.images.length - imagesToImport.length} image(s) beyond the configured limit of ${config.imageCountLimit}.`
    );
  }

  let sortOrder = 0;
  for (const image of imagesToImport) {
    if (!isSafeStoredFilename(image.storedFilename) || (image.thumbnailFilename && !isSafeStoredFilename(image.thumbnailFilename))) {
      console.warn(`Skipping an image with an unsafe stored filename.`);
      continue;
    }

    await fs.copyFile(
      path.join(sourceDirectory, 'uploads', image.storedFilename),
      path.join(config.uploadDirectory, image.storedFilename)
    );
    if (image.thumbnailFilename) {
      await fs.copyFile(
        path.join(sourceDirectory, 'thumbnails', image.thumbnailFilename),
        path.join(config.thumbnailDirectory, image.thumbnailFilename)
      );
    }

    db.prepare(
      `INSERT INTO images
        (stored_filename, thumbnail_filename, original_filename, mime_type, size_bytes, width, height, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      image.storedFilename,
      image.thumbnailFilename,
      image.originalFilename,
      image.mimeType,
      image.sizeBytes,
      image.width ?? null,
      image.height ?? null,
      sortOrder,
      image.createdAt
    );
    sortOrder += 1;
  }

  const filesToImport = manifestFiles.slice(0, config.fileCountLimit);
  if (manifestFiles.length > filesToImport.length) {
    console.warn(
      `Skipping ${manifestFiles.length - filesToImport.length} file(s) beyond the configured limit of ${config.fileCountLimit}.`
    );
  }

  let fileSortOrder = 0;
  let filesImported = 0;
  for (const file of filesToImport) {
    if (!isSafeStoredFilename(file.storedFilename)) {
      console.warn(`Skipping a file with an unsafe stored filename.`);
      continue;
    }

    const sourcePath = path.join(sourceDirectory, 'files', file.storedFilename);
    const newStoredFilename = generateStoredFilename(extensionOf(file.storedFilename));
    try {
      await fs.copyFile(sourcePath, path.join(config.filesDirectory, newStoredFilename));
    } catch (error) {
      console.warn(`Skipping "${file.originalFilename}": could not read its exported bytes (${error.message}).`);
      continue;
    }

    db.prepare(
      `INSERT INTO files
        (stored_filename, original_filename, mime_type, size_bytes, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      newStoredFilename,
      sanitiseOriginalFilename(file.originalFilename),
      file.mimeType || 'application/octet-stream',
      file.sizeBytes,
      fileSortOrder,
      file.createdAt
    );
    fileSortOrder += 1;
    filesImported += 1;
  }

  console.log(`Imported clipboard text, ${imagesToImport.length} image(s), and ${filesImported} file(s).`);
}

main()
  .catch((error) => {
    console.error('Import failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDatabase();
  });
