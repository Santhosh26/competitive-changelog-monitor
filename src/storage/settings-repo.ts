/**
 * Settings repository — D1 key-value store for user-configurable knobs.
 *
 * All settings have hardcoded defaults so the app works with an empty table.
 * Secret values (API keys, tokens) are masked in GET responses.
 */

/** All settings keys with their default values. */
export const DEFAULTS: Record<string, string> = {
  // Global
  app_enabled: 'true',

  // Fetch & Ingestion
  fetch_interval_hours: '24',
  fetch_timeout_ms: '10000',
  fetch_max_bytes: '5242880',
  browser_timeout_ms: '15000',

  // AI Classification
  ai_enabled: 'true',
  ai_api_key: '',
  ai_model: 'claude-haiku-4-5-20251001',
  ai_budget_usd: '5.0',
  ai_max_tokens: '300',

  // Digest & Notifications
  digest_frequency: 'weekly',
  digest_day: 'monday',
  digest_hour_utc: '8',
  digest_lookback_days: '7',
  tier_critical_min: '80',
  tier_notable_min: '50',
  telegram_enabled: 'true',
  telegram_bot_token: '',
  telegram_chat_id: '',
  slack_enabled: 'false',
  slack_webhook_url: '',

  // Processing
  dedup_threshold: '0.8',
  dedup_window_hours: '48',
  health_degraded_after: '1',
  health_failing_after: '5',
  health_disabled_after: '10',
};

/** Keys that contain secrets — masked in GET responses. */
export const SECRET_KEYS = new Set([
  'ai_api_key',
  'telegram_bot_token',
  'slack_webhook_url',
]);

/** Mask a secret value for display: `***...last4` or `(not set)`. */
export function maskSecret(value: string): string {
  if (!value || value.length < 4) return value ? '***' : '';
  return `***...${value.slice(-4)}`;
}

export class SettingsRepo {
  constructor(private db: D1Database) {}

  /** Get all stored settings as a raw key-value map. */
  async getAll(): Promise<Record<string, string>> {
    const result = await this.db
      .prepare('SELECT key, value FROM settings')
      .all<{ key: string; value: string }>();

    const map: Record<string, string> = {};
    for (const row of result.results || []) {
      map[row.key] = row.value;
    }
    return map;
  }

  /** Get a single setting value, or null if not set. */
  async get(key: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .bind(key)
      .first<{ value: string }>();
    return row?.value ?? null;
  }

  /** Get a numeric setting with fallback. */
  async getNumber(key: string, fallback: number): Promise<number> {
    const val = await this.get(key);
    if (val === null) return fallback;
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
  }

  /** Get a boolean setting with fallback. */
  async getBool(key: string, fallback: boolean): Promise<boolean> {
    const val = await this.get(key);
    if (val === null) return fallback;
    return val === 'true';
  }

  /** Upsert a single setting. */
  async set(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(key, value)
      .run();
  }

  /** Batch upsert multiple settings. */
  async setMany(entries: Record<string, string>): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );

    const batch = Object.entries(entries).map(([k, v]) => stmt.bind(k, v));
    if (batch.length > 0) {
      await this.db.batch(batch);
    }
  }

  /** Get all settings merged with defaults, secrets masked. */
  async getAllWithDefaults(): Promise<Record<string, string>> {
    const stored = await this.getAll();
    const merged: Record<string, string> = { ...DEFAULTS };

    for (const [key, value] of Object.entries(stored)) {
      merged[key] = value;
    }

    // Mask secrets
    for (const key of SECRET_KEYS) {
      if (merged[key]) {
        merged[key] = maskSecret(merged[key]);
      }
    }

    return merged;
  }

  /**
   * Load all settings as a typed config object for cron jobs.
   * Returns raw values (secrets unmasked) for internal use only.
   */
  async loadConfig(): Promise<Record<string, string>> {
    const stored = await this.getAll();
    return { ...DEFAULTS, ...stored };
  }
}
