import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';
import { uploadRateLimiter } from '../middleware/rate-limits.js';
import { broadcast } from '../services/realtime-service.js';
import { logger } from '../utilities/logger.js';
import { deleteFileIfExists } from '../utilities/files.js';
import {
  storeFile,
  listFiles,
  getFileById,
  getFileRowById,
  deleteFile,
} from '../services/file-service.js';

export const filesRouter = Router();

// Uploads stream to disk rather than memory, since a single file can be hundreds of MB.
// Multer removes the partial file itself if the upload is aborted or exceeds the limit.
const upload = multer({
  storage: multer.diskStorage({
    destination: config.incomingDirectory,
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.part`),
  }),
  limits: { fileSize: config.fileSizeLimitBytes, files: 1 },
});

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

filesRouter.get('/files', (_req, res) => {
  res.json({ files: listFiles() });
});

filesRouter.post('/files', uploadRateLimiter, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { code: 'MISSING_FILE', message: 'No file was provided.' } });
    }
    const file = await storeFile({
      tempPath: req.file.path,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
    });
    broadcast('files-changed', { reason: 'uploaded', fileId: file.id });
    logger.info('File uploaded', { fileId: file.id, mimeType: file.mimeType, sizeBytes: file.sizeBytes });
    res.status(201).json({ file });
  } catch (error) {
    next(error);
  } finally {
    // Already moved on success; this only cleans up after a rejected upload.
    if (req.file) await deleteFileIfExists(req.file.path);
  }
});

filesRouter.get('/files/:id', (req, res, next) => {
  try {
    const file = getFileById(Number(req.params.id));
    res.json({ file });
  } catch (error) {
    next(error);
  }
});

filesRouter.get('/files/:id/download', (req, res, next) => {
  try {
    const row = getFileRowById(Number(req.params.id));
    res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
    res.download(path.join(config.filesDirectory, row.stored_filename), row.original_filename);
  } catch (error) {
    next(error);
  }
});

filesRouter.delete('/files/:id', async (req, res, next) => {
  try {
    const result = await deleteFile(Number(req.params.id));
    broadcast('files-changed', { reason: 'deleted', fileId: result.id });
    logger.info('File deleted', { fileId: result.id });
    res.json({ ok: true, id: result.id });
  } catch (error) {
    next(error);
  }
});
