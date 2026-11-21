import { getDatabase } from '../database.js';
import { config } from '../config.js';
import { sanitiseHtml, extractPlainText, countCharacters } from '../utilities/sanitise.js';
import { recordTextInHistory } from './history-service.js';

export class TextTooLargeError extends Error {
  constructor(characterCount) {
    super('Text exceeds the configured character limit');
    this.name = 'TextTooLargeError';
    this.characterCount = characterCount;
  }
}

export class RevisionConflictError extends Error {
  constructor(current) {
    super('Submitted revision is older than the current server revision');
    this.name = 'RevisionConflictError';
    this.current = current;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function readRow(db) {
  return db.prepare('SELECT * FROM clipboard WHERE id = 1').get();
}

export function getClipboardState() {
  const db = getDatabase();
  const row = readRow(db);
  return toPublicShape(row);
}

function toPublicShape(row) {
  return {
    contentHtml: row.content_html,
    contentPlain: row.content_plain,
    characterCount: row.character_count,
    revision: row.revision,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? null,
  };
}

/**
 * Saves the clipboard when the caller's baseRevision matches the server's current
 * revision. A stale baseRevision means another device saved in the meantime, so the
 * write is rejected with a RevisionConflictError instead of silently overwriting it.
 */
export function saveClipboard({ html, baseRevision, force = false, deviceName = null }) {
  const db = getDatabase();
  const clean = sanitiseHtml(html);
  const plainText = extractPlainText(clean);
  const characterCount = countCharacters(plainText);

  if (characterCount > config.textCharacterLimit) {
    throw new TextTooLargeError(characterCount);
  }

  const transaction = db.transaction(() => {
    const current = readRow(db);

    if (!force && baseRevision !== current.revision) {
      throw new RevisionConflictError(toPublicShape(current));
    }

    const nextRevision = current.revision + 1;
    const timestamp = nowIso();
    const historyId = recordTextInHistory(db, {
      html: clean,
      plain: plainText,
      characterCount,
      deviceName,
      openHistoryId: current.history_id,
    });

    db.prepare(
      `UPDATE clipboard
       SET content_html = ?, content_plain = ?, character_count = ?, revision = ?, updated_at = ?,
           updated_by = ?, history_id = ?
       WHERE id = 1`
    ).run(clean, plainText, characterCount, nextRevision, timestamp, deviceName, historyId);

    return toPublicShape(readRow(db));
  });

  return transaction();
}

// Clearing keeps the old text in history; the next text typed starts a new entry.
export function clearClipboard({ deviceName = null } = {}) {
  const db = getDatabase();
  const transaction = db.transaction(() => {
    const current = readRow(db);
    const nextRevision = current.revision + 1;
    const timestamp = nowIso();
    db.prepare(
      `UPDATE clipboard
       SET content_html = '', content_plain = '', character_count = 0, revision = ?, updated_at = ?,
           updated_by = ?, history_id = NULL
       WHERE id = 1`
    ).run(nextRevision, timestamp, deviceName);
    return toPublicShape(readRow(db));
  });
  return transaction();
}

export function expireClipboardIfOlderThan(cutoffIso) {
  const db = getDatabase();
  const transaction = db.transaction(() => {
    const current = readRow(db);
    if (current.character_count === 0) return null;
    if (current.updated_at >= cutoffIso) return null;

    const nextRevision = current.revision + 1;
    const timestamp = nowIso();
    db.prepare(
      `UPDATE clipboard
       SET content_html = '', content_plain = '', character_count = 0, revision = ?, updated_at = ?,
           updated_by = NULL, history_id = NULL
       WHERE id = 1`
    ).run(nextRevision, timestamp);
    return toPublicShape(readRow(db));
  });
  return transaction();
}
