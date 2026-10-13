-- Additive migration: legacy IDs, object keys and shares remain untouched.
ALTER TABLE files ADD COLUMN storage_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_files_space_folder ON files(storage, storage_id, folder);
