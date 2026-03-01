/**
 * Final relevance scorer — combines AI relevance with heuristic boosts.
 *
 * The AI gives us a base score (0-100), but we apply small adjustments
 * based on structural signals that the AI might not weigh correctly:
 *   - Pricing tag → always matters, slight boost
 *   - Content changes (is_update) → more interesting than first-time posts
 *   - Unreliable source → slight penalty (data may be stale or wrong)
 */

import { Entry, Source } from '../types';

/**
 * Compute the final relevance score by combining AI score with heuristic boosts.
 *
 * @param aiScore - The raw relevance score from the AI classifier (or keyword scorer)
 * @param entry - The entry being scored (needs tags, is_update)
 * @param source - The source this entry came from (needs consecutive_failures)
 */
export function computeFinalRelevance(
  aiScore: number,
  entry: Partial<Entry>,
  source: Partial<Source>,
): number {
  let score = aiScore;

  // Pricing always matters — slight boost if AI underweighted it
  if (entry.tags?.includes('Pricing')) score += 10;

  // Content changes (updates to existing pages) are interesting
  if (entry.is_update) score += 5;

  // Unreliable sources get a penalty — their data may be stale
  if ((source.consecutive_failures ?? 0) > 3) score -= 10;

  return Math.max(0, Math.min(100, score));
}
