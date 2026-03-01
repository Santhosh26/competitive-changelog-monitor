-- Settings key-value store for user-configurable knobs.
-- Empty table = all hardcoded defaults still apply.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
