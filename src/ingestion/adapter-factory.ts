/**
 * Adapter factory — returns the correct adapter based on source_type.
 *
 * THE ADAPTER PATTERN:
 * Each source type (RSS, API, HTML, Browser) has different fetching logic,
 * but they all return the same FetchResult interface. The cron orchestrator
 * doesn't care HOW content is fetched — it just calls adapter.fetch() and
 * gets a uniform result. This makes it easy to add new adapters later
 * (e.g., a Sitemap adapter, a Twitter/X API adapter) without changing
 * any orchestration code.
 *
 * Tier priority (always pick the lightest adapter that works):
 *   1. RSS/Atom — structured, reliable, fast
 *   2. API — structured, may need auth
 *   3. Static HTML — works for server-rendered pages
 *   4. Browser Rendering — last resort for JS-rendered SPAs
 */

import { Source, SourceAdapter } from '../types';
import { RssAdapter } from './rss-adapter';
import { ApiAdapter } from './api-adapter';
import { HtmlAdapter } from './html-adapter';
import { BrowserAdapter } from './browser-adapter';

export interface AdapterOptions {
  browserTimeoutMs?: number;
}

/**
 * Get the correct adapter for a source type.
 */
export function getAdapter(sourceType: Source['source_type'], options?: AdapterOptions): SourceAdapter {
  switch (sourceType) {
    case 'rss':
    case 'atom':
      return new RssAdapter();
    case 'api':
      return new ApiAdapter();
    case 'html':
      return new HtmlAdapter();
    case 'browser':
      return new BrowserAdapter({ timeoutMs: options?.browserTimeoutMs });
    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
}
