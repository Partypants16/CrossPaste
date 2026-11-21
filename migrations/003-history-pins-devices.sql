-- CrossPaste history, pins, device names and image text (OCR).
--
-- history keeps past versions of the shared text. While someone keeps editing the
-- same text, saves update one entry (clipboard.history_id points at it) instead of
-- adding a row per autosave; see clipboard-service.js for the rule.

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_html TEXT NOT NULL,
  content_plain TEXT NOT NULL,
  character_count INTEGER NOT NULL,
  device_name TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_updated_at ON history (updated_at);
CREATE INDEX IF NOT EXISTS idx_history_pinned ON history (pinned);

ALTER TABLE clipboard ADD COLUMN updated_by TEXT;
ALTER TABLE clipboard ADD COLUMN history_id INTEGER;

ALTER TABLE images ADD COLUMN uploaded_by TEXT;
ALTER TABLE images ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
-- 'pending' until the text in the image has been read, then 'done' or 'failed'.
ALTER TABLE images ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE images ADD COLUMN ocr_text TEXT;

ALTER TABLE files ADD COLUMN uploaded_by TEXT;
ALTER TABLE files ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

-- Whatever text is shared right now becomes the first history entry.
INSERT INTO history (content_html, content_plain, character_count, device_name, pinned, created_at, updated_at)
SELECT content_html, content_plain, character_count, NULL, 0, updated_at, updated_at
FROM clipboard
WHERE id = 1 AND character_count > 0;

UPDATE clipboard
SET history_id = (SELECT MAX(id) FROM history)
WHERE id = 1 AND character_count > 0;
