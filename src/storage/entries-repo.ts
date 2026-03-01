/**
 * Entries repository — D1 data access layer for the entries table.
 *
 * CRITICAL: Every query uses parameterized statements with .bind().
 * NEVER concatenate user input into SQL strings.
 */

import { Entry } from '../types';

export class EntriesRepo {
  constructor(private db: D1Database) {}

  /**
   * Find an existing entry by source_id and content_url.
   * Used to detect whether an entry is new or already stored.
   */
  async findExisting(
    sourceId: string,
    contentUrl: string,
  ): Promise<{ id: string; title: string } | null> {
    const row = await this.db
      .prepare(
        'SELECT id, title FROM entries WHERE source_id = ? AND content_url = ?',
      )
      .bind(sourceId, contentUrl)
      .first<{ id: string; title: string }>();

    return row || null;
  }

  /**
   * Insert a new entry into D1.
   */
  async insert(entry: {
    id: string;
    source_id: string;
    competitor_name: string;
    title: string;
    summary: string;
    content_url: string;
    published_at: string | null;
    tags: string[];
    relevance_score: number;
    is_update: boolean;
    ai_summary?: string | null;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO entries (id, source_id, competitor_name, title, summary, content_url, published_at, tags, relevance_score, is_update, ai_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.id,
        entry.source_id,
        entry.competitor_name,
        entry.title,
        entry.summary,
        entry.content_url,
        entry.published_at,
        JSON.stringify(entry.tags),
        entry.relevance_score,
        entry.is_update ? 1 : 0,
        entry.ai_summary || null,
      )
      .run();
  }

  /**
   * Update an entry's classification (tags, relevance, AI summary).
   * Used by the backfill job to upgrade existing entries from keyword to AI tags.
   */
  async updateClassification(
    entryId: string,
    tags: string[],
    relevanceScore: number,
    aiSummary: string | null,
  ): Promise<void> {
    await this.db
      .prepare(
        'UPDATE entries SET tags = ?, relevance_score = ?, ai_summary = ? WHERE id = ?',
      )
      .bind(JSON.stringify(tags), relevanceScore, aiSummary, entryId)
      .run();
  }

  /**
   * Update the last_seen_at timestamp for an existing entry.
   * Called when we see the same entry again on a subsequent fetch.
   */
  async updateTimestamp(entryId: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE entries SET last_seen_at = datetime('now') WHERE id = ?",
      )
      .bind(entryId)
      .run();
  }

  /**
   * Get entries with flexible filtering.
   */
  async query(filters: {
    competitor?: string;
    tag?: string;
    since?: string;
    reviewed?: boolean;
    minRelevance?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ data: Entry[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.competitor) {
      conditions.push('competitor_name = ?');
      params.push(filters.competitor);
    }
    if (filters.tag) {
      conditions.push('tags LIKE ?');
      params.push(`%"${filters.tag}"%`);
    }
    if (filters.since) {
      conditions.push('first_seen_at > ?');
      params.push(filters.since);
    }
    if (filters.reviewed !== undefined) {
      conditions.push('reviewed = ?');
      params.push(filters.reviewed ? 1 : 0);
    }
    if (filters.minRelevance !== undefined) {
      conditions.push('relevance_score >= ?');
      params.push(filters.minRelevance);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM entries ${where}`;
    const countStmt = this.db.prepare(countQuery);
    const countResult = await (params.length > 0
      ? countStmt.bind(...params)
      : countStmt
    ).first<{ total: number }>();
    const total = countResult?.total || 0;

    // Fetch page
    const dataQuery = `SELECT * FROM entries ${where} ORDER BY first_seen_at DESC LIMIT ? OFFSET ?`;
    const dataStmt = this.db.prepare(dataQuery);
    const dataResult = await dataStmt
      .bind(...params, limit, offset)
      .all();

    const data = ((dataResult.results || []) as unknown as any[]).map(
      rowToEntry,
    );

    return { data, total };
  }

  /**
   * Get new entries since a given date (for digest generation).
   */
  async getNewSince(since: string): Promise<Entry[]> {
    const result = await this.db
      .prepare(
        'SELECT * FROM entries WHERE first_seen_at > ? ORDER BY relevance_score DESC, first_seen_at DESC',
      )
      .bind(since)
      .all();

    return ((result.results || []) as unknown as any[]).map(rowToEntry);
  }

  /**
   * Get a single entry by ID.
   */
  async getById(id: string): Promise<Entry | null> {
    const row = await this.db
      .prepare('SELECT * FROM entries WHERE id = ?')
      .bind(id)
      .first();

    if (!row) return null;
    return rowToEntry(row);
  }

  /**
   * Search entries by keyword across title and summary.
   * Uses LIKE with parameterized binding — safe from SQL injection.
   */
  async search(
    keyword: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ data: Entry[]; total: number }> {
    const pattern = `%${keyword}%`;

    const countResult = await this.db
      .prepare(
        'SELECT COUNT(*) as total FROM entries WHERE title LIKE ? OR summary LIKE ?',
      )
      .bind(pattern, pattern)
      .first<{ total: number }>();
    const total = countResult?.total || 0;

    const dataResult = await this.db
      .prepare(
        'SELECT * FROM entries WHERE title LIKE ? OR summary LIKE ? ORDER BY relevance_score DESC, first_seen_at DESC LIMIT ? OFFSET ?',
      )
      .bind(pattern, pattern, limit, offset)
      .all();

    const data = ((dataResult.results || []) as unknown as any[]).map(
      rowToEntry,
    );

    return { data, total };
  }

  /**
   * Mark an entry as reviewed.
   */
  async markReviewed(entryId: string, reviewed: boolean): Promise<void> {
    await this.db
      .prepare('UPDATE entries SET reviewed = ? WHERE id = ?')
      .bind(reviewed ? 1 : 0, entryId)
      .run();
  }

  /**
   * Mark an entry as actioned.
   */
  async markActioned(entryId: string, actioned: boolean): Promise<void> {
    await this.db
      .prepare('UPDATE entries SET actioned = ? WHERE id = ?')
      .bind(actioned ? 1 : 0, entryId)
      .run();
  }

  /**
   * Get entry count per competitor (for health tracking).
   */
  async countBySource(sourceId: string): Promise<number> {
    const result = await this.db
      .prepare('SELECT COUNT(*) as count FROM entries WHERE source_id = ?')
      .bind(sourceId)
      .first<{ count: number }>();
    return result?.count || 0;
  }
}

/**
 * Convert a D1 row to an Entry object (handle JSON fields and booleans).
 */
function rowToEntry(row: any): Entry {
  return {
    ...row,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [],
    enabled: Boolean(row.enabled),
    is_update: Boolean(row.is_update),
    reviewed: Boolean(row.reviewed),
    actioned: Boolean(row.actioned),
  };
}
