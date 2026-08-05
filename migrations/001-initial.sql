-- CrossPaste initial schema.
-- The clipboard table is constrained to a single global row (id = 1) because
-- CrossPaste intentionally has no accounts or multiple documents.

CREATE TABLE IF NOT EXISTS clipboard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content_html TEXT NOT NULL DEFAULT '',
  content_plain TEXT NOT NULL DEFAULT '',
  character_count INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO clipboard (id, content_html, content_plain, character_count, revision, created_at, updated_at)
SELECT 1, '', '', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM clipboard WHERE id = 1);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_filename TEXT NOT NULL UNIQUE,
  thumbnail_filename TEXT,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_sort_order ON images (sort_order);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images (created_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
