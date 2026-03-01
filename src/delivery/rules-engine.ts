/**
 * Rules engine — apply user-configured filter/highlight rules to entries.
 *
 * Rules can:
 * - Exclude entries (filter them out)
 * - Include entries (keep only matching ones)
 * - Highlight entries (visual emphasis in digest)
 * - Notify immediately (real-time alert)
 *
 * Example rules:
 * - "Exclude relevance < 30" (filter noise)
 * - "Highlight Pricing tags" (visual emphasis)
 * - "Notify immediately when Akamai releases Security content" (real-time)
 */

import { Entry, Rule } from '../types';

/**
 * Apply user-configured rules to a list of entries.
 *
 * Rules are evaluated in priority order (highest first).
 * - Exclude/Include rules filter the list
 * - Highlight/Notify rules are metadata markers (don't filter)
 */
export async function applyRules(
  entries: Entry[],
  rules: Rule[],
): Promise<Entry[]> {
  if (!rules || rules.length === 0) {
    return entries; // No rules — return all entries
  }

  // Sort by priority (highest first)
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  let filtered = [...entries];

  // Apply exclude/include rules (these filter the list)
  for (const rule of sortedRules) {
    if (rule.action === 'exclude' || rule.action === 'include') {
      filtered = filtered.filter((entry) => {
        const matches = evaluateCondition(entry, rule);
        // Exclude: keep entry if it does NOT match
        // Include: keep entry if it DOES match
        return rule.action === 'exclude' ? !matches : matches;
      });
    }
  }

  // Apply highlight/notify rules (these add metadata, don't filter)
  for (const entry of filtered) {
    for (const rule of sortedRules) {
      if (rule.action === 'highlight' || rule.action === 'notify_immediately') {
        if (evaluateCondition(entry, rule)) {
          // Mark for highlight/notify — we could add fields to Entry
          // For now, just a marker (Phase 7 implements actual highlights)
          if (rule.action === 'notify_immediately') {
            console.log(
              `[rules] Immediate notify rule triggered for entry "${entry.title}"`,
            );
          }
        }
      }
    }
  }

  return filtered;
}

/**
 * Evaluate whether an entry matches a rule condition.
 */
function evaluateCondition(entry: Entry, rule: Rule): boolean {
  const { condition_field, condition_operator, condition_value } = rule;

  // Get the field value from the entry
  let fieldValue: any;
  switch (condition_field) {
    case 'competitor_name':
      fieldValue = entry.competitor_name;
      break;
    case 'tags':
      fieldValue = entry.tags;
      break;
    case 'relevance_score':
      fieldValue = entry.relevance_score;
      break;
    case 'title':
      fieldValue = entry.title;
      break;
    default:
      return false; // Unknown field
  }

  // Evaluate condition
  const value = condition_value;

  switch (condition_operator) {
    case 'equals':
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(value); // For tags array
      }
      return fieldValue === value;

    case 'contains':
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v: string) =>
          v.toLowerCase().includes(value.toLowerCase()),
        );
      }
      if (typeof fieldValue === 'string') {
        return fieldValue.toLowerCase().includes(value.toLowerCase());
      }
      return false;

    case 'greater_than':
      const numValue = parseFloat(value);
      return typeof fieldValue === 'number' && fieldValue > numValue;

    case 'less_than':
      const numValue2 = parseFloat(value);
      return typeof fieldValue === 'number' && fieldValue < numValue2;

    default:
      return false;
  }
}
