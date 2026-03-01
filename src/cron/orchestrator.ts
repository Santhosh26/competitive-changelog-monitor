import { Env } from '../env';

/**
 * Cron job: Fetch all enabled sources, parse content, detect changes.
 * Runs every 6 hours (0 *​/6 * * *).
 *
 * Phase 2 will implement the full pipeline:
 *   1. Get enabled sources from D1
 *   2. Filter by check_interval and health status
 *   3. Fetch via the appropriate adapter (RSS, HTML, Browser)
 *   4. Parse, diff, dedup, tag
 *   5. Store entries in D1, snapshots in R2
 */
export async function orchestrateFetchJob(env: Env): Promise<void> {
  console.log('[cron:fetch] Fetch job triggered');
  // TODO: Phase 2 — implement full fetch pipeline
  console.log('[cron:fetch] Fetch job complete (stub)');
}

/**
 * Cron job: Generate and send the weekly competitive intelligence digest.
 * Runs every Monday at 8 AM UTC (0 8 * * 1).
 *
 * Phase 6 will implement:
 *   1. Query new entries since last digest
 *   2. Apply user rules (filter, highlight)
 *   3. Build formatted digest (grouped by relevance tier)
 *   4. Send via Telegram / Slack / email
 *   5. Log digest metadata to D1
 */
export async function orchestrateDigestJob(env: Env): Promise<void> {
  console.log('[cron:digest] Digest job triggered');
  // TODO: Phase 6 — implement digest generation + delivery
  console.log('[cron:digest] Digest job complete (stub)');
}
