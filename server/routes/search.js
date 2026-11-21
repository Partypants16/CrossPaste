import { Router } from 'express';
import { getDatabase } from '../database.js';
import { listHistory } from '../services/history-service.js';
import { noCacheForMutableData } from '../middleware/security.js';

export const searchRouter = Router();

const RESULT_LIMIT = 50;
const SNIPPET_RADIUS = 60;

function escapeLike(value) {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

/** A short piece of `text` around the first match, for showing why an image matched. */
export function snippetAround(text, query) {
  if (!text) return '';
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return '';
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + query.length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

// One search over text history, image names and the text read from images, and file names.
searchRouter.get('/search', noCacheForMutableData, (req, res, next) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
    if (!query) return res.json({ query, history: [], images: [], files: [] });

    const db = getDatabase();
    const like = `%${escapeLike(query)}%`;

    const images = db
      .prepare(
        `SELECT id, original_filename, ocr_text, created_at, uploaded_by, pinned FROM images
         WHERE original_filename LIKE ? ESCAPE '!' OR ocr_text LIKE ? ESCAPE '!'
         ORDER BY sort_order ASC LIMIT ?`
      )
      .all(like, like, RESULT_LIMIT)
      .map((row) => ({
        id: row.id,
        originalFilename: row.original_filename,
        createdAt: row.created_at,
        uploadedBy: row.uploaded_by ?? null,
        pinned: row.pinned === 1,
        textSnippet: snippetAround(row.ocr_text, query),
      }));

    const files = db
      .prepare(
        `SELECT id, original_filename, size_bytes, created_at, uploaded_by, pinned FROM files
         WHERE original_filename LIKE ? ESCAPE '!' ORDER BY sort_order ASC LIMIT ?`
      )
      .all(like, RESULT_LIMIT)
      .map((row) => ({
        id: row.id,
        originalFilename: row.original_filename,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        uploadedBy: row.uploaded_by ?? null,
        pinned: row.pinned === 1,
      }));

    const history = listHistory({ query, limit: RESULT_LIMIT });
    res.json({ query, history: history.items, historyTotal: history.total, images, files });
  } catch (error) {
    next(error);
  }
});
