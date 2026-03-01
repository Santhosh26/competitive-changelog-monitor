/**
 * Source health repository — tracks the reliability of each source.
 *
 * Health states:
 *   healthy  — last fetch succeeded, no issues
 *   degraded — 1-4 consecutive failures (still fetching, but watch it)
 *   failing  — 5-9 consecutive failures (likely broken, needs attention)
 *   disabled — 10+ consecutive failures (auto-disabled, won't be fetched)
 *
 * This prevents a broken source from slowing down or crashing every cron run.
 * The health dashboard (Phase 7) shows green/yellow/red per source.
 */

import { SourceHealth } from '../types';

const DEGRADED_THRESHOLD = 1;
const FAILING_THRESHOLD = 5;
const DISABLED_THRESHOLD = 10;

export interface HealthThresholds {
  degradedAfter?: number;
  failingAfter?: number;
  disabledAfter?: number;
}

export class HealthRepo {
  private degradedAfter: number;
  private failingAfter: number;
  private disabledAfter: number;

  constructor(private db: D1Database, thresholds?: HealthThresholds) {
    this.degradedAfter = thresholds?.degradedAfter ?? DEGRADED_THRESHOLD;
    this.failingAfter = thresholds?.failingAfter ?? FAILING_THRESHOLD;
    this.disabledAfter = thresholds?.disabledAfter ?? DISABLED_THRESHOLD;
  }

  /**
   * Get health status for a source. Returns null if no health record exists yet.
   */
  async getHealth(sourceId: string): Promise<SourceHealth | null> {
    const row = await this.db
      .prepare('SELECT * FROM source_health WHERE source_id = ?')
      .bind(sourceId)
      .first();

    if (!row) return null;
    return row as unknown as SourceHealth;
  }

  /**
   * Get health status for all sources (for dashboard).
   */
  async getAllHealth(): Promise<SourceHealth[]> {
    const result = await this.db
      .prepare('SELECT * FROM source_health')
      .all();

    return (result.results || []) as unknown as SourceHealth[];
  }

  /**
   * Record a successful fetch. Resets failure count, updates status to healthy.
   */
  async recordSuccess(
    sourceId: string,
    httpStatus: number,
    responseTimeMs: number,
    entriesFound: number,
  ): Promise<void> {
    const now = new Date().toISOString();

    // Upsert: insert or update health record
    await this.db
      .prepare(
        `INSERT INTO source_health (source_id, status, last_http_status, last_error, last_check_at, avg_response_ms, consecutive_failures, total_entries_found)
         VALUES (?, 'healthy', ?, NULL, ?, ?, 0, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           status = 'healthy',
           last_http_status = excluded.last_http_status,
           last_error = NULL,
           last_check_at = excluded.last_check_at,
           avg_response_ms = (source_health.avg_response_ms + excluded.avg_response_ms) / 2,
           consecutive_failures = 0,
           total_entries_found = source_health.total_entries_found + excluded.total_entries_found`,
      )
      .bind(sourceId, httpStatus, now, responseTimeMs, entriesFound)
      .run();

    // Also update the source's last_checked_at and last_success_at
    await this.db
      .prepare(
        `UPDATE sources SET last_checked_at = ?, last_success_at = ?, consecutive_failures = 0 WHERE id = ?`,
      )
      .bind(now, now, sourceId)
      .run();
  }

  /**
   * Record a failed fetch. Increments failure count, updates status based on thresholds.
   */
  async recordFailure(
    sourceId: string,
    httpStatus: number | null,
    errorMessage: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    // Get current failure count to determine new status
    const current = await this.getHealth(sourceId);
    const newFailures = (current?.consecutive_failures ?? 0) + 1;
    const newStatus = computeStatus(newFailures, this.degradedAfter, this.failingAfter, this.disabledAfter);

    // Upsert: insert or update health record
    await this.db
      .prepare(
        `INSERT INTO source_health (source_id, status, last_http_status, last_error, last_check_at, avg_response_ms, consecutive_failures, total_entries_found)
         VALUES (?, ?, ?, ?, ?, 0, 1, 0)
         ON CONFLICT(source_id) DO UPDATE SET
           status = ?,
           last_http_status = ?,
           last_error = ?,
           last_check_at = ?,
           consecutive_failures = source_health.consecutive_failures + 1`,
      )
      .bind(
        sourceId,
        newStatus,
        httpStatus,
        errorMessage,
        now,
        newStatus,
        httpStatus,
        errorMessage,
        now,
      )
      .run();

    // Update the source's last_checked_at and consecutive_failures
    await this.db
      .prepare(
        `UPDATE sources SET last_checked_at = ?, consecutive_failures = ? WHERE id = ?`,
      )
      .bind(now, newFailures, sourceId)
      .run();

    // If disabled, also disable the source
    if (newStatus === 'disabled') {
      await this.db
        .prepare('UPDATE sources SET enabled = 0 WHERE id = ?')
        .bind(sourceId)
        .run();
      console.warn(
        `[health] Source ${sourceId} auto-disabled after ${newFailures} consecutive failures`,
      );
    }
  }

  /**
   * Reset a disabled source back to healthy (manual recovery via API).
   */
  async resetHealth(sourceId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE source_health SET status = 'healthy', consecutive_failures = 0, last_error = NULL, last_check_at = ? WHERE source_id = ?`,
      )
      .bind(now, sourceId)
      .run();

    await this.db
      .prepare(
        'UPDATE sources SET enabled = 1, consecutive_failures = 0 WHERE id = ?',
      )
      .bind(sourceId)
      .run();
  }
}

/**
 * Compute health status based on consecutive failure count.
 */
function computeStatus(
  failures: number,
  degraded: number = DEGRADED_THRESHOLD,
  failing: number = FAILING_THRESHOLD,
  disabled: number = DISABLED_THRESHOLD,
): SourceHealth['status'] {
  if (failures >= disabled) return 'disabled';
  if (failures >= failing) return 'failing';
  if (failures >= degraded) return 'degraded';
  return 'healthy';
}
