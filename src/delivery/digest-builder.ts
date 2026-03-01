/**
 * Digest builder — format entries into a readable, relevance-ranked digest.
 *
 * Design:
 * - Group by relevance tier: Critical (80+), Notable (50-79), Other (<50)
 * - Sort within tier by relevance (highest first), then by competitor name
 * - Include AI summary, tags, and source URL for each entry
 * - Show stats at bottom: entries reviewed, actions taken, next digest date
 */

import { Entry } from '../types';

interface DigestOptions {
  start: string; // ISO date
  end: string; // ISO date
}

interface FormattedDigest {
  text: string; // Plain text version
  markdown: string; // Markdown version (for Telegram)
}

/**
 * Build a formatted digest from entries.
 */
export function buildDigest(
  entries: Entry[],
  options: DigestOptions,
): FormattedDigest {
  // Group entries by relevance tier
  const critical = entries.filter((e) => e.relevance_score >= 80);
  const notable = entries.filter(
    (e) => e.relevance_score >= 50 && e.relevance_score < 80,
  );
  const other = entries.filter((e) => e.relevance_score < 50);

  // Sort each tier
  const sortTier = (tier: Entry[]) =>
    tier.sort(
      (a, b) =>
        b.relevance_score - a.relevance_score ||
        a.competitor_name.localeCompare(b.competitor_name),
    );

  const sortedCritical = sortTier(critical);
  const sortedNotable = sortTier(notable);
  const sortedOther = sortTier(other);

  // Build the digest text
  const lines: string[] = [];

  // Header
  lines.push('=====================================');
  lines.push('COMPETITIVE INTELLIGENCE DIGEST');
  const startDate = new Date(options.start).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const endDate = new Date(options.end).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  lines.push(`Week of ${startDate} - ${endDate}`);
  lines.push(
    `${entries.length} updates across ${new Set(entries.map((e) => e.competitor_name)).size} competitors`,
  );
  lines.push('=====================================');
  lines.push('');

  // Critical tier
  if (sortedCritical.length > 0) {
    lines.push('--- CRITICAL (relevance 80+) ---');
    lines.push('');
    for (const entry of sortedCritical) {
      lines.push(formatEntry(entry));
    }
    lines.push('');
  }

  // Notable tier
  if (sortedNotable.length > 0) {
    lines.push('--- NOTABLE (relevance 50-79) ---');
    lines.push('');
    for (const entry of sortedNotable) {
      lines.push(formatEntry(entry));
    }
    lines.push('');
  }

  // Other tier
  if (sortedOther.length > 0) {
    lines.push('--- OTHER (relevance < 50) ---');
    for (const entry of sortedOther) {
      const tagsStr = entry.tags.join(', ');
      lines.push(`• [${entry.competitor_name}] ${entry.title} (${tagsStr})`);
    }
    lines.push('');
  }

  // Footer stats
  const reviewedCount = entries.filter((e) => e.reviewed).length;
  const actionedCount = entries.filter((e) => e.actioned).length;
  const nextDigestDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(
    'en-US',
    { year: 'numeric', month: 'short', day: 'numeric' },
  );

  lines.push('=====================================');
  lines.push(
    `${reviewedCount} entries marked as reviewed | ${actionedCount} battlecards updated`,
  );
  lines.push(`Next digest: ${nextDigestDate}`);
  lines.push('=====================================');

  const text = lines.join('\n');
  const markdown = lines.join('\n');

  return { text, markdown };
}

/**
 * Format a single entry for the digest.
 */
function formatEntry(entry: Entry): string {
  const tagsStr = entry.tags.join(', ');
  const lines: string[] = [];

  lines.push(`${entry.competitor_name.toUpperCase()}`);
  lines.push(`[${tagsStr}] ${entry.title}`);

  if (entry.ai_summary) {
    lines.push(`  -> "${entry.ai_summary}"`);
  }

  lines.push(`Source: ${entry.content_url}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Split a message into chunks that fit within a character limit.
 * Used for Telegram's 4096 character limit.
 */
export function splitMessage(
  message: string,
  maxLength: number,
): string[] {
  if (message.length <= maxLength) {
    return [message];
  }

  const chunks: string[] = [];
  let current = '';

  // Split by paragraph (double newline)
  const paragraphs = message.split('\n\n');

  for (const para of paragraphs) {
    if ((current + para + '\n\n').length <= maxLength) {
      current += para + '\n\n';
    } else {
      if (current) {
        chunks.push(current.trim());
      }
      current = para + '\n\n';
    }
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks;
}
