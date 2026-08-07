#!/usr/bin/env node
// Compares the images and files tables against their configured storage directories to find:
//   - files on disk with no matching database row ("orphaned files")
//   - database rows whose file is missing from disk
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
  const fileRows = db.prepare('SELECT stored_filename FROM files').all();
  const referencedUploads = new Set(rows.map((row) => row.stored_filename));
  const referencedThumbnails = new Set(rows.map((row) => row.thumbnail_filename).filter(Boolean));
  const referencedFiles = new Set(fileRows.map((row) => row.stored_filename));

  const uploadFiles = await listDirectory(config.uploadDirectory);
  const thumbnailFiles = await listDirectory(config.thumbnailDirectory);
  const sharedFiles = await listDirectory(config.filesDirectory);

  const orphanedUploads = uploadFiles.filter((name) => !referencedUploads.has(name));
  const orphanedThumbnails = thumbnailFiles.filter((name) => !referencedThumbnails.has(name));
  const orphanedFiles = sharedFiles.filter((name) => !referencedFiles.has(name));

  const uploadFileSet = new Set(uploadFiles);
  const thumbnailFileSet = new Set(thumbnailFiles);
  const sharedFileSet = new Set(sharedFiles);
  const missingUploads = [];
  const missingThumbnails = [];
  const missingFiles = [];
  for (const row of rows) {
    if (!uploadFileSet.has(row.stored_filename)) missingUploads.push(row.stored_filename);
    if (row.thumbnail_filename && !thumbnailFileSet.has(row.thumbnail_filename)) {
      missingThumbnails.push(row.thumbnail_filename);
    }
  }
  for (const row of fileRows) {
    if (!sharedFileSet.has(row.stored_filename)) missingFiles.push(row.stored_filename);
  }

  console.log(`Orphaned upload files (on disk, no database row): ${orphanedUploads.length}`);
  orphanedUploads.forEach((name) => console.log(`  - uploads/${name}`));
  console.log(`Orphaned thumbnail files (on disk, no database row): ${orphanedThumbnails.length}`);
  orphanedThumbnails.forEach((name) => console.log(`  - thumbnails/${name}`));
  console.log(`Database rows missing their upload file: ${missingUploads.length}`);
  missingUploads.forEach((name) => console.log(`  - ${name}`));
  console.log(`Database rows missing their thumbnail file: ${missingThumbnails.length}`);
  missingThumbnails.forEach((name) => console.log(`  - ${name}`));
  console.log(`Orphaned shared files (on disk, no database row): ${orphanedFiles.length}`);
  orphanedFiles.forEach((name) => console.log(`  - files/${name}`));
  console.log(`Database file rows missing their stored file: ${missingFiles.length}`);
  missingFiles.forEach((name) => console.log(`  - ${name}`));

  const totalOrphans = orphanedUploads.length + orphanedThumbnails.length + orphanedFiles.length;
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
  for (const name of orphanedFiles) {
    await fs.unlink(path.join(config.filesDirectory, name));
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
