/**
 * RSS/Atom adapter — Tier 1 (most reliable).
 *
 * Fetches structured RSS 2.0 or Atom feeds. These are the best data source
 * because they're machine-readable by design — no scraping heuristics needed.
 *
 * Many competitors publish feeds at common paths:
 *   /feed, /rss, /atom.xml, /blog/rss, /blog/feed, /blog/rss.xml
 *
 * The source discovery module (source-discovery.ts) auto-probes for these.
 */

import { SourceAdapter, FetchResult } from '../types';
import { safeFetch, SafeFetchError } from './safe-fetch';

export class RssAdapter implements SourceAdapter {
  /**
   * Fetch an RSS or Atom feed.
   *
   * @param url - The feed URL (must pass SSRF validation)
   * @param _config - Parser config JSON (unused for RSS — feeds are self-describing)
   */
  async fetch(url: string, _config: string): Promise<FetchResult> {
    const result = await safeFetch(url, {
      expectedType: 'xml',
      timeoutMs: 10_000,
    });

    // Validate that we got XML-like content
    const contentType = result.headers.get('content-type') || '';
    const body = result.body.trim();

    // Some servers return RSS as text/html or application/octet-stream.
    // Rather than trusting Content-Type, check if the body looks like XML.
    if (!looksLikeXml(body)) {
      throw new SafeFetchError(
        'NETWORK_ERROR',
        `Expected XML/RSS content but got non-XML response (Content-Type: ${contentType})`,
      );
    }

    return {
      raw_content: body,
      content_type: 'xml',
      http_status: result.status,
      response_time_ms: result.responseTimeMs,
      content_length: result.contentLength,
    };
  }
}

/**
 * Quick heuristic: does this string look like XML?
 * Checks for XML declaration or common RSS/Atom root elements.
 */
function looksLikeXml(content: string): boolean {
  const trimmed = content.slice(0, 500).trimStart();
  return (
    trimmed.startsWith('<?xml') ||
    trimmed.startsWith('<rss') ||
    trimmed.startsWith('<feed') ||
    trimmed.startsWith('<channel') ||
    // Some feeds have a BOM or whitespace before the declaration
    /^[\s\uFEFF]*<(\?xml|rss|feed|channel)/i.test(trimmed)
  );
}
