/**
 * Cron fetch job — fetches all enabled sources using the appropriate adapter.
 *
 * Pipeline:
 *   1. Get all enabled sources from D1
 *   2. Filter out sources that are 'disabled' in source_health
 *   3. Filter out sources checked within their check_interval_hours
 *   4. For each source:
 *      a. Validate the URL (SSRF check — always, even if previously valid)
 *      b. Get the correct adapter from adapter-factory
 *      c. Fetch content
 *      d. Update source_health (success or failure)
 *      e. Store raw content for later processing (Phase 3)
 *   5. Log summary: X sources checked, Y succeeded, Z failed
 */

import { Env } from '../env';
import { Source } from '../types';
import { getAdapter } from '../ingestion/adapter-factory';
import { HealthRepo } from '../storage/health-repo';
import { validateUrl } from '../security/url-validator';
import { processRawContent } from './process-job';

interface FetchJobResult {
  total: number;
  checked: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

/**
 * Fetch all eligible sources. Called by the cron orchestrator.
 */
export async function fetchAllSources(env: Env): Promise<FetchJobResult> {
  const healthRepo = new HealthRepo(env.DB);

  // 1. Get all enabled sources
  const sourcesResult = await env.DB
    .prepare('SELECT * FROM sources WHERE enabled = 1')
    .all();

  const sources = (sourcesResult.results || []) as unknown as Source[];
  const result: FetchJobResult = {
    total: sources.length,
    checked: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  if (sources.length === 0) {
    console.log('[fetch-job] No enabled sources found');
    return result;
  }

  // 2. Filter out sources checked recently (within check_interval_hours)
  const eligibleSources = sources.filter((source) => {
    if (!source.last_checked_at) return true; // Never checked → eligible

    const lastChecked = new Date(source.last_checked_at).getTime();
    const intervalMs = (source.check_interval_hours || 6) * 3600 * 1000;
    const now = Date.now();

    if (now - lastChecked < intervalMs) {
      console.log(
        `[fetch-job] Skipping ${source.competitor_name} (${source.source_type}) — checked ${Math.round((now - lastChecked) / 60000)}m ago, interval is ${source.check_interval_hours}h`,
      );
      result.skipped++;
      return false;
    }

    return true;
  });

  // 3. Filter out disabled sources (by health status)
  const healthyEligible: Source[] = [];
  for (const source of eligibleSources) {
    const health = await healthRepo.getHealth(source.id);
    if (health?.status === 'disabled') {
      console.log(
        `[fetch-job] Skipping ${source.competitor_name} (${source.source_type}) — disabled due to ${health.consecutive_failures} consecutive failures`,
      );
      result.skipped++;
      continue;
    }
    healthyEligible.push(source);
  }

  console.log(
    `[fetch-job] Fetching ${healthyEligible.length} sources (${result.skipped} skipped)`,
  );

  // 4. Fetch each source
  for (const source of healthyEligible) {
    result.checked++;

    try {
      // a. Validate URL (always re-validate — URLs can be modified)
      const urlCheck = validateUrl(source.source_url);
      if (!urlCheck.valid) {
        console.error(
          `[fetch-job] SSRF blocked for ${source.competitor_name}: ${urlCheck.reason}`,
        );
        await healthRepo.recordFailure(
          source.id,
          null,
          `SSRF validation failed: ${urlCheck.reason}`,
        );
        result.failed++;
        continue;
      }

      // b. Get the adapter
      const adapter = getAdapter(source.source_type);

      // c. Fetch content
      console.log(
        `[fetch-job] Fetching ${source.competitor_name} via ${source.source_type}: ${source.source_url}`,
      );
      const fetchResult = await adapter.fetch(
        source.source_url,
        source.parser_config || '{}',
        env,
      );

      console.log(
        `[fetch-job] ✓ ${source.competitor_name} — ${fetchResult.content_length} bytes in ${fetchResult.response_time_ms}ms`,
      );

      // d. Process content: parse → diff → dedup → tag → store
      const processResult = await processRawContent(source, fetchResult, env);

      // e. Record success with entry count
      await healthRepo.recordSuccess(
        source.id,
        fetchResult.http_status,
        fetchResult.response_time_ms,
        processResult.newEntries,
      );

      result.succeeded++;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      console.error(
        `[fetch-job] ✗ ${source.competitor_name} — ${message}`,
      );

      await healthRepo.recordFailure(source.id, null, message);
      result.failed++;
    }
  }

  // 5. Log summary
  console.log(
    `[fetch-job] Done: ${result.checked} checked, ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped`,
  );

  return result;
}
