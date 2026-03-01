import { Env } from '../env';
import { SettingsRepo } from '../storage/settings-repo';
import { fetchAllSources } from './fetch-job';
import { generateAndSendDigest } from './digest-job';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Cron job: Fetch all enabled sources, parse content, detect changes.
 *
 * Checks the user-configured `fetch_interval_hours` against the last completed
 * fetch timestamp in KV. If the interval hasn't elapsed, the job is skipped.
 * This lets the wrangler.toml cron stay at its fixed schedule while giving users
 * control over actual fetch frequency (e.g. every 12h).
 */
export async function orchestrateFetchJob(env: Env) {
  console.log('[cron:fetch] Fetch job triggered');
  try {
    const settings = new SettingsRepo(env.DB);
    const config = await settings.loadConfig();

    // Master kill switch — skip all work when app is disabled
    if (config.app_enabled === 'false') {
      console.log('[cron:fetch] Skipping — app is disabled');
      return { total: 0, checked: 0, succeeded: 0, failed: 0, skipped: 0, skippedReason: 'app_disabled' };
    }

    // Check if enough time has passed since last fetch
    const intervalHours = parseFloat(config.fetch_interval_hours) || 24;
    const lastFetch = await env.KV.get('last_fetch_completed_at');
    if (lastFetch) {
      const elapsed = Date.now() - new Date(lastFetch).getTime();
      const intervalMs = intervalHours * 3600 * 1000;
      if (elapsed < intervalMs) {
        const minutesAgo = Math.round(elapsed / 60000);
        console.log(`[cron:fetch] Skipping — last fetch was ${minutesAgo}m ago, interval is ${intervalHours}h`);
        return { total: 0, checked: 0, succeeded: 0, failed: 0, skipped: 0, skippedReason: 'interval_not_elapsed' };
      }
    }

    const result = await fetchAllSources(env, {
      timeoutMs: parseInt(config.fetch_timeout_ms, 10) || 10000,
      maxBytes: parseInt(config.fetch_max_bytes, 10) || 5242880,
      browserTimeoutMs: parseInt(config.browser_timeout_ms, 10) || 15000,
      dedupThreshold: parseFloat(config.dedup_threshold) || 0.8,
      dedupWindowHours: parseFloat(config.dedup_window_hours) || 48,
      healthDegradedAfter: parseInt(config.health_degraded_after, 10) || 1,
      healthFailingAfter: parseInt(config.health_failing_after, 10) || 5,
      healthDisabledAfter: parseInt(config.health_disabled_after, 10) || 10,
      aiConfig: {
        enabled: config.ai_enabled !== 'false',
        apiKey: config.ai_api_key || undefined,
        model: config.ai_model,
        maxTokens: parseInt(config.ai_max_tokens, 10) || 300,
        budgetCap: parseFloat(config.ai_budget_usd) || 5.0,
      },
    });

    // Record completion time for interval gating
    await env.KV.put('last_fetch_completed_at', new Date().toISOString());

    console.log(
      `[cron:fetch] Complete — ${result.succeeded}/${result.total} sources fetched successfully`,
    );
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[cron:fetch] Fatal error: ${message}`);
    return { total: 0, checked: 0, succeeded: 0, failed: 0, skipped: 0, error: message };
  }
}

/**
 * Cron job: Generate and send the competitive intelligence digest.
 *
 * The cron still fires on its wrangler.toml schedule, but the job checks
 * the user's configured frequency/day/hour and skips if it's not time yet.
 */
export async function orchestrateDigestJob(env: Env): Promise<void> {
  console.log('[cron:digest] Digest job triggered');
  try {
    const settings = new SettingsRepo(env.DB);
    const config = await settings.loadConfig();

    // Master kill switch — skip all work when app is disabled
    if (config.app_enabled === 'false') {
      console.log('[cron:digest] Skipping — app is disabled');
      return;
    }

    const frequency = config.digest_frequency || 'weekly';
    const targetDay = config.digest_day || 'monday';
    const targetHour = parseInt(config.digest_hour_utc, 10) || 8;

    // Check if now is the right time to send
    const now = new Date();
    const currentDay = DAY_NAMES[now.getUTCDay()];
    const currentHour = now.getUTCHours();

    if (frequency === 'weekly' && currentDay !== targetDay) {
      console.log(`[cron:digest] Skipping — today is ${currentDay}, digest set for ${targetDay}`);
      return;
    }
    if (frequency === 'biweekly') {
      // Check if it's been at least 13 days since last digest
      const lastDigest = await env.KV.get('last_digest_sent_at');
      if (lastDigest) {
        const elapsed = Date.now() - new Date(lastDigest).getTime();
        if (elapsed < 13 * 24 * 3600 * 1000 || currentDay !== targetDay) {
          console.log(`[cron:digest] Skipping — biweekly interval not yet elapsed or wrong day`);
          return;
        }
      }
    }
    // For daily, always run. For weekly/biweekly, we checked the day above.
    // Check the hour (allow 1-hour window since cron might not fire exactly on the hour)
    if (Math.abs(currentHour - targetHour) > 1 && !(currentHour === 0 && targetHour === 23)) {
      console.log(`[cron:digest] Skipping — current hour ${currentHour} UTC, digest set for ${targetHour} UTC`);
      return;
    }

    const lookbackDays = parseInt(config.digest_lookback_days, 10) || 7;
    const telegramEnabled = config.telegram_enabled !== 'false';
    const slackEnabled = config.slack_enabled === 'true';

    const result = await generateAndSendDigest(env, {
      daysBack: lookbackDays,
      sendTelegram: telegramEnabled,
      sendSlack: slackEnabled,
      tierCritical: parseInt(config.tier_critical_min, 10) || 80,
      tierNotable: parseInt(config.tier_notable_min, 10) || 50,
      telegramBotToken: config.telegram_bot_token || undefined,
      telegramChatId: config.telegram_chat_id || undefined,
      slackWebhookUrl: config.slack_webhook_url || undefined,
    });

    // Record completion time for biweekly gating
    await env.KV.put('last_digest_sent_at', new Date().toISOString());

    console.log(
      `[cron:digest] Complete — digest ${result.digestId} with ${result.entriesCount} entries, sent=${result.sent}`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[cron:digest] Fatal error: ${message}`);
  }
}
