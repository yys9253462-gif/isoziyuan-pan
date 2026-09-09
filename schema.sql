CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  storage TEXT NOT NULL DEFAULT 'r2' CHECK (storage IN ('r2', 'aws')),
  object_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
  size INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder, kind, name);
CREATE INDEX IF NOT EXISTS idx_files_storage_folder ON files(storage, folder, kind, name);

CREATE TABLE IF NOT EXISTS shares (
  code TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL DEFAULT 0,
  remaining INTEGER,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_file_id ON shares(file_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_usage (
  month TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0
);
