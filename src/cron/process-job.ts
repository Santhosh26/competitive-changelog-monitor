/**
 * Processing job — transforms raw fetched content into structured entries.
 *
 * Pipeline:
 *   1. Parse raw content into RawParsedEntry[] (RSS/HTML/JSON)
 *   2. Detect content-level changes (SHA-256 snapshot)
 *   3. For each parsed entry:
 *      a. Sanitize title and summary
 *      b. Check if entry already exists (by source_id + content_url)
 *      c. Classify with AI (tags, relevance, AI summary) — falls back to keywords
 *      d. Apply heuristic relevance boosts
 *      e. Insert new entry or update existing
 *   4. Cross-source deduplication (within same competitor)
 */

import { Source, FetchResult } from '../types';
import { Env } from '../env';
import { parseContent } from '../processing/parser';
import { detectChanges } from '../processing/differ';
import { deduplicateWithinCompetitor } from '../processing/deduplicator';
import { classifyEntry, AiConfig } from '../processing/ai-classifier';
import { computeFinalRelevance } from '../delivery/relevance-scorer';
import { extractPlainText } from '../security/sanitizer';
import { EntriesRepo } from '../storage/entries-repo';

export interface ProcessOptions {
  aiConfig?: AiConfig;
  dedupThreshold?: number;
  dedupWindowHours?: number;
}

export interface ProcessResult {
  newEntries: number;
  updatedEntries: number;
  duplicates: number;
  totalParsed: number;
}

/**
 * Process raw content from a source adapter into structured entries.
 */
export async function processRawContent(
  source: Source,
  fetchResult: FetchResult,
  env: Env,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const entriesRepo = new EntriesRepo(env.DB);

  // 1. Parse raw content into structured entries
  const rawEntries = parseContent(
    fetchResult.raw_content,
    source.source_type,
    source.parser_config || '{}',
    source.source_url,
  );

  console.log(
    `[process] ${source.competitor_name}: parsed ${rawEntries.length} entries from ${source.source_type} content`,
  );

  if (rawEntries.length === 0) {
    return { newEntries: 0, updatedEntries: 0, duplicates: 0, totalParsed: 0 };
  }

  // 2. Detect content-level changes (snapshot + hash)
  const changes = await detectChanges(
    source.id,
    fetchResult.raw_content,
    env,
  );

  if (!changes.isNew && !changes.isChanged) {
    console.log(
      `[process] ${source.competitor_name}: content unchanged (hash match), skipping entry processing`,
    );
    return {
      newEntries: 0,
      updatedEntries: 0,
      duplicates: 0,
      totalParsed: rawEntries.length,
    };
  }

  console.log(
    `[process] ${source.competitor_name}: content ${changes.isNew ? 'is new (first snapshot)' : 'has changed'}`,
  );

  // 3. Process each parsed entry
  let newCount = 0;
  let updateCount = 0;

  for (const raw of rawEntries) {
    // a. Clean title and summary (sanitizer already ran in parser, but ensure plain text)
    const title = extractPlainText(raw.title).trim();
    const summary = extractPlainText(raw.summary).trim();

    if (!title) continue; // Skip entries without titles

    // b. Check for existing entry by source_id + content_url
    const existing = await entriesRepo.findExisting(
      source.id,
      raw.content_url,
    );

    // c. Classify with AI (falls back to keyword tagger if API unavailable)
    const classification = await classifyEntry(
      title,
      summary,
      source.competitor_name,
      options.aiConfig?.apiKey || '',
      env.KV,
      options.aiConfig,
    );

    // d. Apply heuristic relevance boosts
    const isUpdate = changes.isChanged && !changes.isNew;
    const finalRelevance = computeFinalRelevance(
      classification.relevance,
      { tags: classification.tags, is_update: isUpdate },
      source,
    );

    if (!existing) {
      // e. Insert new entry
      try {
        await entriesRepo.insert({
          id: crypto.randomUUID(),
          source_id: source.id,
          competitor_name: source.competitor_name,
          title,
          summary,
          content_url: raw.content_url,
          published_at: raw.published_at,
          tags: classification.tags,
          relevance_score: finalRelevance,
          is_update: isUpdate,
          ai_summary: classification.aiSummary || null,
        });
        newCount++;
      } catch (err: any) {
        // Handle UNIQUE constraint violation (race condition or duplicate URL)
        if (err.message?.includes('UNIQUE constraint')) {
          updateCount++;
        } else {
          console.error(
            `[process] Failed to insert entry "${title}":`,
            err.message,
          );
        }
      }
    } else {
      // f. Update existing entry's last_seen_at
      await entriesRepo.updateTimestamp(existing.id);
      updateCount++;
    }
  }

  // 4. Cross-source deduplication (within same competitor)
  const dupCount = await deduplicateWithinCompetitor(
    source.competitor_name,
    env.DB,
    {
      threshold: options.dedupThreshold,
      windowMs: options.dedupWindowHours ? options.dedupWindowHours * 3600 * 1000 : undefined,
    },
  );

  console.log(
    `[process] ${source.competitor_name}: ${newCount} new, ${updateCount} updated, ${dupCount} deduplicated`,
  );

  return {
    newEntries: newCount,
    updatedEntries: updateCount,
    duplicates: dupCount,
    totalParsed: rawEntries.length,
  };
}
