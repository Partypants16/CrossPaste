import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../utilities/logger.js';
import { getDatabase } from '../database.js';
import { deleteFileIfExists } from '../utilities/files.js';
import { expireClipboardIfOlderThan } from './clipboard-service.js';
import { expireOldFiles } from './file-service.js';
import { broadcast } from './realtime-service.js';

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

let cleanupInProgress = false;
let intervalHandle = null;

async function expireOldImages(cutoffIso) {
  const db = getDatabase();
  const expired = db.prepare('SELECT * FROM images WHERE created_at < ?').all(cutoffIso);
  if (expired.length === 0) return 0;

  const deleteRows = db.transaction((rows) => {
    for (const row of rows) {
      db.prepare('DELETE FROM images WHERE id = ?').run(row.id);
    }
  });
  deleteRows(expired);

  for (const row of expired) {
    await deleteFileIfExists(path.join(config.uploadDirectory, row.stored_filename));
    if (row.thumbnail_filename) {
      await deleteFileIfExists(path.join(config.thumbnailDirectory, row.thumbnail_filename));
    }
  }

  return expired.length;
}

/**
 * Automatic expiry is opt-in (CONTENT_EXPIRY_HOURS=0 disables it) and never overlaps
 * itself, since a slow cleanup run and a timer tick could otherwise race.
 */
export async function runExpiryCleanup() {
  if (!config.contentExpiryEnabled) return;
  if (cleanupInProgress) return;

  cleanupInProgress = true;
  try {
    const cutoff = new Date(Date.now() - config.contentExpiryHours * 60 * 60 * 1000).toISOString();

    const expiredClipboard = expireClipboardIfOlderThan(cutoff);
    const expiredImageCount = await expireOldImages(cutoff);
    const expiredFileCount = await expireOldFiles(cutoff);

    if (expiredClipboard) {
      broadcast('text-updated', expiredClipboard);
    }
    if (expiredImageCount > 0) {
      broadcast('images-changed', { reason: 'expired' });
    }
    if (expiredFileCount > 0) {
      broadcast('files-changed', { reason: 'expired' });
    }
    if (expiredClipboard || expiredImageCount > 0 || expiredFileCount > 0) {
      logger.info('Expiry cleanup removed expired content', {
        clipboardExpired: Boolean(expiredClipboard),
        imagesExpired: expiredImageCount,
        filesExpired: expiredFileCount,
      });
    }
  } catch (error) {
    logger.error('Expiry cleanup failed', { message: error.message });
  } finally {
    cleanupInProgress = false;
  }
}

export function startExpiryScheduler() {
  if (!config.contentExpiryEnabled) return null;
  intervalHandle = setInterval(() => {
    runExpiryCleanup();
  }, CLEANUP_INTERVAL_MS);
  intervalHandle.unref();
  return intervalHandle;
}

export function stopExpiryScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
