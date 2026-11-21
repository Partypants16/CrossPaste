import { Router } from 'express';
import {
  listHistory,
  getHistoryEntry,
  setHistoryPinned,
  deleteHistoryEntry,
  clearUnpinnedHistory,
} from '../services/history-service.js';
import { saveClipboard } from '../services/clipboard-service.js';
import { validatePinPayload, parseId } from '../middleware/validation.js';
import { writeRateLimiter } from '../middleware/rate-limits.js';
import { noCacheForMutableData } from '../middleware/security.js';
import { broadcast } from '../services/realtime-service.js';
import { getDeviceName } from '../utilities/device.js';
import { logger } from '../utilities/logger.js';

export const historyRouter = Router();

historyRouter.get('/history', noCacheForMutableData, (req, res, next) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const limit = Number.parseInt(req.query.limit, 10) || 100;
    const offset = Number.parseInt(req.query.offset, 10) || 0;
    res.json(listHistory({ query, limit, offset }));
  } catch (error) {
    next(error);
  }
});

historyRouter.post('/history/:id/pin', writeRateLimiter, noCacheForMutableData, (req, res, next) => {
  try {
    const { pinned } = validatePinPayload(req.body);
    const entry = setHistoryPinned(parseId(req.params.id), pinned);
    broadcast('history-changed', { reason: pinned ? 'pinned' : 'unpinned', id: entry.id });
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

// Makes an old entry the shared text again. The text it replaces stays in history.
historyRouter.post('/history/:id/restore', writeRateLimiter, noCacheForMutableData, (req, res, next) => {
  try {
    const entry = getHistoryEntry(parseId(req.params.id));
    const saved = saveClipboard({
      html: entry.contentHtml,
      baseRevision: null,
      force: true,
      deviceName: getDeviceName(req),
    });
    broadcast('text-updated', saved);
    broadcast('history-changed', { reason: 'restored', id: entry.id });
    logger.info('History entry restored', { historyId: entry.id, revision: saved.revision });
    res.json({ clipboard: saved });
  } catch (error) {
    next(error);
  }
});

historyRouter.delete('/history/:id', writeRateLimiter, noCacheForMutableData, (req, res, next) => {
  try {
    const result = deleteHistoryEntry(parseId(req.params.id));
    broadcast('history-changed', { reason: 'deleted', id: result.id });
    res.json({ ok: true, id: result.id });
  } catch (error) {
    next(error);
  }
});

historyRouter.post('/history/clear', writeRateLimiter, noCacheForMutableData, (_req, res, next) => {
  try {
    const removed = clearUnpinnedHistory();
    broadcast('history-changed', { reason: 'cleared' });
    logger.info('Unpinned history cleared', { removed });
    res.json({ ok: true, removed });
  } catch (error) {
    next(error);
  }
});
