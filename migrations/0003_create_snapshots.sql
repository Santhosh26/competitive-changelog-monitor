CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_length INTEGER,
  captured_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX idx_snapshots_source ON snapshots(source_id, captured_at DESC);
CREATE INDEX idx_snapshots_hash ON snapshots(content_hash);
