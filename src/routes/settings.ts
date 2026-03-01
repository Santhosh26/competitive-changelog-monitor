/**
 * Settings API routes — read and update application configuration.
 *
 * Routes:
 *   GET  /          — get all settings (secrets masked)
 *   PUT  /          — update settings (validates types/ranges)
 *   GET  /defaults  — get default values (for "reset to default" UI)
 *   POST /test-telegram — send a test Telegram message
 *   POST /test-ai      — run a test AI classification
 */

import { Hono } from 'hono';
import { Env } from '../env';
import { SettingsRepo, DEFAULTS, SECRET_KEYS, maskSecret } from '../storage/settings-repo';
import { sendTelegram } from '../delivery/notifier';
import { classifyEntry } from '../processing/ai-classifier';

const settings = new Hono<{ Bindings: Env }>();

// ─── Validation helpers ──────────────────────────────────────────

const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly'];
const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

interface ValidationError {
  key: string;
  message: string;
}

function validateSettings(data: Record<string, string>): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [key, value] of Object.entries(data)) {
    // Reject unknown keys
    if (!(key in DEFAULTS)) {
      errors.push({ key, message: 'Unknown setting key' });
      continue;
    }

    // Skip masked secrets — they haven't been changed
    if (SECRET_KEYS.has(key) && value.startsWith('***')) {
      continue;
    }

    // Type-specific validation
    switch (key) {
      // Positive integers
      case 'fetch_interval_hours':
      case 'fetch_timeout_ms':
      case 'fetch_max_bytes':
      case 'browser_timeout_ms':
      case 'ai_max_tokens':
      case 'digest_lookback_days':
      case 'dedup_window_hours':
      case 'health_degraded_after':
      case 'health_failing_after':
      case 'health_disabled_after': {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 0) {
          errors.push({ key, message: 'Must be a non-negative integer' });
        }
        break;
      }

      // Positive floats
      case 'ai_budget_usd': {
        const f = parseFloat(value);
        if (isNaN(f) || f <= 0) {
          errors.push({ key, message: 'Must be a positive number' });
        }
        break;
      }

      // Float 0-1
      case 'dedup_threshold': {
        const f = parseFloat(value);
        if (isNaN(f) || f < 0 || f > 1) {
          errors.push({ key, message: 'Must be a number between 0 and 1' });
        }
        break;
      }

      // 0-100 integer thresholds
      case 'tier_critical_min':
      case 'tier_notable_min': {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 0 || n > 100) {
          errors.push({ key, message: 'Must be between 0 and 100' });
        }
        break;
      }

      // Hour 0-23
      case 'digest_hour_utc': {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 0 || n > 23) {
          errors.push({ key, message: 'Must be between 0 and 23' });
        }
        break;
      }

      // Booleans
      case 'app_enabled':
      case 'ai_enabled':
      case 'telegram_enabled':
      case 'slack_enabled': {
        if (value !== 'true' && value !== 'false') {
          errors.push({ key, message: 'Must be "true" or "false"' });
        }
        break;
      }

      // Enums
      case 'digest_frequency': {
        if (!VALID_FREQUENCIES.includes(value)) {
          errors.push({ key, message: `Must be one of: ${VALID_FREQUENCIES.join(', ')}` });
        }
        break;
      }
      case 'digest_day': {
        if (!VALID_DAYS.includes(value)) {
          errors.push({ key, message: `Must be one of: ${VALID_DAYS.join(', ')}` });
        }
        break;
      }

      // Strings (secrets and model) — no validation needed beyond existence
      case 'ai_api_key':
      case 'ai_model':
      case 'telegram_bot_token':
      case 'telegram_chat_id':
      case 'slack_webhook_url':
        break;
    }
  }

  return errors;
}

// ─── GET / — Return all settings with secrets masked ──────────────

settings.get('/', async (c) => {
  const repo = new SettingsRepo(c.env.DB);
  const data = await repo.getAllWithDefaults();
  return c.json({ data });
});

// ─── PUT / — Update settings ──────────────────────────────────────

settings.put('/', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const incoming: Record<string, string> = body.settings;
  if (!incoming || typeof incoming !== 'object') {
    return c.json({ error: 'Body must contain a "settings" object' }, 400);
  }

  // Filter out masked secrets (unchanged by the user)
  const toSave: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (SECRET_KEYS.has(key) && typeof value === 'string' && value.startsWith('***')) {
      continue; // Skip — user didn't change this secret
    }
    toSave[key] = String(value);
  }

  // Validate
  const errors = validateSettings(toSave);
  if (errors.length > 0) {
    return c.json({ error: 'Validation failed', details: errors }, 400);
  }

  // Save
  const repo = new SettingsRepo(c.env.DB);
  await repo.setMany(toSave);

  // Return updated settings (masked)
  const data = await repo.getAllWithDefaults();
  return c.json({ data, updated: Object.keys(toSave).length });
});

// ─── GET /defaults — Return default values ────────────────────────

settings.get('/defaults', (c) => {
  // Mask secret defaults (they're empty strings, but be consistent)
  const masked: Record<string, string> = { ...DEFAULTS };
  for (const key of SECRET_KEYS) {
    masked[key] = maskSecret(masked[key]);
  }
  return c.json({ data: masked });
});

// ─── POST /test-telegram — Send a test message ────────────────────

settings.post('/test-telegram', async (c) => {
  const repo = new SettingsRepo(c.env.DB);
  const config = await repo.loadConfig();

  const token = config.telegram_bot_token || c.env.TELEGRAM_BOT_TOKEN;
  const chatId = config.telegram_chat_id || c.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return c.json({ error: 'Telegram bot token and chat ID must be configured' }, 400);
  }

  const ok = await sendTelegram(
    chatId,
    'Test message from Competitive Changelog Monitor Settings panel.',
    token,
  );

  if (ok) {
    return c.json({ status: 'ok', message: 'Test message sent successfully' });
  }
  return c.json({ error: 'Failed to send test message — check token and chat ID' }, 500);
});

// ─── POST /test-ai — Run a test classification ────────────────────

settings.post('/test-ai', async (c) => {
  const repo = new SettingsRepo(c.env.DB);
  const config = await repo.loadConfig();

  const apiKey = config.ai_api_key;
  const enabled = config.ai_enabled !== 'false';

  if (!enabled) {
    return c.json({ error: 'AI classification is disabled in settings' }, 400);
  }

  if (!apiKey || apiKey.length < 10) {
    return c.json({ error: 'No valid AI API key configured' }, 400);
  }

  try {
    const result = await classifyEntry(
      'Cloudflare launches new AI Gateway',
      'Cloudflare announced AI Gateway, a product that helps developers manage and scale their AI applications with caching, rate limiting, and observability.',
      'Cloudflare',
      apiKey,
      c.env.KV,
      {
        model: config.ai_model,
        maxTokens: parseInt(config.ai_max_tokens, 10),
        budgetCap: parseFloat(config.ai_budget_usd),
        enabled: true,
      },
    );
    return c.json({
      status: 'ok',
      message: `AI classification successful (source: ${result.source})`,
      result: {
        tags: result.tags,
        relevance: result.relevance,
        summary: result.aiSummary,
        source: result.source,
      },
    });
  } catch (err: any) {
    return c.json({ error: `AI test failed: ${err.message}` }, 500);
  }
});

export default settings;
