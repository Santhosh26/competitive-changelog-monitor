/**
 * API adapter — Tier 2.
 *
 * Fetches structured JSON from APIs like GitHub Releases, Algolia search
 * endpoints, or any competitor that exposes a public JSON API.
 *
 * Example use cases:
 *   - GitHub Releases API: https://api.github.com/repos/{owner}/{repo}/releases
 *   - Public Algolia search: some competitors expose their blog search via Algolia
 *
 * The parser_config for API sources stores:
 *   {
 *     "headers": { "Accept": "application/vnd.github+json" },
 *     "auth_header": "token"  // optional — if the API needs a bearer token
 *   }
 */

import { SourceAdapter, FetchResult } from '../types';
import { safeFetch } from './safe-fetch';

export class ApiAdapter implements SourceAdapter {
  /**
   * Fetch a JSON API endpoint.
   *
   * @param url - The API URL (must pass SSRF validation)
   * @param config - Parser config JSON with optional headers and auth
   */
  async fetch(url: string, config: string): Promise<FetchResult> {
    const parsedConfig = parseConfig(config);

    const result = await safeFetch(url, {
      expectedType: 'json',
      timeoutMs: 10_000,
      headers: parsedConfig.headers,
    });

    // Validate that we got JSON content
    const body = result.body.trim();
    if (!looksLikeJson(body)) {
      const contentType = result.headers.get('content-type') || '';
      throw new Error(
        `Expected JSON content but response doesn't look like JSON (Content-Type: ${contentType})`,
      );
    }

    return {
      raw_content: body,
      content_type: 'json',
      http_status: result.status,
      response_time_ms: result.responseTimeMs,
      content_length: result.contentLength,
    };
  }
}

interface ApiConfig {
  headers: Record<string, string>;
}

function parseConfig(config: string): ApiConfig {
  try {
    const parsed = JSON.parse(config || '{}');
    return {
      headers: parsed.headers || {},
    };
  } catch {
    return { headers: {} };
  }
}

/**
 * Quick heuristic: does this string look like JSON?
 */
function looksLikeJson(content: string): boolean {
  const first = content.charAt(0);
  return first === '{' || first === '[';
}
