/**
 * Static HTML adapter — Tier 3.
 *
 * Fetches server-rendered HTML pages. Works well for traditional blogs
 * (WordPress, Hugo, Jekyll) where the HTML returned by the server contains
 * the actual content.
 *
 * IMPORTANT: This adapter does NOT work for JS-rendered (SPA) sites.
 * If the page returns something like `<div id="root"></div>` with no real
 * content, the site uses client-side rendering and needs the Browser
 * Rendering adapter (Tier 4) instead.
 *
 * Detection: After fetching, we check if the page has suspiciously little
 * text content relative to its HTML size. If so, we log a warning that
 * suggests switching to the Browser adapter.
 */

import { SourceAdapter, FetchResult } from '../types';
import { safeFetch } from './safe-fetch';

// Minimum text-to-HTML ratio to consider the page "server-rendered"
const MIN_TEXT_RATIO = 0.05; // 5% — very generous, most real pages are 10-30%

export class HtmlAdapter implements SourceAdapter {
  /**
   * Fetch a static HTML page.
   *
   * @param url - The page URL (must pass SSRF validation)
   * @param _config - Parser config JSON (CSS selectors — used by the parser, not here)
   */
  async fetch(url: string, _config: string): Promise<FetchResult> {
    const result = await safeFetch(url, {
      expectedType: 'html',
      timeoutMs: 10_000,
    });

    const body = result.body;

    // Check for signs this is a JS-rendered page
    if (looksLikeJsRendered(body)) {
      console.warn(
        `[html-adapter] Page at ${url} appears to be JS-rendered (very little text content). ` +
          `Consider switching this source to the "browser" adapter type.`,
      );
    }

    return {
      raw_content: body,
      content_type: 'html',
      http_status: result.status,
      response_time_ms: result.responseTimeMs,
      content_length: result.contentLength,
    };
  }
}

/**
 * Detect if a page is likely JS-rendered (SPA) rather than server-rendered.
 *
 * Heuristics:
 * 1. Contains common SPA mount points with minimal content
 * 2. Text content is very small relative to HTML size
 * 3. Contains typical SPA framework script bundles
 */
function looksLikeJsRendered(html: string): boolean {
  // Check for near-empty mount points
  const spaPatterns = [
    /<div\s+id=["'](?:root|app|__next|__nuxt)["']\s*>\s*<\/div>/i,
    /<div\s+id=["'](?:root|app|__next|__nuxt)["']\s*\/>/i,
  ];

  for (const pattern of spaPatterns) {
    if (pattern.test(html)) return true;
  }

  // Check text-to-HTML ratio
  const textContent = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (html.length > 1000 && textContent.length / html.length < MIN_TEXT_RATIO) {
    return true;
  }

  return false;
}
