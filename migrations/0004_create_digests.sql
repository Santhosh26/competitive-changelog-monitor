CREATE TABLE digests (
  id TEXT PRIMARY KEY,
  digest_type TEXT NOT NULL CHECK(digest_type IN ('scheduled', 'on_demand')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  entry_count INTEGER DEFAULT 0,
  competitor_count INTEGER DEFAULT 0,
  content TEXT,
  sent_via TEXT,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_digests_created ON digests(created_at DESC);
