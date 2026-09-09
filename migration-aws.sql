ALTER TABLE files ADD COLUMN storage TEXT NOT NULL DEFAULT 'r2';
CREATE INDEX IF NOT EXISTS idx_files_storage_folder ON files(storage, folder, kind, name);
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
