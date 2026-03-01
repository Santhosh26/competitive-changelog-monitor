CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  competitor_name TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content_url TEXT NOT NULL,
  published_at TEXT,
  tags TEXT DEFAULT '[]',
  relevance_score INTEGER DEFAULT 50,
  ai_summary TEXT,
  is_update INTEGER DEFAULT 0,
  cluster_id TEXT,
  first_seen_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT DEFAULT (datetime('now')),
  reviewed INTEGER DEFAULT 0,
  actioned INTEGER DEFAULT 0,
  FOREIGN KEY (source_id) REFERENCES sources(id),
  UNIQUE(source_id, content_url)
);

CREATE INDEX idx_entries_competitor ON entries(competitor_name);
CREATE INDEX idx_entries_first_seen ON entries(first_seen_at DESC);
CREATE INDEX idx_entries_tags ON entries(tags);
CREATE INDEX idx_entries_relevance ON entries(relevance_score DESC);
CREATE INDEX idx_entries_cluster ON entries(cluster_id);
CREATE INDEX idx_entries_reviewed ON entries(reviewed);
