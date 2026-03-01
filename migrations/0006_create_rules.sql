CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  condition_field TEXT NOT NULL,
  condition_operator TEXT NOT NULL,
  condition_value TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('include', 'exclude', 'highlight', 'notify_immediately')),
  priority INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
