import express, { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { config } from '../config.js';
import { uploadRateLimiter } from '../middleware/rate-limits.js';
import { broadcast } from '../services/realtime-service.js';
import { logger } from '../utilities/logger.js';
import { getDeviceName } from '../utilities/device.js';
import { validatePinPayload, parseId } from '../middleware/validation.js';
import { writeRateLimiter } from '../middleware/rate-limits.js';
import { noCacheForMutableData } from '../middleware/security.js';
import { queueImageText, getImageText } from '../services/ocr-service.js';
import {
  storeImage,
  listImages,
  getImageById,
  getImageRowById,
  deleteImage,
  setImagePinned,
  ImageNotFoundError,
} from '../services/image-service.js';

export const imagesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.imageSizeLimitBytes, files: 1 },
});

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

imagesRouter.get('/images', (_req, res) => {
  res.json({ images: listImages() });
});

imagesRouter.post('/images', uploadRateLimiter, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { code: 'MISSING_FILE', message: 'No image file was provided.' } });
    }
    const image = await storeImage({
      buffer: req.file.buffer,
      originalFilename: req.file.originalname,
      deviceName: getDeviceName(req),
    });
    broadcast('images-changed', { reason: 'uploaded', imageId: image.id });
    queueImageText(image.id);
    logger.info('Image uploaded', { imageId: image.id, mimeType: image.mimeType });
    res.status(201).json({ image });
  } catch (error) {
    next(error);
  }
});

imagesRouter.get('/images/:id', (req, res, next) => {
  try {
    const image = getImageById(Number(req.params.id));
    res.json({ image });
  } catch (error) {
    next(error);
  }
});

imagesRouter.get('/images/:id/thumbnail', (req, res, next) => {
  try {
    const row = getImageRowById(Number(req.params.id));
    if (!row.thumbnail_filename) throw new ImageNotFoundError();
    res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
    res.sendFile(path.join(config.thumbnailDirectory, row.thumbnail_filename));
  } catch (error) {
    next(error);
  }
});

imagesRouter.get('/images/:id/file', (req, res, next) => {
  try {
    const row = getImageRowById(Number(req.params.id));
    res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
    res.setHeader('Content-Type', row.mime_type);
    res.sendFile(path.join(config.uploadDirectory, row.stored_filename));
  } catch (error) {
    next(error);
  }
});

imagesRouter.get('/images/:id/download', (req, res, next) => {
  try {
    const row = getImageRowById(Number(req.params.id));
    res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
    res.download(path.join(config.uploadDirectory, row.stored_filename), row.original_filename);
  } catch (error) {
    next(error);
  }
});

imagesRouter.delete('/images/:id', async (req, res, next) => {
  try {
    const result = await deleteImage(Number(req.params.id));
    broadcast('images-changed', { reason: 'deleted', imageId: result.id });
    logger.info('Image deleted', { imageId: result.id });
    res.json({ ok: true, id: result.id });
  } catch (error) {
    next(error);
  }
});

imagesRouter.post('/images/:id/pin', express.json({ limit: '2kb' }), writeRateLimiter, noCacheForMutableData, (req, res, next) => {
  try {
    const { pinned } = validatePinPayload(req.body);
    const image = setImagePinned(parseId(req.params.id), pinned);
    broadcast('images-changed', { reason: pinned ? 'pinned' : 'unpinned', imageId: image.id });
    res.json({ image });
  } catch (error) {
    next(error);
  }
});

// The text read from the image. Waits if it is still being read; ?retry=1 re-reads a failed one.
imagesRouter.get('/images/:id/text', noCacheForMutableData, async (req, res, next) => {
  try {
    const result = await getImageText(parseId(req.params.id), { retry: req.query.retry === '1' });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
