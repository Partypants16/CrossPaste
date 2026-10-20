import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from './logger.js';

export async function ensureDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
  await fs.access(directoryPath, fs.constants.W_OK);
}

export function generateStoredFilename(extension) {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `${crypto.randomUUID()}.${safeExtension}`;
}

export function sanitiseOriginalFilename(originalName) {
  if (!originalName || typeof originalName !== 'string') return 'upload';
  const base = path.basename(originalName).trim();
  const cleaned = base.replace(/[^a-zA-Z0-9 ._-]/g, '').slice(0, 180);
  return cleaned.length > 0 ? cleaned : 'upload';
}

export async function moveFile(sourcePath, destinationPath) {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    // rename() cannot cross filesystems, e.g. if FILES_DIRECTORY is mounted separately.
    if (error.code !== 'EXDEV') throw error;
    await fs.copyFile(sourcePath, destinationPath);
    await fs.unlink(sourcePath);
  }
}

export async function deleteFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    logger.error('Failed to delete file from disk', { code: error.code });
    return false;
  }
}
