/**
 * Browser Rendering adapter — Tier 4 (last resort).
 *
 * WHAT IS THE BROWSER RENDERING API?
 * Cloudflare runs headless Chromium instances at the edge. Your Worker can
 * launch a browser, navigate to a page, wait for JavaScript to render, and
 * extract the fully-rendered DOM. This is the only way to scrape modern
 * React/Next.js/SPA competitor sites where a raw fetch() returns just
 * `<div id="root"></div>`.
 *
 * WHY LAST RESORT?
 * - Requires Workers Paid plan ($5/month)
 * - Limited browser sessions per account (2 concurrent, 6/minute on paid plan)
 * - Slow: ~5-15 seconds per page vs. ~200ms for RSS
 * - Resource-intensive: each session uses significant CPU/memory
 *
 * USE ONLY when the competitor site genuinely needs JS rendering. Always
 * try RSS (Tier 1) → API (Tier 2) → Static HTML (Tier 3) first.
 *
 * Docs: https://developers.cloudflare.com/browser-rendering/
 */

import puppeteer from '@cloudflare/puppeteer';
import { SourceAdapter, FetchResult } from '../types';
import { validateUrl } from '../security/url-validator';

const NAVIGATION_TIMEOUT_MS = 15_000; // 15 seconds — JS rendering takes longer
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

export class BrowserAdapter implements SourceAdapter {
  private timeoutMs: number;

  constructor(options?: { timeoutMs?: number }) {
    this.timeoutMs = options?.timeoutMs ?? NAVIGATION_TIMEOUT_MS;
  }

  /**
   * Fetch a JS-rendered page using headless Chromium.
   *
   * @param url - The page URL (must pass SSRF validation)
   * @param _config - Parser config JSON (CSS selectors — used by the parser, not here)
   * @param env - Worker env with BROWSER binding
   */
  async fetch(url: string, _config: string, env: any): Promise<FetchResult> {
    // SSRF check — even though safe-fetch does this for other adapters,
    // the Browser adapter doesn't use safe-fetch (it uses puppeteer instead),
    // so we validate explicitly.
    const validation = validateUrl(url);
    if (!validation.valid) {
      throw new Error(`SSRF blocked: ${validation.reason}`);
    }

    if (!env.BROWSER) {
      throw new Error(
        'Browser Rendering binding not available. ' +
          'Ensure you have a Workers Paid plan and [browser] configured in wrangler.toml.',
      );
    }

    const startTime = Date.now();
    let browser;

    try {
      browser = await puppeteer.launch(env.BROWSER);
      const page = await browser.newPage();

      // Security: set navigation timeout to prevent hanging on slow pages
      page.setDefaultNavigationTimeout(this.timeoutMs);

      // Block unnecessary resource types to speed up rendering and reduce cost
      await page.setRequestInterception(true);
      page.on('request', (request: any) => {
        const resourceType = request.resourceType();
        // We only need the HTML — block images, fonts, media, etc.
        if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      // Navigate and wait for JS to render
      // 'networkidle0' = no network requests for 500ms (page is "done" loading)
      await page.goto(url, { waitUntil: 'networkidle0' });

      // Extract the fully-rendered HTML
      const html = await page.content();
      const responseTimeMs = Date.now() - startTime;

      // Size check
      if (html.length > MAX_RESPONSE_BYTES) {
        throw new Error(
          `Rendered page too large: ${html.length} bytes (max: ${MAX_RESPONSE_BYTES})`,
        );
      }

      return {
        raw_content: html,
        content_type: 'html',
        http_status: 200, // puppeteer doesn't expose HTTP status for the page
        response_time_ms: responseTimeMs,
        content_length: html.length,
      };
    } finally {
      // Always close the browser to free the session
      if (browser) {
        await browser.close();
      }
    }
  }
}
