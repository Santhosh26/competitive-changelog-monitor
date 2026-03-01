CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  competitor_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('rss', 'atom', 'api', 'html', 'browser')),
  parser_config TEXT DEFAULT '{}',
  check_interval_hours INTEGER DEFAULT 6,
  enabled INTEGER DEFAULT 1,
  last_checked_at TEXT,
  last_success_at TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_url)
);

CREATE INDEX idx_sources_competitor ON sources(competitor_name);
CREATE INDEX idx_sources_enabled ON sources(enabled);
