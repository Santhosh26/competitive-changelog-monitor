/**
 * Cross-source deduplicator — groups related entries into clusters.
 *
 * If Akamai announces a new feature, it might appear on their blog, changelog,
 * RSS feed, and Twitter — all within the same day. Without deduplication, your
 * digest shows the same announcement 4 times.
 *
 * Strategy:
 *   1. Exact URL match — same content_url = same entry (trivial dedup)
 *   2. Fuzzy title match — Jaccard similarity > 0.8 AND same competitor
 *      AND published within 48 hours → likely duplicate
 *   3. Assign cluster_id to group duplicates together
 *
 * WHY JACCARD SIMILARITY INSTEAD OF LEVENSHTEIN?
 * For titles, word overlap is more meaningful than character-level edit distance.
 * "Akamai Launches New API Security Feature" and "New API Security Feature from
 * Akamai" have high Jaccard similarity (same words, different order) but moderate
 * Levenshtein distance. Jaccard catches these reorderings better.
 */

import { Entry } from '../types';

const SIMILARITY_THRESHOLD = 0.8;
const TIME_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Normalize a title for comparison: lowercase, strip punctuation, collapse whitespace.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim();
}

/**
 * Compute Jaccard similarity between two titles.
 * Jaccard = |intersection(words)| / |union(words)|
 *
 * Returns a value between 0 (no overlap) and 1 (identical word sets).
 */
export function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const wordsB = new Set(normalizeTitle(b).split(' ').filter(Boolean));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersectionSize = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersectionSize++;
  }

  const unionSize = new Set([...wordsA, ...wordsB]).size;
  return intersectionSize / unionSize;
}

/**
 * Check if two entries are within the time window for deduplication.
 */
function withinTimeWindow(
  dateA: string | null,
  dateB: string | null,
): boolean {
  if (!dateA || !dateB) return true; // If dates are missing, assume they could be duplicates
  const timeA = new Date(dateA).getTime();
  const timeB = new Date(dateB).getTime();
  if (isNaN(timeA) || isNaN(timeB)) return true;
  return Math.abs(timeA - timeB) <= TIME_WINDOW_MS;
}

/**
 * Deduplicate entries within a competitor — find clusters of related entries.
 *
 * Operates on existing entries in D1. For each pair of entries from the same
 * competitor that match our similarity criteria, assigns them the same cluster_id.
 */
export async function deduplicateWithinCompetitor(
  competitorName: string,
  db: D1Database,
): Promise<number> {
  // Get recent entries for this competitor (last 7 days, no cluster yet or with cluster)
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result = await db
    .prepare(
      'SELECT id, title, content_url, published_at, first_seen_at, cluster_id FROM entries WHERE competitor_name = ? AND first_seen_at > ? ORDER BY first_seen_at DESC',
    )
    .bind(competitorName, sevenDaysAgo)
    .all<{
      id: string;
      title: string;
      content_url: string;
      published_at: string | null;
      first_seen_at: string;
      cluster_id: string | null;
    }>();

  const entries = result.results || [];
  if (entries.length < 2) return 0;

  let clustersFormed = 0;

  // Compare each pair
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];

      // Skip if already in the same cluster
      if (a.cluster_id && a.cluster_id === b.cluster_id) continue;

      // Check for duplicate
      const isDuplicate =
        // Exact URL match
        a.content_url === b.content_url ||
        // Fuzzy title match + time window
        (titleSimilarity(a.title, b.title) >= SIMILARITY_THRESHOLD &&
          withinTimeWindow(
            a.published_at || a.first_seen_at,
            b.published_at || b.first_seen_at,
          ));

      if (isDuplicate) {
        // Assign cluster_id — use the existing one or create a new one
        const clusterId =
          a.cluster_id || b.cluster_id || crypto.randomUUID();

        if (!a.cluster_id) {
          await db
            .prepare('UPDATE entries SET cluster_id = ? WHERE id = ?')
            .bind(clusterId, a.id)
            .run();
          a.cluster_id = clusterId;
        }
        if (!b.cluster_id || b.cluster_id !== clusterId) {
          await db
            .prepare('UPDATE entries SET cluster_id = ? WHERE id = ?')
            .bind(clusterId, b.id)
            .run();
          b.cluster_id = clusterId;
        }

        clustersFormed++;
      }
    }
  }

  if (clustersFormed > 0) {
    console.log(
      `[dedup] ${competitorName}: formed ${clustersFormed} duplicate cluster(s)`,
    );
  }

  return clustersFormed;
}
