/**
 * Shared fetch utility used by ALL source adapters.
 *
 * Centralizes security controls so they can't be accidentally skipped:
 *   1. SSRF validation — every URL checked before fetch
 *   2. Response size limit — 5MB max to prevent OOM (Workers have 128MB memory)
 *   3. Timeout — 10s default, 15s for browser adapter
 *   4. Proper User-Agent — be a good bot, identify yourself
 *
 * WHY a shared utility instead of per-adapter logic:
 * If each adapter implements its own fetch, a future adapter might forget the
 * SSRF check or size limit. By centralizing here, security is enforced once
 * and all adapters inherit it.
 */

import { validateUrl } from '../security/url-validator';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT_MS = 10_000; // 10 seconds
const USER_AGENT = 'CompetitiveChangelogMonitor/1.0 (bot)';

export interface SafeFetchOptions {
  /** Override the default timeout (ms). Browser adapter uses 15s. */
  timeoutMs?: number;
  /** Additional headers to send with the request. */
  headers?: Record<string, string>;
  /** Expected content type for validation ('xml', 'html', 'json'). */
  expectedType?: string;
}

export interface SafeFetchResult {
  body: string;
  status: number;
  headers: Headers;
  responseTimeMs: number;
  contentLength: number;
}

/**
 * Fetch a URL with full security controls.
 *
 * Throws on: SSRF violation, response too large, timeout, network error.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  // ─── 1. SSRF Validation ──────────────────────────────────────────
  const validation = validateUrl(url);
  if (!validation.valid) {
    throw new SafeFetchError(
      `SSRF_BLOCKED`,
      `URL blocked by SSRF protection: ${validation.reason}`,
    );
  }

  // ─── 2. Build request with proper headers ────────────────────────
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const requestHeaders: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: buildAcceptHeader(options.expectedType),
    ...options.headers,
  };

  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      headers: requestHeaders,
      signal: controller.signal,
      redirect: 'follow',
    });

    // ─── 3. Check Content-Length before reading body (fast path) ──
    const declaredLength = parseInt(
      response.headers.get('content-length') || '0',
      10,
    );
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new SafeFetchError(
        'RESPONSE_TOO_LARGE',
        `Response Content-Length ${declaredLength} exceeds ${MAX_RESPONSE_BYTES} byte limit`,
      );
    }

    // ─── 4. Read body with streaming size check ──────────────────
    const body = await readBodyWithLimit(response);
    const responseTimeMs = Date.now() - startTime;

    return {
      body,
      status: response.status,
      headers: response.headers,
      responseTimeMs,
      contentLength: body.length,
    };
  } catch (error: unknown) {
    if (error instanceof SafeFetchError) throw error;

    // Handle abort (timeout)
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new SafeFetchError(
        'TIMEOUT',
        `Request timed out after ${timeoutMs}ms`,
      );
    }

    // Network errors
    const message =
      error instanceof Error ? error.message : 'Unknown fetch error';
    throw new SafeFetchError('NETWORK_ERROR', message);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Read the response body as text, aborting if it exceeds the size limit.
 *
 * We can't just call response.text() because that loads the entire body into
 * memory at once. For responses without Content-Length (chunked transfer),
 * we need to stream and count bytes.
 */
async function readBodyWithLimit(response: Response): Promise<string> {
  // Fast path: if Content-Length is declared and small enough, just read it
  const declaredLength = parseInt(
    response.headers.get('content-length') || '0',
    10,
  );
  if (declaredLength > 0 && declaredLength <= MAX_RESPONSE_BYTES) {
    return response.text();
  }

  // Streaming path: read chunks, count bytes, abort if too large
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        reader.cancel();
        throw new SafeFetchError(
          'RESPONSE_TOO_LARGE',
          `Response exceeded ${MAX_RESPONSE_BYTES} byte limit during streaming (read ${totalBytes} bytes)`,
        );
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }

    // Flush the decoder
    chunks.push(decoder.decode());
    return chunks.join('');
  } catch (error) {
    reader.cancel();
    throw error;
  }
}

/**
 * Build an appropriate Accept header based on expected content type.
 */
function buildAcceptHeader(expectedType?: string): string {
  switch (expectedType) {
    case 'xml':
      return 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1';
    case 'json':
      return 'application/json, */*;q=0.1';
    case 'html':
      return 'text/html, application/xhtml+xml, */*;q=0.1';
    default:
      return '*/*';
  }
}

/**
 * Custom error class for safe-fetch failures.
 * The `code` field allows callers to distinguish error types for health tracking.
 */
export class SafeFetchError extends Error {
  constructor(
    public readonly code:
      | 'SSRF_BLOCKED'
      | 'RESPONSE_TOO_LARGE'
      | 'TIMEOUT'
      | 'NETWORK_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}
