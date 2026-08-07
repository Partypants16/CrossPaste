-- CrossPaste file sharing migration.
-- Adds the files table for general file sharing.

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_filename TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_sort_order ON files (sort_order);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files (created_at);
