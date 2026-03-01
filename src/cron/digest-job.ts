/**
 * Digest job — generate and send the weekly digest.
 *
 * Runs on schedule (Monday 8 AM UTC) or on-demand via API.
 * Pulls entries from the last 7 days, applies rules, builds digest, and sends.
 */

import { Env } from '../env';
import { EntriesRepo } from '../storage/entries-repo';
import { DigestsRepo } from '../storage/digests-repo';
import { applyRules } from '../delivery/rules-engine';
import { buildDigest } from '../delivery/digest-builder';
import { sendTelegram, sendSlack } from '../delivery/notifier';

export interface DigestJobOptions {
  daysBack?: number; // Default: 7 (last week)
  sendTelegram?: boolean; // Default: true
  sendSlack?: boolean; // Default: false
  tierCritical?: number; // Default: 80
  tierNotable?: number; // Default: 50
  telegramBotToken?: string; // Override env
  telegramChatId?: string; // Override env
  slackWebhookUrl?: string; // Override env
}

/**
 * Generate and send a digest.
 */
export async function generateAndSendDigest(
  env: Env,
  options: DigestJobOptions = {},
): Promise<{ digestId: string; entriesCount: number; sent: boolean }> {
  const daysBack = options.daysBack ?? 7;
  const shouldSendTelegram = options.sendTelegram ?? true;
  const shouldSendSlack = options.sendSlack ?? false;
  const tierCritical = options.tierCritical ?? 80;
  const tierNotable = options.tierNotable ?? 50;

  const entriesRepo = new EntriesRepo(env.DB);
  const digestsRepo = new DigestsRepo(env.DB);

  // 1. Calculate date range
  const now = new Date();
  const endDate = now.toISOString();
  const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  console.log(`[digest-job] Generating digest for ${daysBack} days (${startDate.slice(0, 10)} to ${endDate.slice(0, 10)})`);

  // 2. Get entries since start date
  const entries = await entriesRepo.getNewSince(startDate);

  console.log(`[digest-job] Found ${entries.length} entries`);

  if (entries.length === 0) {
    console.log('[digest-job] No entries found, skipping digest');

    // Still log an empty digest
    const digestId = crypto.randomUUID();
    await digestsRepo.save({
      id: digestId,
      digest_type: 'scheduled',
      period_start: startDate,
      period_end: endDate,
      entry_count: 0,
      competitor_count: 0,
      content: null,
    });

    return { digestId, entriesCount: 0, sent: false };
  }

  // 3. Apply user rules (filter, highlight)
  const rules = await env.DB
    .prepare('SELECT * FROM rules WHERE enabled = 1')
    .all();

  const filtered = await applyRules(entries, (rules.results || []) as any);

  console.log(`[digest-job] After rules: ${filtered.length} entries (${entries.length - filtered.length} filtered out)`);

  // 4. Build the digest (pass configurable thresholds)
  const digest = buildDigest(filtered, {
    start: startDate,
    end: endDate,
    tierCritical,
    tierNotable,
  });

  // 5. Save digest record
  const digestId = crypto.randomUUID();
  const competitorCount = new Set(filtered.map((e) => e.competitor_name)).size;

  await digestsRepo.save({
    id: digestId,
    digest_type: 'scheduled',
    period_start: startDate,
    period_end: endDate,
    entry_count: filtered.length,
    competitor_count: competitorCount,
    content: digest.markdown,
  });

  console.log(`[digest-job] Saved digest ${digestId}`);

  // 6. Send via configured channels
  const channels: string[] = [];
  let success = true;

  // Resolve Telegram credentials: settings override > env vars
  const telegramToken = options.telegramBotToken || env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = options.telegramChatId || env.TELEGRAM_CHAT_ID;

  if (shouldSendTelegram && telegramToken && telegramChatId) {
    const sent = await sendTelegram(
      telegramChatId,
      digest.markdown,
      telegramToken,
    );
    if (sent) {
      channels.push('telegram');
    } else {
      success = false;
    }
  }

  if (shouldSendSlack) {
    const webhookUrl = options.slackWebhookUrl || '';
    if (webhookUrl) {
      const sent = await sendSlack(webhookUrl, digest.markdown);
      if (sent) {
        channels.push('slack');
      } else {
        success = false;
      }
    } else {
      console.log('[digest-job] Slack not configured, skipping');
    }
  }

  // 7. Mark digest as sent
  if (channels.length > 0) {
    await digestsRepo.markSent(digestId, channels);
  }

  console.log(`[digest-job] Digest ${digestId} complete (sent via: ${channels.join(',') || 'none'})`);

  return {
    digestId,
    entriesCount: filtered.length,
    sent: success && channels.length > 0,
  };
}
