// ─── Monitored Source ────────────────────────────────────────────────
// A competitor blog, changelog, RSS feed, or documentation page we track.

export interface Source {
  id: string;
  competitor_name: string;
  source_url: string;
  source_type: 'rss' | 'atom' | 'api' | 'html' | 'browser';
  parser_config: string; // JSON: CSS selectors, API paths, etc. per source
  check_interval_hours: number; // How often to check (default: 6)
  enabled: boolean;
  last_checked_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  created_at: string;
}

// ─── Parsed Entry ────────────────────────────────────────────────────
// A single competitor update extracted from a source.

export interface Entry {
  id: string;
  source_id: string;
  competitor_name: string;
  title: string;
  summary: string; // Plain text summary (sanitized)
  content_url: string; // Direct URL to the original entry
  published_at: string | null;
  tags: string[]; // ["Security", "API", "Pricing"]
  relevance_score: number; // 0-100 (higher = more important)
  ai_summary: string | null; // Claude-generated one-liner (Phase 5)
  is_update: boolean; // true if this is a change to existing content
  cluster_id: string | null; // Links to dedup cluster
  first_seen_at: string;
  last_seen_at: string;
  reviewed: boolean; // User has seen this
  actioned: boolean; // User has taken action
}

// ─── Content Snapshot ────────────────────────────────────────────────
// For change detection — full-page HTML stored in R2, hash in D1.

export interface Snapshot {
  id: string;
  source_id: string;
  content_hash: string; // SHA-256 of the page content
  r2_key: string; // Key in R2 bucket for the full HTML
  captured_at: string;
  content_length: number;
}

// ─── Source Health ───────────────────────────────────────────────────

export interface SourceHealth {
  source_id: string;
  status: 'healthy' | 'degraded' | 'failing' | 'disabled';
  last_http_status: number | null;
  last_error: string | null;
  last_check_at: string;
  avg_response_ms: number;
  consecutive_failures: number;
  total_entries_found: number;
}

// ─── Digest ──────────────────────────────────────────────────────────

export interface Digest {
  id: string;
  digest_type: 'scheduled' | 'on_demand';
  period_start: string;
  period_end: string;
  entry_count: number;
  competitor_count: number;
  content: string | null;
  sent_via: string; // 'telegram', 'slack', 'email'
  sent_at: string | null;
  created_at: string;
}

// ─── User-Configured Filter Rule ────────────────────────────────────

export interface Rule {
  id: string;
  name: string;
  condition_field: 'competitor_name' | 'tags' | 'relevance_score' | 'title';
  condition_operator: 'equals' | 'contains' | 'greater_than' | 'less_than';
  condition_value: string;
  action: 'include' | 'exclude' | 'highlight' | 'notify_immediately';
  priority: number;
  enabled: boolean;
  created_at: string;
}

// ─── Entry Action ───────────────────────────────────────────────────

export interface EntryAction {
  id: string;
  entry_id: string;
  action_type: 'reviewed' | 'battlecard_updated' | 'shared' | 'dismissed' | 'noted';
  note: string | null;
  created_at: string;
}

// ─── Adapter Interfaces ─────────────────────────────────────────────

// What each source adapter returns after fetching
export interface FetchResult {
  raw_content: string;
  content_type: 'html' | 'xml' | 'json';
  http_status: number;
  response_time_ms: number;
  content_length: number;
}

// Parsed entry before storage (pre-ID, pre-dedup)
export interface RawParsedEntry {
  title: string;
  summary: string;
  content_url: string;
  published_at: string | null;
  raw_html_snippet: string; // For diffing (not for rendering!)
}

// Common interface all source adapters implement
export interface SourceAdapter {
  fetch(url: string, config: string, env: any): Promise<FetchResult>;
}
