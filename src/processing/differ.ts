/**
 * Content differ — detects whether a source's content has changed.
 *
 * Strategy:
 *   1. Normalize content (strip dynamic elements, whitespace, lowercase)
 *   2. Compute SHA-256 hash of the normalized content
 *   3. Compare to the most recent snapshot hash in D1
 *   4. If different → store new snapshot (full HTML in R2, hash in D1)
 *
 * WHY R2 FOR SNAPSHOTS?
 * Full HTML pages can be 100KB-1MB each. Storing them in D1 (which has
 * row size limits) isn't practical. R2 is designed for object storage —
 * unlimited size, no egress fees. We store the hash in D1 (for fast
 * comparison) and the full content in R2 (for detailed diffing when needed).
 */

import { createHash } from 'node:crypto';
import { Env } from '../env';

export interface ChangeResult {
  isNew: boolean;
  isChanged: boolean;
  previousHash?: string;
  newHash: string;
}

/**
 * Hash content using SHA-256 after normalization.
 *
 * Normalization strips dynamic elements that change on every page load
 * (timestamps, ads, CSRF tokens) so we only detect meaningful changes.
 */
export function hashContent(content: string): string {
  const normalized = normalizeForDiff(content);
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Normalize content for hashing — strip dynamic elements that would
 * cause false-positive "change" detections.
 */
function normalizeForDiff(content: string): string {
  let result = content;

  // Remove HTML comments (often contain build hashes, timestamps)
  result = result.replace(/<!--[\s\S]*?-->/g, '');

  // Remove script tags and their content (inline JS changes frequently)
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  // Remove style tags (can contain dynamic class names)
  result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove nonce attributes (CSRF tokens)
  result = result.replace(/\s+nonce="[^"]*"/gi, '');

  // Remove data-reactid and similar framework attributes
  result = result.replace(/\s+data-[\w-]+="[^"]*"/gi, '');

  // Normalize whitespace
  result = result.replace(/\s+/g, ' ');

  // Lowercase for case-insensitive comparison
  result = result.toLowerCase().trim();

  return result;
}

/**
 * Detect whether content has changed since the last snapshot.
 *
 * Returns:
 *   - isNew: true if this is the first time we've seen this source
 *   - isChanged: true if content differs from the last snapshot
 *   - previousHash: the hash of the last snapshot (if one exists)
 *   - newHash: the hash of the current content
 */
export async function detectChanges(
  sourceId: string,
  newContent: string,
  env: Env,
): Promise<ChangeResult> {
  const newHash = hashContent(newContent);

  // Get the most recent snapshot for this source
  const lastSnapshot = await env.DB.prepare(
    'SELECT content_hash FROM snapshots WHERE source_id = ? ORDER BY captured_at DESC LIMIT 1',
  )
    .bind(sourceId)
    .first<{ content_hash: string }>();

  if (!lastSnapshot) {
    // First time seeing this source — store snapshot
    await storeSnapshot(sourceId, newContent, newHash, env);
    return { isNew: true, isChanged: false, newHash };
  }

  if (lastSnapshot.content_hash === newHash) {
    // Content hasn't changed
    return {
      isNew: false,
      isChanged: false,
      previousHash: lastSnapshot.content_hash,
      newHash,
    };
  }

  // Content changed — store new snapshot
  await storeSnapshot(sourceId, newContent, newHash, env);
  return {
    isNew: false,
    isChanged: true,
    previousHash: lastSnapshot.content_hash,
    newHash,
  };
}

/**
 * Store a full content snapshot: HTML in R2, metadata in D1.
 */
async function storeSnapshot(
  sourceId: string,
  content: string,
  hash: string,
  env: Env,
): Promise<void> {
  const r2Key = `snapshots/${sourceId}/${Date.now()}.html`;

  // Store full HTML in R2 (for future detailed diffing)
  await env.SNAPSHOTS.put(r2Key, content);

  // Store metadata in D1 (hash for fast comparison)
  await env.DB.prepare(
    'INSERT INTO snapshots (id, source_id, content_hash, r2_key, content_length) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), sourceId, hash, r2Key, content.length)
    .run();
}
