/**
 * Source discovery — auto-probe a competitor domain for monitorable URLs.
 *
 * Given a domain like "akamai.com", this module probes common paths for:
 *   - RSS/Atom feeds (/feed, /rss, /atom.xml, /blog/feed, /blog/rss.xml)
 *   - Changelogs (/changelog, /whats-new, /releases, /release-notes)
 *   - Documentation updates (/docs/changelog, /api/changelog)
 *   - link[rel="alternate"] tags in the homepage HTML
 *
 * This saves users from manually hunting for feed URLs — they just provide
 * a competitor name and domain, and we find the best sources automatically.
 */

import { safeFetch, SafeFetchError } from './safe-fetch';

export interface DiscoveredSource {
  url: string;
  type: 'rss' | 'atom' | 'html';
  label: string; // Human-readable description
  confidence: 'high' | 'medium' | 'low';
}

// Common feed paths to probe (ordered by likelihood)
const FEED_PATHS = [
  '/feed',
  '/rss',
  '/rss.xml',
  '/atom.xml',
  '/feed.xml',
  '/blog/feed',
  '/blog/rss',
  '/blog/rss.xml',
  '/blog/atom.xml',
  '/blog/feed.xml',
  '/index.xml',
  '/feeds/posts/default', // Blogger
];

// Common changelog/release paths to probe
const CHANGELOG_PATHS = [
  '/changelog',
  '/whats-new',
  '/releases',
  '/release-notes',
  '/docs/changelog',
  '/api/changelog',
  '/product-updates',
  '/updates',
  '/blog',
];

/**
 * Discover monitorable sources for a competitor domain.
 *
 * @param domain - The competitor's domain (e.g., "akamai.com")
 * @returns Array of discovered sources, sorted by confidence
 */
export async function discoverSources(
  domain: string,
): Promise<DiscoveredSource[]> {
  const discovered: DiscoveredSource[] = [];
  const baseUrl = `https://www.${domain}`;
  const baseUrlNaked = `https://${domain}`;

  // Run all probes concurrently for speed
  const probeResults = await Promise.allSettled([
    // 1. Probe common feed paths
    ...FEED_PATHS.flatMap((path) => [
      probeFeed(`${baseUrl}${path}`, path),
      probeFeed(`${baseUrlNaked}${path}`, path),
    ]),

    // 2. Probe the homepage for <link rel="alternate"> feed references
    probeHomepageForFeeds(baseUrl),
    probeHomepageForFeeds(baseUrlNaked),

    // 3. Probe common changelog/update pages
    ...CHANGELOG_PATHS.flatMap((path) => [
      probeHtmlPage(`${baseUrl}${path}`, path),
      probeHtmlPage(`${baseUrlNaked}${path}`, path),
    ]),
  ]);

  // Collect successful probes
  for (const result of probeResults) {
    if (result.status === 'fulfilled' && result.value) {
      if (Array.isArray(result.value)) {
        discovered.push(...result.value);
      } else {
        discovered.push(result.value);
      }
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = discovered.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  // Sort: high confidence first, then feeds before HTML pages
  return unique.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    const typeOrder = { rss: 0, atom: 1, html: 2 };
    const confDiff = confOrder[a.confidence] - confOrder[b.confidence];
    if (confDiff !== 0) return confDiff;
    return typeOrder[a.type] - typeOrder[b.type];
  });
}

/**
 * Probe a URL to see if it's an RSS/Atom feed.
 */
async function probeFeed(
  url: string,
  path: string,
): Promise<DiscoveredSource | null> {
  try {
    const result = await safeFetch(url, {
      expectedType: 'xml',
      timeoutMs: 5_000,
    });

    if (result.status !== 200) return null;

    const body = result.body.trim().slice(0, 500);
    if (body.includes('<rss') || body.includes('<?xml')) {
      const isAtom = body.includes('<feed') && body.includes('xmlns="http://www.w3.org/2005/Atom"');
      return {
        url,
        type: isAtom ? 'atom' : 'rss',
        label: `${isAtom ? 'Atom' : 'RSS'} feed at ${path}`,
        confidence: 'high',
      };
    }
  } catch {
    // Probe failed — this path doesn't exist or isn't a feed
  }
  return null;
}

/**
 * Fetch the homepage and look for <link rel="alternate"> feed references.
 *
 * Example:
 *   <link rel="alternate" type="application/rss+xml" href="/blog/rss.xml" title="Blog RSS">
 */
async function probeHomepageForFeeds(
  baseUrl: string,
): Promise<DiscoveredSource[]> {
  const results: DiscoveredSource[] = [];

  try {
    const result = await safeFetch(baseUrl, {
      expectedType: 'html',
      timeoutMs: 5_000,
    });

    if (result.status !== 200) return results;

    // Extract <link rel="alternate" type="application/rss+xml|application/atom+xml">
    const linkRegex =
      /<link\s[^>]*rel=["']alternate["'][^>]*type=["'](application\/(?:rss|atom)\+xml)["'][^>]*>/gi;
    let match;

    while ((match = linkRegex.exec(result.body)) !== null) {
      const fullTag = match[0];
      const feedType = match[1];

      // Extract href
      const hrefMatch = fullTag.match(/href=["']([^"']+)["']/);
      if (!hrefMatch) continue;

      let href = hrefMatch[1];
      // Resolve relative URLs
      if (href.startsWith('/')) {
        href = `${baseUrl}${href}`;
      } else if (!href.startsWith('http')) {
        href = `${baseUrl}/${href}`;
      }

      // Extract title
      const titleMatch = fullTag.match(/title=["']([^"']+)["']/);
      const title = titleMatch ? titleMatch[1] : 'Feed';

      results.push({
        url: href,
        type: feedType.includes('atom') ? 'atom' : 'rss',
        label: `${title} (discovered via <link> tag)`,
        confidence: 'high',
      });
    }
  } catch {
    // Homepage fetch failed — skip
  }

  return results;
}

/**
 * Probe a URL to see if it's a valid HTML page with content.
 */
async function probeHtmlPage(
  url: string,
  path: string,
): Promise<DiscoveredSource | null> {
  try {
    const result = await safeFetch(url, {
      expectedType: 'html',
      timeoutMs: 5_000,
    });

    if (result.status !== 200) return null;

    const contentType = result.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    // Check that the page has reasonable content (not a 404 page in disguise)
    if (result.contentLength < 1000) return null;

    return {
      url,
      type: 'html',
      label: `HTML page at ${path}`,
      confidence: 'medium',
    };
  } catch {
    // Probe failed — this path doesn't exist
  }
  return null;
}
