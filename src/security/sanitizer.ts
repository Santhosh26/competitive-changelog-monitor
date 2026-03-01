/**
 * HTML sanitizer for external content.
 *
 * WHY THIS MATTERS:
 * We store raw_html_snippet from competitor sites. If we render this in the
 * dashboard without sanitization, embedded JavaScript could execute — this is
 * **Stored XSS** (Cross-Site Scripting). An attacker who compromises a
 * competitor's blog (or publishes malicious content) could execute arbitrary
 * JS in the browser of anyone viewing our dashboard.
 *
 * DOMPurify is the gold standard for HTML sanitization, but it requires a DOM
 * environment. Cloudflare Workers have the HTMLRewriter API which can be used,
 * but for our use case we use a regex-based approach for server-side sanitization
 * plus CSP headers as defense-in-depth. The dashboard also runs DOMPurify
 * client-side before any innerHTML rendering (Phase 7).
 *
 * Three output modes:
 *   - sanitizeForStorage: strip all dangerous elements, keep safe formatting tags
 *   - sanitizeForDisplay: same as storage but also strips data attributes
 *   - extractPlainText: strip ALL HTML, return plain text only
 */

// Tags that are always dangerous and must be completely removed (with content)
const DANGEROUS_TAGS_WITH_CONTENT = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'link',
  'meta',
  'base',
  'svg',
  'math',
];

// Tags that are safe for display (we keep these, strip everything else)
const SAFE_TAGS = new Set([
  'p',
  'br',
  'b',
  'i',
  'em',
  'strong',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'span',
  'div',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'dl',
  'dt',
  'dd',
  'hr',
  'sup',
  'sub',
  'mark',
  'abbr',
  'time',
  'figure',
  'figcaption',
  'details',
  'summary',
]);

// Attributes that are safe to keep
const SAFE_ATTRIBUTES = new Set([
  'href',
  'title',
  'alt',
  'datetime',
  'class',
  'id',
  'name',
  'target',
  'rel',
  'colspan',
  'rowspan',
]);

/**
 * Remove dangerous tags AND their content (e.g., <script>...</script>).
 */
function stripDangerousTags(html: string): string {
  let result = html;
  for (const tag of DANGEROUS_TAGS_WITH_CONTENT) {
    // Match opening tag (with attributes) through closing tag, non-greedy
    const regex = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    result = result.replace(regex, '');
    // Also remove self-closing variants
    const selfClosing = new RegExp(`<${tag}\\b[^>]*/?>`, 'gi');
    result = result.replace(selfClosing, '');
  }
  return result;
}

/**
 * Remove all event handler attributes (onclick, onerror, onload, etc.)
 * and dangerous attribute values (javascript: URIs, data: URIs).
 */
function stripDangerousAttributes(html: string): string {
  // Remove event handlers: on*="..." or on*='...'
  let result = html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

  // Remove javascript: protocol in href/src/action attributes
  result = result.replace(
    /\s+(href|src|action)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi,
    '',
  );

  // Remove data: protocol in src (can embed scripts)
  result = result.replace(
    /\s+src\s*=\s*(?:"data:[^"]*"|'data:[^']*')/gi,
    '',
  );

  // Remove expression() in style attributes (IE XSS vector)
  result = result.replace(
    /\s+style\s*=\s*(?:"[^"]*expression\s*\([^"]*"|'[^']*expression\s*\([^']*')/gi,
    '',
  );

  // Remove style attributes entirely (can contain url() and expression())
  result = result.replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

  return result;
}

/**
 * Strip all tags except safe ones. Remove unsafe attributes from remaining tags.
 */
function stripUnsafeTags(html: string): string {
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tagName, attrs) => {
    const tag = tagName.toLowerCase();

    if (!SAFE_TAGS.has(tag)) {
      return ''; // Remove the tag entirely
    }

    // For safe tags, filter attributes to only safe ones
    const cleanAttrs = filterAttributes(attrs);

    // Reconstruct the tag
    if (match.startsWith('</')) {
      return `</${tag}>`;
    }
    const selfClose = match.endsWith('/>') ? ' /' : '';
    return `<${tag}${cleanAttrs}${selfClose}>`;
  });
}

/**
 * Keep only safe attributes from an attribute string.
 */
function filterAttributes(attrString: string): string {
  const attrs: string[] = [];
  // Match attribute="value", attribute='value', or attribute=value
  const attrRegex = /\s+([a-zA-Z][\w-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let attrMatch;

  while ((attrMatch = attrRegex.exec(attrString)) !== null) {
    const name = attrMatch[1].toLowerCase();
    const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';

    if (!SAFE_ATTRIBUTES.has(name)) continue;

    // For href, only allow http://, https://, mailto:, and relative paths
    if (name === 'href') {
      const trimmed = value.trim().toLowerCase();
      if (
        trimmed.startsWith('javascript:') ||
        trimmed.startsWith('data:') ||
        trimmed.startsWith('vbscript:')
      ) {
        continue; // Skip dangerous href values
      }
    }

    // Force target="_blank" links to have rel="noopener noreferrer"
    if (name === 'target' && value === '_blank') {
      attrs.push(`target="_blank"`);
      attrs.push(`rel="noopener noreferrer"`);
      continue;
    }

    attrs.push(`${name}="${escapeAttrValue(value)}"`);
  }

  return attrs.length > 0 ? ' ' + attrs.join(' ') : '';
}

/**
 * Escape attribute values to prevent breaking out of the attribute.
 */
function escapeAttrValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sanitize HTML for storage in D1.
 * Strips all dangerous elements, keeps safe formatting tags.
 */
export function sanitizeForStorage(html: string): string {
  if (!html) return '';
  let result = stripDangerousTags(html);
  result = stripDangerousAttributes(result);
  result = stripUnsafeTags(result);
  // Collapse excessive whitespace
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

/**
 * Sanitize HTML for rendering in the dashboard.
 * Same as storage but also strips data-* attributes and normalizes whitespace.
 */
export function sanitizeForDisplay(html: string): string {
  let result = sanitizeForStorage(html);
  // Remove any remaining data-* attributes
  result = result.replace(/\s+data-[\w-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/g, '');
  return result;
}

/**
 * Extract plain text from HTML. Strips ALL tags, decodes entities.
 * Used for entry summaries and search indexing.
 */
export function extractPlainText(html: string): string {
  if (!html) return '';
  // First, remove dangerous tags with their content
  let result = stripDangerousTags(html);
  // Replace block-level elements with newlines
  result = result.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)\s*>/gi, '\n');
  result = result.replace(/<br\s*\/?>/gi, '\n');
  // Strip all remaining HTML tags
  result = result.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  result = result
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  // Collapse whitespace
  result = result.replace(/[ \t]+/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}
