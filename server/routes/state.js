import { Router } from 'express';
import { getClipboardState } from '../services/clipboard-service.js';
import { listImages, getRemainingCapacity } from '../services/image-service.js';
import { config } from '../config.js';

export const stateRouter = Router();

stateRouter.get('/state', (_req, res) => {
  res.json({
    clipboard: getClipboardState(),
    images: listImages(),
    limits: {
      textCharacterLimit: config.textCharacterLimit,
      imageCountLimit: config.imageCountLimit,
      imageSizeLimitBytes: config.imageSizeLimitBytes,
      remainingImageCapacity: getRemainingCapacity(),
    },
    settings: {
      autosaveDelayMs: config.autosaveDelayMs,
    },
  });
});
