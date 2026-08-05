import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { getDatabase } from '../database.js';
import { config } from '../config.js';
import { logger } from '../utilities/logger.js';
import {
  generateStoredFilename,
  sanitiseOriginalFilename,
  deleteFileIfExists,
} from '../utilities/files.js';

export class UnsupportedImageTypeError extends Error {
  constructor(detected) {
    super('Unsupported or unrecognised image type');
    this.name = 'UnsupportedImageTypeError';
    this.detected = detected;
  }
}

export class ImageTooLargeError extends Error {
  constructor(sizeBytes) {
    super('Image exceeds the configured size limit');
    this.name = 'ImageTooLargeError';
    this.sizeBytes = sizeBytes;
  }
}

export class ImageLimitReachedError extends Error {
  constructor() {
    super('The maximum number of stored images has been reached');
    this.name = 'ImageLimitReachedError';
  }
}

export class ImageNotFoundError extends Error {
  constructor() {
    super('Image not found');
    this.name = 'ImageNotFoundError';
  }
}

const ALLOWED_MIME_TO_EXTENSION = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const THUMBNAIL_MAX_DIMENSION = 400;

function nowIso() {
  return new Date().toISOString();
}

function countImages(db) {
  return db.prepare('SELECT COUNT(*) AS total FROM images').get().total;
}

async function buildThumbnail(buffer, isAnimatedGif) {
  const pipeline = sharp(buffer, isAnimatedGif ? { animated: false } : undefined);
  return pipeline
    .rotate()
    .resize({ width: THUMBNAIL_MAX_DIMENSION, height: THUMBNAIL_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

async function processStaticImage(buffer) {
  const image = sharp(buffer).rotate();
  const metadata = await image.metadata();

  const pipeline = image.resize({
    width: config.imageMaxDimension,
    height: config.imageMaxDimension,
    fit: 'inside',
    withoutEnlargement: true,
  });

  let finalBuffer;
  let finalMetadata;
  if (metadata.format === 'png') {
    finalBuffer = await pipeline.png({ compressionLevel: 8 }).toBuffer();
  } else if (metadata.format === 'webp') {
    finalBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
  } else {
    finalBuffer = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  }
  finalMetadata = await sharp(finalBuffer).metadata();

  return { buffer: finalBuffer, width: finalMetadata.width, height: finalMetadata.height };
}

async function processGif(buffer) {
  const metadata = await sharp(buffer, { animated: true }).metadata();
  return { buffer, width: metadata.width, height: metadata.height };
}

/**
 * Detects the real file type from magic bytes (never trusts the filename or the
 * declared Content-Type), rejects anything outside the documented allow-list,
 * resizes/strips-metadata for static formats, and preserves GIF animation untouched.
 */
export async function storeImage({ buffer, originalFilename }) {
  if (buffer.length > config.imageSizeLimitBytes) {
    throw new ImageTooLargeError(buffer.length);
  }

  const detected = await fileTypeFromBuffer(buffer);
  const mimeType = detected?.mime;
  if (!mimeType || !ALLOWED_MIME_TO_EXTENSION[mimeType]) {
    throw new UnsupportedImageTypeError(mimeType || 'unknown');
  }

  const extension = ALLOWED_MIME_TO_EXTENSION[mimeType];
  const isGif = mimeType === 'image/gif';

  const processed = isGif ? await processGif(buffer) : await processStaticImage(buffer);
  const thumbnailBuffer = await buildThumbnail(buffer, isGif);

  const storedFilename = generateStoredFilename(extension);
  const thumbnailFilename = generateStoredFilename('jpg');
  const safeOriginalFilename = sanitiseOriginalFilename(originalFilename);
  const sizeBytes = processed.buffer.length;
  const timestamp = nowIso();

  const db = getDatabase();
  const insertRow = db.transaction(() => {
    if (countImages(db) >= config.imageCountLimit) {
      throw new ImageLimitReachedError();
    }
    const nextSortOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM images').get().maxOrder) + 1;
    const result = db
      .prepare(
        `INSERT INTO images
          (stored_filename, thumbnail_filename, original_filename, mime_type, size_bytes, width, height, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        storedFilename,
        thumbnailFilename,
        safeOriginalFilename,
        mimeType,
        sizeBytes,
        processed.width ?? null,
        processed.height ?? null,
        nextSortOrder,
        timestamp
      );
    return result.lastInsertRowid;
  });

  const imageId = insertRow();

  try {
    await fs.writeFile(path.join(config.uploadDirectory, storedFilename), processed.buffer);
    await fs.writeFile(path.join(config.thumbnailDirectory, thumbnailFilename), thumbnailBuffer);
  } catch (error) {
    db.prepare('DELETE FROM images WHERE id = ?').run(imageId);
    await deleteFileIfExists(path.join(config.uploadDirectory, storedFilename));
    await deleteFileIfExists(path.join(config.thumbnailDirectory, thumbnailFilename));
    logger.error('Failed to write image to disk, rolled back database row', { code: error.code });
    throw error;
  }

  return getImageById(imageId);
}

export function listImages() {
  const db = getDatabase();
  return db.prepare('SELECT * FROM images ORDER BY sort_order ASC').all().map(toPublicShape);
}

export function getImageById(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(id);
  if (!row) throw new ImageNotFoundError();
  return toPublicShape(row);
}

export function getImageRowById(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(id);
  if (!row) throw new ImageNotFoundError();
  return row;
}

export async function deleteImage(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(id);
  if (!row) throw new ImageNotFoundError();

  db.prepare('DELETE FROM images WHERE id = ?').run(id);

  const originalDeleted = await deleteFileIfExists(path.join(config.uploadDirectory, row.stored_filename));
  const thumbnailDeleted = row.thumbnail_filename
    ? await deleteFileIfExists(path.join(config.thumbnailDirectory, row.thumbnail_filename))
    : true;

  if (!originalDeleted || !thumbnailDeleted) {
    logger.error('Image file cleanup incomplete after database deletion', { imageId: id });
  }

  return { id };
}

export function getRemainingCapacity() {
  const db = getDatabase();
  return Math.max(0, config.imageCountLimit - countImages(db));
}

function toPublicShape(row) {
  return {
    id: row.id,
    storedFilename: row.stored_filename,
    thumbnailFilename: row.thumbnail_filename,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}
