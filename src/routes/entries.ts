/**
 * Entries API routes — query and manage competitive intelligence entries.
 *
 * Routes:
 *   GET   /             — list entries with filters & pagination
 *   GET   /search       — full-text search across titles and summaries
 *   GET   /:id          — get a single entry with full details
 *   PATCH /:id          — mark as reviewed/actioned
 */

import { Hono } from 'hono';
import { Env } from '../env';
import { EntriesRepo } from '../storage/entries-repo';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

const entries = new Hono<{ Bindings: Env }>();

// ─── GET / — List entries with filters ──────────────────────────────
entries.get('/', async (c) => {
  const repo = new EntriesRepo(c.env.DB);

  // Parse query parameters
  const competitor = c.req.query('competitor');
  const tag = c.req.query('tag');
  const days = c.req.query('days');
  const reviewed = c.req.query('reviewed');
  const minRelevance = c.req.query('min_relevance');
  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');

  // Validate numeric params
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

  if (isNaN(limit) || limit < 1 || limit > 100) {
    return c.json({ error: 'limit must be a number between 1 and 100' }, 400);
  }
  if (isNaN(offset) || offset < 0) {
    return c.json({ error: 'offset must be a non-negative number' }, 400);
  }

  // Compute 'since' date from 'days' param
  let since: string | undefined;
  if (days) {
    const daysNum = parseInt(days, 10);
    if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
      return c.json(
        { error: 'days must be a number between 1 and 365' },
        400,
      );
    }
    since = new Date(
      Date.now() - daysNum * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  // Parse reviewed boolean
  let reviewedBool: boolean | undefined;
  if (reviewed !== undefined) {
    if (reviewed === 'true') reviewedBool = true;
    else if (reviewed === 'false') reviewedBool = false;
    else {
      return c.json(
        { error: 'reviewed must be "true" or "false"' },
        400,
      );
    }
  }

  // Parse min relevance
  let minRelevanceNum: number | undefined;
  if (minRelevance !== undefined) {
    minRelevanceNum = parseInt(minRelevance, 10);
    if (isNaN(minRelevanceNum) || minRelevanceNum < 0 || minRelevanceNum > 100) {
      return c.json(
        { error: 'min_relevance must be a number between 0 and 100' },
        400,
      );
    }
  }

  // Validate string params (basic length check)
  if (competitor && competitor.length > 100) {
    return c.json({ error: 'competitor must be 100 characters or fewer' }, 400);
  }
  if (tag && tag.length > 50) {
    return c.json({ error: 'tag must be 50 characters or fewer' }, 400);
  }

  const result = await repo.query({
    competitor,
    tag,
    since,
    reviewed: reviewedBool,
    minRelevance: minRelevanceNum,
    limit,
    offset,
  });

  return c.json({
    data: result.data,
    total: result.total,
    limit,
    offset,
  });
});

// ─── GET /search — Full-text search ─────────────────────────────────
entries.get('/search', async (c) => {
  const q = c.req.query('q');
  if (!q || q.trim().length === 0) {
    return c.json({ error: 'q query parameter is required' }, 400);
  }
  if (q.length > 200) {
    return c.json(
      { error: 'Search query must be 200 characters or fewer' },
      400,
    );
  }

  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

  if (isNaN(limit) || limit < 1 || limit > 100) {
    return c.json({ error: 'limit must be a number between 1 and 100' }, 400);
  }
  if (isNaN(offset) || offset < 0) {
    return c.json({ error: 'offset must be a non-negative number' }, 400);
  }

  const repo = new EntriesRepo(c.env.DB);
  const result = await repo.search(q.trim(), limit, offset);

  return c.json({
    data: result.data,
    total: result.total,
    limit,
    offset,
    query: q.trim(),
  });
});

// ─── GET /:id — Get a single entry ──────────────────────────────────
entries.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!VALID_ID_REGEX.test(id)) {
    return c.json({ error: 'Invalid entry ID format' }, 400);
  }

  const repo = new EntriesRepo(c.env.DB);
  const entry = await repo.getById(id);

  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  return c.json({ data: entry });
});

// ─── PATCH /:id — Mark as reviewed/actioned ─────────────────────────
entries.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!VALID_ID_REGEX.test(id)) {
    return c.json({ error: 'Invalid entry ID format' }, 400);
  }

  const repo = new EntriesRepo(c.env.DB);
  const existing = await repo.getById(id);
  if (!existing) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.reviewed !== undefined) {
    if (typeof body.reviewed !== 'boolean') {
      return c.json({ error: 'reviewed must be a boolean' }, 400);
    }
    await repo.markReviewed(id, body.reviewed);
  }

  if (body.actioned !== undefined) {
    if (typeof body.actioned !== 'boolean') {
      return c.json({ error: 'actioned must be a boolean' }, 400);
    }
    await repo.markActioned(id, body.actioned);
  }

  return c.json({ status: 'updated' });
});

export default entries;
