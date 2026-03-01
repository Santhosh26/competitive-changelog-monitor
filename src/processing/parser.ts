/**
 * Content parser — transforms raw fetched content into structured entries.
 *
 * Two parsing strategies:
 *   1. RSS/Atom feeds — machine-readable XML, parsed with fast-xml-parser
 *   2. HTML pages — scraped with Cheerio using per-source CSS selectors
 *
 * WHY PER-SOURCE PARSER CONFIG?
 * Every website has different HTML structure. Akamai's blog uses different
 * CSS classes than Zscaler's. By storing selectors per source in the
 * `parser_config` JSON field, we can handle any site without changing code —
 * just update the config. Fallback selectors handle unconfigured sources.
 */

import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import { RawParsedEntry, Source } from '../types';
import { extractPlainText, sanitizeForStorage } from '../security/sanitizer';

// ─── RSS / Atom Parsing ─────────────────────────────────────────────

/**
 * Parse an RSS 2.0 or Atom feed into structured entries.
 */
export function parseRss(xml: string, sourceUrl: string): RawParsedEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['item', 'entry'].includes(name),
  });

  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    console.error('[parser] Failed to parse XML:', err);
    return [];
  }

  // RSS 2.0: rss > channel > item[]
  const rssItems = parsed?.rss?.channel?.item;
  if (rssItems && Array.isArray(rssItems)) {
    return rssItems
      .map((item: any) => parseRssItem(item, sourceUrl))
      .filter(Boolean) as RawParsedEntry[];
  }

  // Atom: feed > entry[]
  const atomEntries = parsed?.feed?.entry;
  if (atomEntries && Array.isArray(atomEntries)) {
    return atomEntries
      .map((entry: any) => parseAtomEntry(entry, sourceUrl))
      .filter(Boolean) as RawParsedEntry[];
  }

  // RDF/RSS 1.0: rdf:RDF > item[]
  const rdfItems = parsed?.['rdf:RDF']?.item;
  if (rdfItems && Array.isArray(rdfItems)) {
    return rdfItems
      .map((item: any) => parseRssItem(item, sourceUrl))
      .filter(Boolean) as RawParsedEntry[];
  }

  console.warn('[parser] No items found in feed — unsupported format?');
  return [];
}

function parseRssItem(item: any, sourceUrl: string): RawParsedEntry | null {
  const title = extractText(item.title);
  if (!title) return null;

  const link =
    item.link ||
    item.guid?.['#text'] ||
    item.guid ||
    '';
  const contentUrl = resolveUrl(typeof link === 'string' ? link : '', sourceUrl);

  const description =
    item['content:encoded'] ||
    item.description ||
    item.summary ||
    '';

  const pubDate =
    item.pubDate ||
    item['dc:date'] ||
    null;

  return {
    title: extractPlainText(title).slice(0, 500),
    summary: extractPlainText(typeof description === 'string' ? description : '').slice(0, 1000),
    content_url: contentUrl,
    published_at: parseDate(pubDate),
    raw_html_snippet: sanitizeForStorage(
      typeof description === 'string' ? description.slice(0, 5000) : '',
    ),
  };
}

function parseAtomEntry(entry: any, sourceUrl: string): RawParsedEntry | null {
  const title = extractText(entry.title);
  if (!title) return null;

  // Atom links can be objects with @_href or arrays of link objects
  let link = '';
  if (Array.isArray(entry.link)) {
    const alternate = entry.link.find(
      (l: any) => l['@_rel'] === 'alternate' || !l['@_rel'],
    );
    link = alternate?.['@_href'] || entry.link[0]?.['@_href'] || '';
  } else if (typeof entry.link === 'object') {
    link = entry.link['@_href'] || '';
  } else if (typeof entry.link === 'string') {
    link = entry.link;
  }

  const contentUrl = resolveUrl(link, sourceUrl);

  const summary =
    entry.summary?.['#text'] ||
    entry.summary ||
    entry.content?.['#text'] ||
    entry.content ||
    '';

  const published =
    entry.published ||
    entry.updated ||
    null;

  return {
    title: extractPlainText(title).slice(0, 500),
    summary: extractPlainText(typeof summary === 'string' ? summary : '').slice(0, 1000),
    content_url: contentUrl,
    published_at: parseDate(published),
    raw_html_snippet: sanitizeForStorage(
      typeof summary === 'string' ? summary.slice(0, 5000) : '',
    ),
  };
}

// ─── HTML Parsing ───────────────────────────────────────────────────

interface HtmlParserConfig {
  article_selector?: string;
  title_selector?: string;
  date_selector?: string;
  summary_selector?: string;
  link_attribute?: string;
}

// Fallback selectors when per-source config isn't set
const FALLBACK_CONFIG: HtmlParserConfig = {
  article_selector: 'article, .post, .blog-post, .entry, [class*="post"], [class*="article"]',
  title_selector: 'h1 a, h2 a, h3 a, .post-title a, .entry-title a, h1, h2',
  date_selector: 'time[datetime], .date, .post-date, .published, [class*="date"]',
  summary_selector: 'p, .excerpt, .summary, .description, [class*="excerpt"]',
  link_attribute: 'href',
};

/**
 * Parse an HTML page into structured entries using CSS selectors.
 */
export function parseHtml(
  html: string,
  configJson: string,
  sourceUrl: string,
): RawParsedEntry[] {
  const config = parseConfig(configJson);
  const $ = cheerio.load(html);
  const entries: RawParsedEntry[] = [];

  const articleSelector = config.article_selector || FALLBACK_CONFIG.article_selector!;
  const articles = $(articleSelector);

  if (articles.length === 0) {
    console.warn(
      `[parser] No articles found with selector "${articleSelector}" — try updating parser_config`,
    );
    return [];
  }

  articles.each((_, el) => {
    const $article = $(el);

    // Extract title
    const titleSelector = config.title_selector || FALLBACK_CONFIG.title_selector!;
    const $titleEl = $article.find(titleSelector).first();
    const title = $titleEl.text().trim();
    if (!title) return; // Skip entries without titles

    // Extract link
    const linkAttr = config.link_attribute || 'href';
    let link = '';
    if ($titleEl.is('a')) {
      link = $titleEl.attr(linkAttr) || '';
    } else {
      link = $titleEl.find('a').first().attr(linkAttr) || $titleEl.closest('a').attr(linkAttr) || '';
    }
    const contentUrl = resolveUrl(link, sourceUrl);

    // Extract date
    const dateSelector = config.date_selector || FALLBACK_CONFIG.date_selector!;
    const $dateEl = $article.find(dateSelector).first();
    const dateStr =
      $dateEl.attr('datetime') || $dateEl.text().trim() || null;

    // Extract summary
    const summarySelector = config.summary_selector || FALLBACK_CONFIG.summary_selector!;
    const summary = $article.find(summarySelector).first().text().trim();

    // Get raw HTML snippet for diffing
    const rawSnippet = $article.html() || '';

    entries.push({
      title: extractPlainText(title).slice(0, 500),
      summary: extractPlainText(summary).slice(0, 1000),
      content_url: contentUrl,
      published_at: parseDate(dateStr),
      raw_html_snippet: sanitizeForStorage(rawSnippet.slice(0, 5000)),
    });
  });

  return entries;
}

// ─── JSON API Parsing ───────────────────────────────────────────────

/**
 * Parse a JSON API response (e.g., GitHub Releases).
 */
export function parseJson(
  json: string,
  configJson: string,
  sourceUrl: string,
): RawParsedEntry[] {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    console.error('[parser] Failed to parse JSON');
    return [];
  }

  // Handle GitHub Releases format
  if (Array.isArray(data) && data[0]?.tag_name) {
    return data.map((release: any) => ({
      title: extractPlainText(release.name || release.tag_name).slice(0, 500),
      summary: extractPlainText(release.body || '').slice(0, 1000),
      content_url: release.html_url || sourceUrl,
      published_at: parseDate(release.published_at || release.created_at),
      raw_html_snippet: sanitizeForStorage((release.body || '').slice(0, 5000)),
    }));
  }

  // Generic array of items
  if (Array.isArray(data)) {
    return data
      .filter((item: any) => item.title)
      .map((item: any) => ({
        title: extractPlainText(item.title).slice(0, 500),
        summary: extractPlainText(item.summary || item.description || item.body || '').slice(0, 1000),
        content_url: item.url || item.link || item.html_url || sourceUrl,
        published_at: parseDate(item.published_at || item.date || item.created_at),
        raw_html_snippet: sanitizeForStorage(
          (item.body || item.content || '').slice(0, 5000),
        ),
      }));
  }

  return [];
}

// ─── Unified Parse Function ─────────────────────────────────────────

/**
 * Parse raw content based on source type. Returns structured entries.
 */
export function parseContent(
  rawContent: string,
  sourceType: Source['source_type'],
  parserConfig: string,
  sourceUrl: string,
): RawParsedEntry[] {
  switch (sourceType) {
    case 'rss':
    case 'atom':
      return parseRss(rawContent, sourceUrl);
    case 'html':
    case 'browser':
      return parseHtml(rawContent, parserConfig, sourceUrl);
    case 'api':
      return parseJson(rawContent, parserConfig, sourceUrl);
    default:
      console.warn(`[parser] Unknown source type: ${sourceType}`);
      return [];
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function parseConfig(configJson: string): HtmlParserConfig {
  try {
    return JSON.parse(configJson || '{}');
  } catch {
    return {};
  }
}

/**
 * Extract text from a value that may be a string or an object with #text.
 */
function extractText(value: any): string {
  if (typeof value === 'string') return value;
  if (value?.['#text']) return value['#text'];
  if (typeof value === 'number') return String(value);
  return '';
}

/**
 * Resolve a relative URL against a base URL.
 */
function resolveUrl(url: string, baseUrl: string): string {
  if (!url) return baseUrl;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url || baseUrl;
  }
}

/**
 * Parse a date string into an ISO string. Returns null if unparseable.
 */
function parseDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}
