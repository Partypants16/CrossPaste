import { Router } from 'express';
import { saveClipboard, clearClipboard } from '../services/clipboard-service.js';
import { validateClipboardPayload, validateForceClipboardPayload } from '../middleware/validation.js';
import { writeRateLimiter } from '../middleware/rate-limits.js';
import { noCacheForMutableData } from '../middleware/security.js';
import { broadcast } from '../services/realtime-service.js';
import { logger } from '../utilities/logger.js';

export const clipboardRouter = Router();

clipboardRouter.put('/clipboard', writeRateLimiter, noCacheForMutableData, (req, res, next) => {
  try {
    const { html, baseRevision } = validateClipboardPayload(req.body);
    const saved = saveClipboard({ html, baseRevision, force: false });
    broadcast('text-updated', saved);
    logger.info('Clipboard text saved', { revision: saved.revision });
    res.json({ clipboard: saved });
  } catch (error) {
    next(error);
  }
});

clipboardRouter.post('/clipboard/force', writeRateLimiter, noCacheForMutableData, (req, res, next) => {
  try {
    const { html } = validateForceClipboardPayload(req.body);
    const saved = saveClipboard({ html, baseRevision: null, force: true });
    broadcast('text-updated', saved);
    logger.info('Clipboard text force-saved', { revision: saved.revision });
    res.json({ clipboard: saved });
  } catch (error) {
    next(error);
  }
});

clipboardRouter.post('/clipboard/clear', writeRateLimiter, noCacheForMutableData, (_req, res, next) => {
  try {
    const cleared = clearClipboard();
    broadcast('text-updated', cleared);
    logger.info('Clipboard text cleared', { revision: cleared.revision });
    res.json({ clipboard: cleared });
  } catch (error) {
    next(error);
  }
});
