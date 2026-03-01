/**
 * Keyword tagger — v1 (Phase 3).
 *
 * Assigns category tags to entries based on regex pattern matching.
 * Phase 5 will upgrade this to Claude API semantic classification for
 * much higher accuracy.
 *
 * IMPROVEMENT OVER SIMPLE includes():
 * - Uses regex with word boundaries (\b) to avoid partial matches
 *   (e.g., "security" won't match "insecurities" — wait, it will, which is fine,
 *    but "sec" won't match "security")
 * - Uses exclude patterns to filter false positives
 *   (e.g., "hiring" posts won't be tagged as Security)
 * - Multiple tags per entry (an "API security" post gets both Security + DevPlatform)
 *   unless the exclude pattern overrides
 */

interface TagRule {
  tag: string;
  includePatterns: RegExp[];
  excludePatterns: RegExp[];
}

const TAG_RULES: TagRule[] = [
  {
    tag: 'Security',
    includePatterns: [
      /\bwaf\b/i,
      /\bbot\s*(management|detection|mitigation)\b/i,
      /\bddos\b/i,
      /\bapi\s*security\b/i,
      /\bvulnerabilit/i,
      /\bthreat/i,
      /\bmalware\b/i,
      /\bzero.?day\b/i,
      /\bransomware\b/i,
      /\bcve-\d/i,
      /\bfirewall\b/i,
      /\bencrypt/i,
      /\bphishing\b/i,
      /\bcyber/i,
      /\bsecurity\b/i,
    ],
    excludePatterns: [
      /\bhiring\b/i,
      /\bjob\b/i,
      /\bcareer/i,
      /\bintern\b/i,
      /\brecrui/i,
    ],
  },
  {
    tag: 'Zero Trust',
    includePatterns: [
      /\bzero\s*trust\b/i,
      /\bsase\b/i,
      /\bcasb\b/i,
      /\bdlp\b/i,
      /\baccess\s*control\b/i,
      /\bidentity/i,
      /\bsso\b/i,
      /\bmfa\b/i,
      /\bztna\b/i,
    ],
    excludePatterns: [],
  },
  {
    tag: 'Performance',
    includePatterns: [
      /\bcdn\b/i,
      /\bcach(e|ing)\b/i,
      /\blatency\b/i,
      /\bedge\s*compute/i,
      /\bperformance\b/i,
      /\boptimiz/i,
      /\bfaster\b/i,
      /\bload\s*balanc/i,
    ],
    excludePatterns: [/\bhiring\b/i],
  },
  {
    tag: 'Pricing',
    includePatterns: [
      /\bpric(e|ing)\b/i,
      /\bcost\b/i,
      /\btier\b/i,
      /\bfree\s*tier\b/i,
      /\benterprise\s*plan\b/i,
      /\bsubscription\b/i,
      /\bdiscount\b/i,
    ],
    excludePatterns: [],
  },
  {
    tag: 'Developer Platform',
    includePatterns: [
      /\bsdk\b/i,
      /\bapi\b/i,
      /\bcli\b/i,
      /\bterraform\b/i,
      /\bserverless\b/i,
      /\bedge\s*function/i,
      /\bwasm\b/i,
      /\bruntime\b/i,
      /\bwebhook/i,
      /\bgraphql\b/i,
      /\brest\s*api\b/i,
    ],
    excludePatterns: [
      /\bapi\s*security\b/i, // "API security" is Security, not DevPlatform
    ],
  },
  {
    tag: 'Network',
    includePatterns: [
      /\bbgp\b/i,
      /\bmagic\s*transit\b/i,
      /\bsd-?wan\b/i,
      /\bipsec\b/i,
      /\bgre\b/i,
      /\bpeering\b/i,
      /\binterconnect/i,
      /\brouting\b/i,
      /\bdns\b/i,
    ],
    excludePatterns: [],
  },
  {
    tag: 'AI',
    includePatterns: [
      /\bartificial\s*intelligence\b/i,
      /\bmachine\s*learning\b/i,
      /\b(?:gen\s*)?ai\b/i,
      /\bllm\b/i,
      /\blarge\s*language\s*model/i,
      /\bdeep\s*learning\b/i,
      /\bneural\s*network/i,
    ],
    excludePatterns: [],
  },
];

/**
 * Assign tags to an entry based on its title and summary.
 *
 * Returns 1-3 matching tags, or ['General'] if none match.
 */
export function tagEntry(title: string, summary: string): string[] {
  const text = `${title} ${summary}`;
  const tags: string[] = [];

  for (const rule of TAG_RULES) {
    const included = rule.includePatterns.some((p) => p.test(text));
    const excluded = rule.excludePatterns.some((p) => p.test(text));
    if (included && !excluded) {
      tags.push(rule.tag);
    }
  }

  return tags.length > 0 ? tags : ['General'];
}

/**
 * Compute a basic relevance score based on keywords.
 * Phase 5 replaces this with Claude API scoring.
 *
 * Score guide:
 *   90-100: Pricing changes, major product launches, acquisitions
 *   70-89:  Significant features, security advisories
 *   50-69:  Minor updates, blog posts
 *   30-49:  Events, marketing content
 *   0-29:   Hiring posts, noise
 */
export function scoreRelevance(title: string, summary: string): number {
  const text = `${title} ${summary}`.toLowerCase();
  let score = 50; // Base score

  // High-value signals (boost)
  if (/\bpric(e|ing)\b/i.test(text)) score += 30;
  if (/\bacquisition\b/i.test(text)) score += 25;
  if (/\blaunch/i.test(text)) score += 15;
  if (/\bgenerally\s*available\b/i.test(text)) score += 15;
  if (/\bbeta\b/i.test(text)) score += 10;
  if (/\bnew\s*feature/i.test(text)) score += 10;
  if (/\bvulnerabilit/i.test(text)) score += 10;
  if (/\bcve-\d/i.test(text)) score += 15;
  if (/\bdeprecated?\b/i.test(text)) score += 10;

  // Low-value signals (penalize)
  if (/\bhiring\b/i.test(text)) score -= 30;
  if (/\bjob\b/i.test(text)) score -= 25;
  if (/\bcareer/i.test(text)) score -= 25;
  if (/\bconference\b/i.test(text)) score -= 15;
  if (/\bwebinar\b/i.test(text)) score -= 15;
  if (/\bevent\b/i.test(text)) score -= 10;
  if (/\baward/i.test(text)) score -= 10;
  if (/\bsponsored\b/i.test(text)) score -= 20;

  return Math.max(0, Math.min(100, score));
}
