#!/usr/bin/env node
// Compares the images table against the uploads/thumbnails directories to find:
//   - files on disk with no matching database row ("orphaned files")
//   - database rows whose file is missing from disk ("missing image files")
// By default this only reports what it finds. Pass --delete to remove orphaned files
// after an explicit interactive confirmation.
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { config } from '../server/config.js';
import { openDatabase, closeDatabase, getDatabase } from '../server/database.js';

const shouldDelete = process.argv.includes('--delete');

async function listDirectory(directoryPath) {
  try {
    return await fs.readdir(directoryPath);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

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
  const db = getDatabase();

  const rows = db.prepare('SELECT stored_filename, thumbnail_filename FROM images').all();
  const referencedUploads = new Set(rows.map((row) => row.stored_filename));
  const referencedThumbnails = new Set(rows.map((row) => row.thumbnail_filename).filter(Boolean));

  const uploadFiles = await listDirectory(config.uploadDirectory);
  const thumbnailFiles = await listDirectory(config.thumbnailDirectory);

  const orphanedUploads = uploadFiles.filter((name) => !referencedUploads.has(name));
  const orphanedThumbnails = thumbnailFiles.filter((name) => !referencedThumbnails.has(name));

  const missingUploads = [];
  const missingThumbnails = [];
  for (const row of rows) {
    if (!uploadFiles.includes(row.stored_filename)) missingUploads.push(row.stored_filename);
    if (row.thumbnail_filename && !thumbnailFiles.includes(row.thumbnail_filename)) {
      missingThumbnails.push(row.thumbnail_filename);
    }
  }

  console.log(`Orphaned upload files (on disk, no database row): ${orphanedUploads.length}`);
  orphanedUploads.forEach((name) => console.log(`  - uploads/${name}`));
  console.log(`Orphaned thumbnail files (on disk, no database row): ${orphanedThumbnails.length}`);
  orphanedThumbnails.forEach((name) => console.log(`  - thumbnails/${name}`));
  console.log(`Database rows missing their upload file: ${missingUploads.length}`);
  missingUploads.forEach((name) => console.log(`  - ${name}`));
  console.log(`Database rows missing their thumbnail file: ${missingThumbnails.length}`);
  missingThumbnails.forEach((name) => console.log(`  - ${name}`));

  const totalOrphans = orphanedUploads.length + orphanedThumbnails.length;
  if (totalOrphans === 0) {
    console.log('\nNo orphaned files found.');
    return;
  }

  if (!shouldDelete) {
    console.log('\nRun with --delete to remove orphaned files after confirmation.');
    return;
  }

  const confirmed = await confirm(`\nDelete ${totalOrphans} orphaned file(s)? Type "yes" to confirm: `);
  if (!confirmed) {
    console.log('Cancelled. No files were deleted.');
    return;
  }

  for (const name of orphanedUploads) {
    await fs.unlink(path.join(config.uploadDirectory, name));
  }
  for (const name of orphanedThumbnails) {
    await fs.unlink(path.join(config.thumbnailDirectory, name));
  }
  console.log(`Deleted ${totalOrphans} orphaned file(s).`);
}

main()
  .catch((error) => {
    console.error('Failed to check for orphaned files:', error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDatabase();
  });
