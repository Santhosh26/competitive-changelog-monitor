/**
 * Sources API routes — manage monitored competitor sources.
 *
 * Routes:
 *   GET    /              — list all sources with health status
 *   POST   /              — add a new source (SSRF-validated)
 *   PUT    /:id           — update source config
 *   DELETE /:id           — remove a source
 *   POST   /:id/check     — trigger immediate check for one source
 *   POST   /discover      — auto-discover sources for a domain
 */

import { Hono } from 'hono';
import { Env } from '../env';
import { SourcesRepo } from '../storage/sources-repo';
import { validateUrl } from '../security/url-validator';
import { discoverSources } from '../ingestion/source-discovery';
import { getAdapter } from '../ingestion/adapter-factory';
import { HealthRepo } from '../storage/health-repo';
import { processRawContent } from '../cron/process-job';

const VALID_SOURCE_TYPES = ['rss', 'atom', 'api', 'html', 'browser'] as const;
// Source IDs can be UUIDs or custom strings (e.g. "src_cloudflare_blog")
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

const sources = new Hono<{ Bindings: Env }>();

// ─── GET / — List all sources ────────────────────────────────────────
sources.get('/', async (c) => {
  const repo = new SourcesRepo(c.env.DB);
  const data = await repo.list();
  return c.json({ data, total: data.length });
});

// ─── POST / — Add a new source ──────────────────────────────────────
sources.post('/', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Validate required fields
  const { competitor_name, source_url, source_type } = body;

  if (!competitor_name || typeof competitor_name !== 'string') {
    return c.json({ error: 'competitor_name is required (string)' }, 400);
  }
  if (competitor_name.length > 100) {
    return c.json(
      { error: 'competitor_name must be 100 characters or fewer' },
      400,
    );
  }

  if (!source_url || typeof source_url !== 'string') {
    return c.json({ error: 'source_url is required (string)' }, 400);
  }

  if (
    !source_type ||
    !VALID_SOURCE_TYPES.includes(source_type as any)
  ) {
    return c.json(
      {
        error: `source_type must be one of: ${VALID_SOURCE_TYPES.join(', ')}`,
      },
      400,
    );
  }

  // SSRF validation on the URL
  const urlCheck = validateUrl(source_url);
  if (!urlCheck.valid) {
    console.warn(
      `[sources] SSRF blocked on create: ${source_url} — ${urlCheck.reason}`,
    );
    return c.json(
      { error: `URL validation failed: ${urlCheck.reason}` },
      400,
    );
  }

  const parser_config = body.parser_config || '{}';
  if (typeof parser_config !== 'string') {
    return c.json({ error: 'parser_config must be a JSON string' }, 400);
  }
  // Validate parser_config is valid JSON
  try {
    JSON.parse(parser_config);
  } catch {
    return c.json({ error: 'parser_config must be valid JSON' }, 400);
  }

  const check_interval_hours = body.check_interval_hours || 6;
  if (
    typeof check_interval_hours !== 'number' ||
    check_interval_hours < 1 ||
    check_interval_hours > 168
  ) {
    return c.json(
      { error: 'check_interval_hours must be a number between 1 and 168' },
      400,
    );
  }

  const id = crypto.randomUUID();
  const repo = new SourcesRepo(c.env.DB);

  await repo.create({
    id,
    competitor_name,
    source_url,
    source_type,
    parser_config,
    check_interval_hours,
  });

  return c.json({ id, status: 'created' }, 201);
});

// ─── PUT /:id — Update a source ─────────────────────────────────────
sources.put('/:id', async (c) => {
  const id = c.req.param('id');
  if (!VALID_ID_REGEX.test(id)) {
    return c.json({ error: 'Invalid source ID format' }, 400);
  }

  const repo = new SourcesRepo(c.env.DB);
  const existing = await repo.getById(id);
  if (!existing) {
    return c.json({ error: 'Source not found' }, 404);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Validate source_url if provided
  if (body.source_url) {
    const urlCheck = validateUrl(body.source_url);
    if (!urlCheck.valid) {
      console.warn(
        `[sources] SSRF blocked on update: ${body.source_url} — ${urlCheck.reason}`,
      );
      return c.json(
        { error: `URL validation failed: ${urlCheck.reason}` },
        400,
      );
    }
  }

  // Validate source_type if provided
  if (
    body.source_type &&
    !VALID_SOURCE_TYPES.includes(body.source_type)
  ) {
    return c.json(
      {
        error: `source_type must be one of: ${VALID_SOURCE_TYPES.join(', ')}`,
      },
      400,
    );
  }

  // Validate parser_config if provided
  if (body.parser_config !== undefined) {
    if (typeof body.parser_config !== 'string') {
      return c.json({ error: 'parser_config must be a JSON string' }, 400);
    }
    try {
      JSON.parse(body.parser_config);
    } catch {
      return c.json({ error: 'parser_config must be valid JSON' }, 400);
    }
  }

  // Validate check_interval_hours if provided
  if (body.check_interval_hours !== undefined) {
    if (
      typeof body.check_interval_hours !== 'number' ||
      body.check_interval_hours < 1 ||
      body.check_interval_hours > 168
    ) {
      return c.json(
        { error: 'check_interval_hours must be a number between 1 and 168' },
        400,
      );
    }
  }

  // Validate competitor_name if provided
  if (body.competitor_name !== undefined) {
    if (typeof body.competitor_name !== 'string' || !body.competitor_name) {
      return c.json({ error: 'competitor_name must be a non-empty string' }, 400);
    }
    if (body.competitor_name.length > 100) {
      return c.json(
        { error: 'competitor_name must be 100 characters or fewer' },
        400,
      );
    }
  }

  await repo.update(id, {
    competitor_name: body.competitor_name,
    source_url: body.source_url,
    source_type: body.source_type,
    parser_config: body.parser_config,
    check_interval_hours: body.check_interval_hours,
    enabled: body.enabled,
  });

  return c.json({ status: 'updated' });
});

// ─── DELETE /:id — Remove a source ──────────────────────────────────
sources.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!VALID_ID_REGEX.test(id)) {
    return c.json({ error: 'Invalid source ID format' }, 400);
  }

  const repo = new SourcesRepo(c.env.DB);
  const existing = await repo.getById(id);
  if (!existing) {
    return c.json({ error: 'Source not found' }, 404);
  }

  await repo.delete(id);
  return c.json({ status: 'deleted' });
});

// ─── POST /:id/check — Trigger immediate check ─────────────────────
sources.post('/:id/check', async (c) => {
  const id = c.req.param('id');
  if (!VALID_ID_REGEX.test(id)) {
    return c.json({ error: 'Invalid source ID format' }, 400);
  }

  const repo = new SourcesRepo(c.env.DB);
  const source = await repo.getById(id);
  if (!source) {
    return c.json({ error: 'Source not found' }, 404);
  }

  // Validate URL
  const urlCheck = validateUrl(source.source_url);
  if (!urlCheck.valid) {
    return c.json(
      { error: `Source URL failed SSRF validation: ${urlCheck.reason}` },
      400,
    );
  }

  const healthRepo = new HealthRepo(c.env.DB);

  try {
    const adapter = getAdapter(source.source_type);
    const fetchResult = await adapter.fetch(
      source.source_url,
      source.parser_config || '{}',
      c.env,
    );

    const processResult = await processRawContent(source, fetchResult, c.env);

    await healthRepo.recordSuccess(
      source.id,
      fetchResult.http_status,
      fetchResult.response_time_ms,
      processResult.newEntries,
    );

    return c.json({
      status: 'ok',
      fetch: {
        http_status: fetchResult.http_status,
        content_length: fetchResult.content_length,
        response_time_ms: fetchResult.response_time_ms,
      },
      process: processResult,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    await healthRepo.recordFailure(source.id, null, message);
    return c.json({ status: 'error', error: message }, 500);
  }
});

// ─── POST /discover — Auto-discover sources for a domain ────────────
sources.post('/discover', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { domain } = body;
  if (!domain || typeof domain !== 'string') {
    return c.json({ error: 'domain is required (string, e.g. "akamai.com")' }, 400);
  }

  // Basic domain validation
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
    return c.json({ error: 'Invalid domain format' }, 400);
  }

  const discovered = await discoverSources(domain);
  return c.json({ domain, sources: discovered, total: discovered.length });
});

export default sources;
