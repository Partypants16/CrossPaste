import { getDatabase } from '../database.js';
import { config } from '../config.js';

export class HistoryNotFoundError extends Error {
  constructor() {
    super('History entry not found');
    this.name = 'HistoryNotFoundError';
  }
}

const SEARCH_LIMIT_MAX = 200;

let lastTimestampMs = 0;

// Strictly increasing, so two saves in the same millisecond still sort newest-first.
function nowIso() {
  lastTimestampMs = Math.max(Date.now(), lastTimestampMs + 1);
  return new Date(lastTimestampMs).toISOString();
}

function toPublicShape(row, openHistoryId = null) {
  return {
    id: row.id,
    contentHtml: row.content_html,
    contentPlain: row.content_plain,
    characterCount: row.character_count,
    deviceName: row.device_name,
    pinned: row.pinned === 1,
    isCurrent: openHistoryId != null && row.id === openHistoryId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * True when `next` reads as an edit of `previous` (typing, fixing a word) rather than
 * something new pasted over it. Measured by how much of the start and end of the two
 * texts is unchanged: an edit keeps most of it, a replacement keeps almost none.
 */
export function looksLikeEdit(previous, next) {
  if (!previous || !next) return false;
  const a = Array.from(previous);
  const b = Array.from(next);
  const shorter = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < shorter && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return prefix + suffix >= shorter * 0.5;
}

/**
 * Called inside the clipboard save transaction. Decides whether this save continues
 * the history entry being written (same device, recent, an edit of the same text, not
 * pinned) or starts a new one, and returns the id of the entry that now holds it.
 * Saving text that is already in history moves that entry to the top instead of
 * storing a duplicate.
 */
export function recordTextInHistory(db, { html, plain, characterCount, deviceName, openHistoryId }) {
  if (characterCount === 0) return null;
  const timestamp = nowIso();

  const open = openHistoryId != null ? db.prepare('SELECT * FROM history WHERE id = ?').get(openHistoryId) : null;
  if (open && open.pinned === 0) {
    const ageSeconds = (Date.now() - Date.parse(open.updated_at)) / 1000;
    const sameDevice = (open.device_name ?? null) === (deviceName ?? null);
    if (ageSeconds <= config.historyMergeSeconds && sameDevice && looksLikeEdit(open.content_plain, plain)) {
      db.prepare(
        `UPDATE history SET content_html = ?, content_plain = ?, character_count = ?, updated_at = ? WHERE id = ?`
      ).run(html, plain, characterCount, timestamp, open.id);
      return open.id;
    }
  }

  const duplicate = db
    .prepare('SELECT id FROM history WHERE content_html = ? ORDER BY id DESC LIMIT 1')
    .get(html);
  if (duplicate) {
    db.prepare('UPDATE history SET updated_at = ?, device_name = COALESCE(?, device_name) WHERE id = ?').run(
      timestamp,
      deviceName ?? null,
      duplicate.id
    );
    return duplicate.id;
  }

  const result = db
    .prepare(
      `INSERT INTO history (content_html, content_plain, character_count, device_name, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    )
    .run(html, plain, characterCount, deviceName ?? null, timestamp, timestamp);
  return Number(result.lastInsertRowid);
}

function openHistoryId(db) {
  return db.prepare('SELECT history_id FROM clipboard WHERE id = 1').get()?.history_id ?? null;
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Pinned entries first, then newest first. `query` matches the plain text, case-insensitively. */
export function listHistory({ query = '', limit = 100, offset = 0 } = {}) {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(1, limit), SEARCH_LIMIT_MAX);
  const safeOffset = Math.max(0, offset);
  const trimmed = query.trim();
  const where = trimmed ? "WHERE content_plain LIKE ? ESCAPE '\\'" : '';
  const params = trimmed ? [`%${escapeLike(trimmed)}%`] : [];

  const rows = db
    .prepare(`SELECT * FROM history ${where} ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, safeLimit, safeOffset);
  const total = db.prepare(`SELECT COUNT(*) AS total FROM history ${where}`).get(...params).total;
  const current = openHistoryId(db);
  return { items: rows.map((row) => toPublicShape(row, current)), total };
}

export function getHistoryEntry(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM history WHERE id = ?').get(id);
  if (!row) throw new HistoryNotFoundError();
  return toPublicShape(row, openHistoryId(db));
}

export function setHistoryPinned(id, pinned) {
  const db = getDatabase();
  const result = db.prepare('UPDATE history SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  if (result.changes === 0) throw new HistoryNotFoundError();
  return getHistoryEntry(id);
}

export function deleteHistoryEntry(id) {
  const db = getDatabase();
  const transaction = db.transaction(() => {
    const result = db.prepare('DELETE FROM history WHERE id = ?').run(id);
    if (result.changes === 0) throw new HistoryNotFoundError();
    db.prepare('UPDATE clipboard SET history_id = NULL WHERE id = 1 AND history_id = ?').run(id);
  });
  transaction();
  return { id };
}

/** Removes every unpinned entry. Pinned ones stay. */
export function clearUnpinnedHistory() {
  const db = getDatabase();
  const transaction = db.transaction(() => {
    const removed = db.prepare('DELETE FROM history WHERE pinned = 0').run().changes;
    db.prepare(
      'UPDATE clipboard SET history_id = NULL WHERE id = 1 AND history_id IS NOT NULL AND history_id NOT IN (SELECT id FROM history)'
    ).run();
    return removed;
  });
  return transaction();
}

/**
 * Auto-cleanup: drops unpinned entries older than HISTORY_MAX_DAYS, then the oldest
 * unpinned ones beyond HISTORY_MAX_ITEMS. The entry being written right now is kept.
 */
export function trimHistory({ now = Date.now() } = {}) {
  const db = getDatabase();
  const transaction = db.transaction(() => {
    const keepId = openHistoryId(db) ?? -1;
    let removed = 0;

    if (config.historyMaxDays > 0) {
      const cutoff = new Date(now - config.historyMaxDays * 24 * 60 * 60 * 1000).toISOString();
      removed += db
        .prepare('DELETE FROM history WHERE pinned = 0 AND id != ? AND updated_at < ?')
        .run(keepId, cutoff).changes;
    }

    if (config.historyMaxItems > 0) {
      removed += db
        .prepare(
          `DELETE FROM history WHERE pinned = 0 AND id != ? AND id NOT IN (
             SELECT id FROM history WHERE pinned = 0 ORDER BY updated_at DESC, id DESC LIMIT ?
           )`
        )
        .run(keepId, config.historyMaxItems).changes;
    }

    return removed;
  });
  return transaction();
}
