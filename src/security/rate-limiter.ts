/**
 * KV-based rate limiter for per-source and per-API rate limiting.
 *
 * Uses KV counters with TTL to enforce limits:
 * - Per-source: prevent fetching the same source more than once per check_interval
 * - Per-API: rate-limit API endpoints to prevent abuse
 *
 * KV key format:
 *   ratelimit:{scope}:{identifier}:{window}
 *
 * Example:
 *   ratelimit:source:src_abc123:2026-02-28T06  → count of fetches this 6h window
 *   ratelimit:api:/api/sources:2026-02-28T14   → count of API calls this hour
 */

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}

/**
 * Get the current time window key for a given interval (in minutes).
 */
function getWindowKey(intervalMinutes: number): string {
  const now = new Date();
  const windowStart = new Date(
    Math.floor(now.getTime() / (intervalMinutes * 60 * 1000)) * (intervalMinutes * 60 * 1000),
  );
  return windowStart.toISOString().slice(0, 16); // "2026-02-28T06:00"
}

/**
 * Check if a source can be fetched (respects check_interval_hours).
 */
export async function canFetchSource(
  kv: KVNamespace,
  sourceId: string,
  checkIntervalHours: number,
): Promise<RateLimitResult> {
  const windowKey = getWindowKey(checkIntervalHours * 60);
  const kvKey = `ratelimit:source:${sourceId}:${windowKey}`;

  const existing = await kv.get(kvKey);
  if (existing) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: windowKey,
    };
  }

  // Mark as fetched — TTL = check_interval in seconds
  await kv.put(kvKey, '1', { expirationTtl: checkIntervalHours * 3600 });

  return {
    allowed: true,
    remaining: 0,
    resetAt: windowKey,
  };
}

/**
 * Rate-limit API endpoints. Allows `maxRequests` per `windowMinutes`.
 */
export async function checkApiRateLimit(
  kv: KVNamespace,
  endpoint: string,
  maxRequests: number,
  windowMinutes: number = 60,
): Promise<RateLimitResult> {
  const windowKey = getWindowKey(windowMinutes);
  const kvKey = `ratelimit:api:${endpoint}:${windowKey}`;

  const current = parseInt((await kv.get(kvKey)) || '0', 10);

  if (current >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: windowKey,
    };
  }

  // Increment the counter
  await kv.put(kvKey, String(current + 1), { expirationTtl: windowMinutes * 60 });

  return {
    allowed: true,
    remaining: maxRequests - current - 1,
    resetAt: windowKey,
  };
}
