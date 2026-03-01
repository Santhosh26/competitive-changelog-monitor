/**
 * Environment bindings for the Cloudflare Worker.
 *
 * D1  — relational database for sources, entries, snapshots metadata, etc.
 * KV  — config cache, rate-limit counters, Claude API usage tracking.
 * R2  — full-page HTML snapshots for content diffing.
 * BROWSER — Cloudflare Browser Rendering (headless Chromium at the edge).
 * Secrets — injected via `wrangler secret put`, never in code or wrangler.toml.
 */
export interface Env {
  // Cloudflare bindings
  DB: D1Database;
  KV: KVNamespace;
  SNAPSHOTS: R2Bucket;
  BROWSER: Fetcher; // Browser Rendering binding

  // Secrets (set via `wrangler secret put`)
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  ANTHROPIC_API_KEY: string;
}
