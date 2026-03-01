CREATE TABLE entry_actions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('reviewed', 'battlecard_updated', 'shared', 'dismissed', 'noted')),
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (entry_id) REFERENCES entries(id)
);

CREATE INDEX idx_actions_entry ON entry_actions(entry_id);
