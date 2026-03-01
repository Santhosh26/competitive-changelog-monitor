CREATE TABLE source_health (
  source_id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'healthy' CHECK(status IN ('healthy', 'degraded', 'failing', 'disabled')),
  last_http_status INTEGER,
  last_error TEXT,
  last_check_at TEXT,
  avg_response_ms INTEGER DEFAULT 0,
  consecutive_failures INTEGER DEFAULT 0,
  total_entries_found INTEGER DEFAULT 0,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);
