import { Env } from '../env';
import { fetchAllSources } from './fetch-job';
import { generateAndSendDigest } from './digest-job';

/**
 * Cron job: Fetch all enabled sources, parse content, detect changes.
 * Runs every 6 hours (0 *​/6 * * *).
 *
 * Pipeline:
 *   1. Get enabled sources from D1
 *   2. Filter by check_interval and health status
 *   3. Fetch via the appropriate adapter (RSS, HTML, Browser)
 *   4. Store raw content in R2 for processing
 *   5. (Phase 3) Parse, diff, dedup, tag
 */
export async function orchestrateFetchJob(env: Env) {
  console.log('[cron:fetch] Fetch job triggered');
  try {
    const result = await fetchAllSources(env);
    console.log(
      `[cron:fetch] Complete — ${result.succeeded}/${result.total} sources fetched successfully`,
    );
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[cron:fetch] Fatal error: ${message}`);
    return { total: 0, checked: 0, succeeded: 0, failed: 0, skipped: 0, error: message };
  }
}

/**
 * Cron job: Generate and send the weekly competitive intelligence digest.
 * Runs every Monday at 8 AM UTC (0 8 * * 1).
 *
 * Pipeline:
 *   1. Query new entries since last digest (last 7 days)
 *   2. Apply user rules (filter, highlight)
 *   3. Build formatted digest (grouped by relevance tier)
 *   4. Send via Telegram / Slack
 *   5. Log digest metadata to D1
 */
export async function orchestrateDigestJob(env: Env): Promise<void> {
  console.log('[cron:digest] Digest job triggered');
  try {
    const result = await generateAndSendDigest(env, {
      daysBack: 7,
      sendTelegram: true,
      sendSlack: false,
    });
    console.log(
      `[cron:digest] Complete — digest ${result.digestId} with ${result.entriesCount} entries, sent=${result.sent}`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[cron:digest] Fatal error: ${message}`);
  }
}
