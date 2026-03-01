/**
 * Digests repository — D1 data access layer for the digests table.
 *
 * Stores metadata about each digest generation: when it was created, how many
 * entries, delivery status, etc.
 */

import { Digest } from '../types';

export class DigestsRepo {
  constructor(private db: D1Database) {}

  /**
   * Save a new digest record to D1.
   */
  async save(digest: {
    id: string;
    digest_type: 'scheduled' | 'on_demand';
    period_start: string;
    period_end: string;
    entry_count: number;
    competitor_count: number;
    content: string | null;
    sent_via?: string; // 'telegram', 'slack', 'email' (comma-separated if multiple)
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO digests (id, digest_type, period_start, period_end, entry_count, competitor_count, content, sent_via)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        digest.id,
        digest.digest_type,
        digest.period_start,
        digest.period_end,
        digest.entry_count,
        digest.competitor_count,
        digest.content,
        digest.sent_via || null,
      )
      .run();
  }

  /**
   * Mark a digest as sent.
   */
  async markSent(
    digestId: string,
    channels: string[], // ['telegram', 'slack', etc]
  ): Promise<void> {
    const sentVia = channels.join(',');
    const now = new Date().toISOString();

    await this.db
      .prepare('UPDATE digests SET sent_via = ?, sent_at = ? WHERE id = ?')
      .bind(sentVia, now, digestId)
      .run();
  }

  /**
   * Get all digests, optionally filtered by type.
   */
  async list(options?: { type?: 'scheduled' | 'on_demand'; limit?: number }): Promise<Digest[]> {
    const limit = options?.limit ?? 50;
    const type = options?.type;

    let query = 'SELECT * FROM digests';
    const params: any[] = [];

    if (type) {
      query += ' WHERE digest_type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const result = await this.db.prepare(query).bind(...params).all();

    return (result.results || []) as unknown as Digest[];
  }

  /**
   * Get the last digest (for checking when the last one was sent).
   */
  async getLastDigest(): Promise<Digest | null> {
    const row = await this.db
      .prepare('SELECT * FROM digests WHERE digest_type = ? ORDER BY created_at DESC LIMIT 1')
      .bind('scheduled')
      .first();

    return (row as unknown as Digest) || null;
  }
}
