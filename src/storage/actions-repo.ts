/**
 * Entry actions repository — D1 data access layer for the entry_actions table.
 *
 * Tracks intelligence actions taken on entries (reviewed, battlecard_updated,
 * shared, dismissed, noted).
 *
 * CRITICAL: Every query uses parameterized statements with .bind().
 * NEVER concatenate user input into SQL strings.
 */

import { EntryAction } from '../types';

export class ActionsRepo {
  constructor(private db: D1Database) {}

  /**
   * Log a new action on an entry.
   */
  async logAction(action: {
    id: string;
    entry_id: string;
    action_type: EntryAction['action_type'];
    note: string | null;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO entry_actions (id, entry_id, action_type, note)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(action.id, action.entry_id, action.action_type, action.note)
      .run();

    // Also update the entry's reviewed/actioned flags
    if (action.action_type === 'reviewed') {
      await this.db
        .prepare('UPDATE entries SET reviewed = 1 WHERE id = ?')
        .bind(action.entry_id)
        .run();
    } else if (
      action.action_type === 'battlecard_updated' ||
      action.action_type === 'shared'
    ) {
      await this.db
        .prepare('UPDATE entries SET reviewed = 1, actioned = 1 WHERE id = ?')
        .bind(action.entry_id)
        .run();
    }
  }

  /**
   * Get action history for an entry.
   */
  async getByEntryId(entryId: string): Promise<EntryAction[]> {
    const result = await this.db
      .prepare(
        'SELECT * FROM entry_actions WHERE entry_id = ? ORDER BY created_at DESC',
      )
      .bind(entryId)
      .all();

    return (result.results || []) as unknown as EntryAction[];
  }
}
