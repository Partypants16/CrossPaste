import { Router } from 'express';
import { getClipboardState } from '../services/clipboard-service.js';
import { listImages, getRemainingCapacity as getRemainingImageCapacity } from '../services/image-service.js';
import { listFiles, getRemainingCapacity as getRemainingFileCapacity } from '../services/file-service.js';
import { config } from '../config.js';

export const stateRouter = Router();

stateRouter.get('/state', (_req, res) => {
  res.json({
    clipboard: getClipboardState(),
    images: listImages(),
    files: listFiles(),
    limits: {
      textCharacterLimit: config.textCharacterLimit,
      imageCountLimit: config.imageCountLimit,
      imageSizeLimitBytes: config.imageSizeLimitBytes,
      remainingImageCapacity: getRemainingImageCapacity(),
      fileCountLimit: config.fileCountLimit,
      fileSizeLimitBytes: config.fileSizeLimitBytes,
      remainingFileCapacity: getRemainingFileCapacity(),
    },
    settings: {
      autosaveDelayMs: config.autosaveDelayMs,
    },
  });
});
