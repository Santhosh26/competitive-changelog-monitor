/**
 * AI-powered classifier — uses Claude Haiku for semantic tagging & relevance.
 *
 * WHY CLAUDE HAIKU?
 * Classification is a lightweight task — Haiku is 10x cheaper than Opus and fast
 * enough for batch processing. At ~$0.001 per entry, processing 100 entries/week
 * costs ~$0.40/month.
 *
 * FALLBACK: If the Claude API is unavailable, rate-limited, or returns invalid
 * JSON, we fall back to the keyword tagger from Phase 3. Classification failures
 * must never prevent entries from being stored.
 *
 * COST MANAGEMENT: Monthly usage is tracked in KV. If the budget cap is exceeded,
 * all classification falls back to keywords for the rest of the month.
 */

import { tagEntry, scoreRelevance } from './tagger';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;

/** Monthly budget cap in USD. Falls back to keyword tagger if exceeded. */
const MONTHLY_BUDGET_CAP_USD = 5.0;

/** Approximate cost per 1K input tokens for Haiku */
const INPUT_COST_PER_1K = 0.001;
/** Approximate cost per 1K output tokens for Haiku */
const OUTPUT_COST_PER_1K = 0.005;

const VALID_TAGS = [
  'Security',
  'Zero Trust',
  'Performance',
  'Pricing',
  'Developer Platform',
  'Network',
  'AI',
  'Acquisition',
  'Partnership',
  'General',
];

export interface AiConfig {
  model?: string;
  maxTokens?: number;
  budgetCap?: number;
  apiKey?: string;
  enabled?: boolean;
}

export interface ClassificationResult {
  tags: string[];
  relevance: number;
  aiSummary: string;
  source: 'ai' | 'keyword'; // Which classifier was used
}

interface UsageRecord {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  calls: number;
}

/**
 * Classify an entry using Claude API, with fallback to keyword tagger.
 *
 * @param title - Entry title (sanitized plain text)
 * @param summary - Entry summary (sanitized plain text)
 * @param competitorName - Competitor name for context
 * @param apiKey - Anthropic API key
 * @param kv - KV namespace for cost tracking
 */
export async function classifyEntry(
  title: string,
  summary: string,
  competitorName: string,
  apiKey: string,
  kv: KVNamespace,
  config?: AiConfig,
): Promise<ClassificationResult> {
  const effectiveKey = config?.apiKey || apiKey;
  const enabled = config?.enabled ?? true;
  const budgetCap = config?.budgetCap ?? MONTHLY_BUDGET_CAP_USD;

  // If AI is disabled via settings, use keyword fallback directly
  if (!enabled) {
    return fallbackClassify(title, summary);
  }

  // Check if we have a valid API key
  if (!effectiveKey || effectiveKey === 'sk-ant-xxx' || effectiveKey.length < 10) {
    return fallbackClassify(title, summary);
  }

  // Check monthly budget before calling API
  const budgetOk = await checkBudget(kv, budgetCap);
  if (!budgetOk) {
    console.log('[ai-classifier] Monthly budget exceeded, using keyword fallback');
    return fallbackClassify(title, summary);
  }

  try {
    const model = config?.model ?? CLAUDE_MODEL;
    const maxTokens = config?.maxTokens ?? MAX_TOKENS;
    const result = await callClaudeAPI(title, summary, competitorName, effectiveKey, model, maxTokens);

    // Track usage
    await trackUsage(kv, result.usage.input_tokens, result.usage.output_tokens);

    return {
      tags: result.tags,
      relevance: result.relevance,
      aiSummary: result.summary,
      source: 'ai',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[ai-classifier] Claude API failed, falling back to keywords: ${message}`);
    return fallbackClassify(title, summary);
  }
}

/**
 * Fallback: use the Phase 3 keyword tagger + scorer.
 */
function fallbackClassify(title: string, summary: string): ClassificationResult {
  return {
    tags: tagEntry(title, summary),
    relevance: scoreRelevance(title, summary),
    aiSummary: '',
    source: 'keyword',
  };
}

/**
 * Call the Claude API for classification.
 */
async function callClaudeAPI(
  title: string,
  summary: string,
  competitorName: string,
  apiKey: string,
  model: string = CLAUDE_MODEL,
  maxTokens: number = MAX_TOKENS,
): Promise<{
  tags: string[];
  relevance: number;
  summary: string;
  usage: { input_tokens: number; output_tokens: number };
}> {
  // Truncate summary to avoid excessive token usage
  const truncatedSummary = summary.length > 500 ? summary.slice(0, 500) + '...' : summary;

  const prompt = `Classify this competitor product update.

Competitor: ${competitorName}
Title: ${title}
Summary: ${truncatedSummary}

Respond in JSON only:
{
  "tags": ["<1-3 tags from: Security, Zero Trust, Performance, Pricing, Developer Platform, Network, AI, Acquisition, Partnership, General>"],
  "relevance": <0-100 integer. 90-100: pricing/major launch. 70-89: significant feature. 50-69: minor update. 0-49: noise/hiring/marketing>,
  "summary": "<One sentence: what this means for a Cloudflare SE competing against this vendor>"
}

Rules:
- Pricing changes, product launches, and acquisition news are always 80+ relevance
- Hiring posts, marketing fluff, and event announcements are always below 30
- Bug fixes and minor updates are 40-60
- The summary should be actionable for a sales engineer, not just descriptive`;

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Claude API ${response.status}: ${errorBody.slice(0, 200)}`);
  }

  const result: any = await response.json();

  // Extract the text content from Claude's response
  const textContent = result.content?.find((c: any) => c.type === 'text');
  if (!textContent?.text) {
    throw new Error('No text content in Claude response');
  }

  // Parse JSON from Claude's response (may be wrapped in ```json ... ```)
  const parsed = parseClassificationJSON(textContent.text);

  return {
    tags: parsed.tags,
    relevance: parsed.relevance,
    summary: parsed.summary,
    usage: result.usage || { input_tokens: 0, output_tokens: 0 },
  };
}

/**
 * Parse and validate the JSON classification output from Claude.
 * Handles cases where Claude wraps JSON in markdown code blocks.
 */
function parseClassificationJSON(text: string): {
  tags: string[];
  relevance: number;
  summary: string;
} {
  // Strip markdown code fences if present
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Invalid JSON from Claude: ${jsonStr.slice(0, 200)}`);
  }

  // Validate and sanitize tags
  const tags: string[] = [];
  if (Array.isArray(parsed.tags)) {
    for (const tag of parsed.tags.slice(0, 3)) {
      if (typeof tag === 'string' && VALID_TAGS.includes(tag)) {
        tags.push(tag);
      }
    }
  }
  if (tags.length === 0) tags.push('General');

  // Validate relevance score
  let relevance = 50;
  if (typeof parsed.relevance === 'number') {
    relevance = Math.max(0, Math.min(100, Math.round(parsed.relevance)));
  }

  // Validate summary
  let summary = '';
  if (typeof parsed.summary === 'string') {
    // Truncate excessively long summaries
    summary = parsed.summary.slice(0, 300);
  }

  return { tags, relevance, summary };
}

// ─── Cost Tracking ──────────────────────────────────────────────────

/**
 * Get the KV key for the current month's usage.
 */
function getUsageKey(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `claude-usage:${yyyy}-${mm}`;
}

/**
 * Check if we're within the monthly budget.
 */
async function checkBudget(kv: KVNamespace, budgetCap: number = MONTHLY_BUDGET_CAP_USD): Promise<boolean> {
  const key = getUsageKey();
  const raw = await kv.get(key);
  if (!raw) return true; // No usage yet this month

  try {
    const usage: UsageRecord = JSON.parse(raw);
    return usage.cost_usd < budgetCap;
  } catch {
    return true; // Corrupted record, allow
  }
}

/**
 * Track token usage and estimated cost for this API call.
 */
async function trackUsage(
  kv: KVNamespace,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const key = getUsageKey();
  const callCost =
    (inputTokens / 1000) * INPUT_COST_PER_1K +
    (outputTokens / 1000) * OUTPUT_COST_PER_1K;

  let usage: UsageRecord = {
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    calls: 0,
  };

  const raw = await kv.get(key);
  if (raw) {
    try {
      usage = JSON.parse(raw);
    } catch {
      // Reset corrupted record
    }
  }

  usage.input_tokens += inputTokens;
  usage.output_tokens += outputTokens;
  usage.cost_usd += callCost;
  usage.calls += 1;

  // Store with 35-day TTL (auto-cleanup old months)
  await kv.put(key, JSON.stringify(usage), { expirationTtl: 35 * 24 * 60 * 60 });
}

/**
 * Get current month's usage stats (for API/dashboard).
 */
export async function getUsageStats(kv: KVNamespace, budgetCap?: number): Promise<UsageRecord & { budget_remaining: number; budget_cap: number }> {
  const key = getUsageKey();
  const raw = await kv.get(key);
  const cap = budgetCap ?? MONTHLY_BUDGET_CAP_USD;

  const usage: UsageRecord = raw
    ? JSON.parse(raw)
    : { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0 };

  return {
    ...usage,
    budget_remaining: Math.max(0, cap - usage.cost_usd),
    budget_cap: cap,
  };
}
