/**
 * Sources repository — D1 data access layer for the sources table.
 *
 * CRITICAL: Every query uses parameterized statements with .bind().
 * NEVER concatenate user input into SQL strings.
 */

import { Source } from '../types';

export class SourcesRepo {
  constructor(private db: D1Database) {}

  /**
   * Get all sources, optionally joined with their health status.
   */
  async list(): Promise<(Source & { health_status?: string })[]> {
    const result = await this.db
      .prepare(
        `SELECT s.*, sh.status as health_status, sh.consecutive_failures as health_failures,
                sh.last_error as health_last_error, sh.avg_response_ms as health_avg_response_ms,
                sh.total_entries_found as health_total_entries
         FROM sources s
         LEFT JOIN source_health sh ON s.id = sh.source_id
         ORDER BY s.competitor_name ASC, s.source_type ASC`,
      )
      .all();

    return (result.results || []) as unknown as (Source & {
      health_status?: string;
    })[];
  }

  /**
   * Get a single source by ID.
   */
  async getById(id: string): Promise<Source | null> {
    const row = await this.db
      .prepare('SELECT * FROM sources WHERE id = ?')
      .bind(id)
      .first();

    return (row as unknown as Source) || null;
  }

  /**
   * Create a new source.
   */
  async create(source: {
    id: string;
    competitor_name: string;
    source_url: string;
    source_type: Source['source_type'];
    parser_config: string;
    check_interval_hours: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sources (id, competitor_name, source_url, source_type, parser_config, check_interval_hours, enabled)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      )
      .bind(
        source.id,
        source.competitor_name,
        source.source_url,
        source.source_type,
        source.parser_config,
        source.check_interval_hours,
      )
      .run();
  }

  /**
   * Update an existing source.
   */
  async update(
    id: string,
    fields: {
      competitor_name?: string;
      source_url?: string;
      source_type?: Source['source_type'];
      parser_config?: string;
      check_interval_hours?: number;
      enabled?: boolean;
    },
  ): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    if (fields.competitor_name !== undefined) {
      sets.push('competitor_name = ?');
      params.push(fields.competitor_name);
    }
    if (fields.source_url !== undefined) {
      sets.push('source_url = ?');
      params.push(fields.source_url);
    }
    if (fields.source_type !== undefined) {
      sets.push('source_type = ?');
      params.push(fields.source_type);
    }
    if (fields.parser_config !== undefined) {
      sets.push('parser_config = ?');
      params.push(fields.parser_config);
    }
    if (fields.check_interval_hours !== undefined) {
      sets.push('check_interval_hours = ?');
      params.push(fields.check_interval_hours);
    }
    if (fields.enabled !== undefined) {
      sets.push('enabled = ?');
      params.push(fields.enabled ? 1 : 0);
    }

    if (sets.length === 0) return;

    params.push(id);
    await this.db
      .prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
  }

  /**
   * Delete a source by ID (also cascades to entries and health via app logic).
   */
  async delete(id: string): Promise<void> {
    // Delete related records first (D1 doesn't support ON DELETE CASCADE)
    await this.db
      .prepare('DELETE FROM source_health WHERE source_id = ?')
      .bind(id)
      .run();
    await this.db
      .prepare('DELETE FROM entries WHERE source_id = ?')
      .bind(id)
      .run();
    await this.db
      .prepare('DELETE FROM snapshots WHERE source_id = ?')
      .bind(id)
      .run();
    await this.db
      .prepare('DELETE FROM sources WHERE id = ?')
      .bind(id)
      .run();
  }
}
