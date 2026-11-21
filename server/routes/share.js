import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { uploadRateLimiter } from '../middleware/rate-limits.js';
import { broadcast } from '../services/realtime-service.js';
import { saveClipboard } from '../services/clipboard-service.js';
import { storeImage, getRemainingCapacity as remainingImageCapacity } from '../services/image-service.js';
import { storeFile } from '../services/file-service.js';
import { queueImageText } from '../services/ocr-service.js';
import { getDeviceName } from '../utilities/device.js';
import { deleteFileIfExists } from '../utilities/files.js';
import { logger } from '../utilities/logger.js';

/**
 * Target of the phone's share menu (Web Share Target, declared in manifest.webmanifest).
 * When CrossPaste is installed as an app, "Share → CrossPaste" in any app posts here:
 * shared text or a link becomes the shared text (what it replaces stays in history),
 * shared images go to the image tray and anything else to the file tray. It then
 * redirects to the page, which says what arrived.
 */
export const shareRouter = Router();

const MAX_SHARED_FILES = 10;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;

const upload = multer({
  storage: multer.diskStorage({
    destination: config.incomingDirectory,
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.part`),
  }),
  limits: { fileSize: config.fileSizeLimitBytes, files: MAX_SHARED_FILES, fields: 10, fieldSize: 1024 * 1024 },
});

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** Plain shared text → safe HTML paragraphs, with links made clickable. */
export function sharedTextToHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => {
      const escaped = escapeHtml(paragraph).replace(/\n/g, '<br>');
      const linked = escaped.replace(URL_PATTERN, (url) => `<a href="${url}">${url}</a>`);
      return `<p>${linked}</p>`;
    })
    .join('');
}

/**
 * Apps fill title/text/url differently: Chrome puts the link in `text`, some apps send
 * only `url`, others repeat the link in both. This keeps each piece once. The title is
 * used only when nothing else was shared, since it is usually just the page's name.
 */
export function combineSharedText({ title, text, url }) {
  const clean = (value) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '');
  const sharedTitle = clean(title);
  const sharedText = clean(text);
  const sharedUrl = clean(url);

  const parts = [];
  if (sharedText) parts.push(sharedText);
  if (sharedUrl && !sharedText.includes(sharedUrl)) parts.push(sharedUrl);
  if (parts.length === 0 && sharedTitle) parts.push(sharedTitle);
  return parts.join('\n');
}

async function storeSharedFile(file, deviceName) {
  const isImage = IMAGE_TYPES.has(file.mimetype);
  if (isImage && file.size <= config.imageSizeLimitBytes && remainingImageCapacity() > 0) {
    try {
      const buffer = await fs.readFile(file.path);
      const image = await storeImage({ buffer, originalFilename: file.originalname, deviceName });
      queueImageText(image.id);
      return 'image';
    } catch (error) {
      logger.info('Shared image kept as a file instead', { message: error.message });
    }
  }
  await storeFile({ tempPath: file.path, originalFilename: file.originalname, mimeType: file.mimetype, deviceName });
  return 'file';
}

shareRouter.post('/share', uploadRateLimiter, upload.array('files', MAX_SHARED_FILES), async (req, res) => {
  const deviceName = getDeviceName(req);
  const outcome = { text: 0, images: 0, files: 0, failed: 0 };

  try {
    const combined = combineSharedText(req.body || {});
    if (combined) {
      try {
        const saved = saveClipboard({ html: sharedTextToHtml(combined), baseRevision: null, force: true, deviceName });
        broadcast('text-updated', saved);
        broadcast('history-changed', { reason: 'shared' });
        outcome.text = 1;
      } catch (error) {
        outcome.failed += 1;
        logger.warn('Shared text was not saved', { message: error.message });
      }
    }

    for (const file of req.files || []) {
      try {
        const kind = await storeSharedFile(file, deviceName);
        if (kind === 'image') outcome.images += 1;
        else outcome.files += 1;
      } catch (error) {
        outcome.failed += 1;
        logger.warn('Shared file was not saved', { message: error.message });
      }
    }

    if (outcome.images > 0) broadcast('images-changed', { reason: 'shared' });
    if (outcome.files > 0) broadcast('files-changed', { reason: 'shared' });
    logger.info('Share received', outcome);
  } finally {
    // Stored files were moved already; this removes any that were turned down.
    for (const file of req.files || []) await deleteFileIfExists(file.path);
  }

  const params = new URLSearchParams({
    shared: '1',
    text: String(outcome.text),
    images: String(outcome.images),
    files: String(outcome.files),
    failed: String(outcome.failed),
  });
  res.redirect(303, `/?${params}`);
});

// A share that fails before the handler (e.g. a file over the size limit) still lands on the page.
shareRouter.use('/share', (error, _req, res, _next) => {
  logger.warn('Share rejected', { code: error.code, message: error.message });
  res.redirect(303, '/?shared=1&failed=1');
});
