/**
 * Health API routes — source health monitoring dashboard.
 *
 * Routes:
 *   GET  /                — all sources with health status (green/yellow/red)
 *   GET  /:sourceId       — detailed health for one source
 *   POST /:sourceId/reset — reset a disabled source back to healthy
 */

import { Hono } from 'hono';
import { Env } from '../env';
import { HealthRepo } from '../storage/health-repo';
import { SourcesRepo } from '../storage/sources-repo';

// Source IDs can be UUIDs or custom strings (e.g. "src_cloudflare_blog")
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

/**
 * Map health status to a traffic-light color for the dashboard.
 */
function statusToColor(
  status: string | null,
): 'green' | 'yellow' | 'red' | 'gray' {
  switch (status) {
    case 'healthy':
      return 'green';
    case 'degraded':
      return 'yellow';
    case 'failing':
    case 'disabled':
      return 'red';
    default:
      return 'gray'; // No health record yet
  }
}

const health = new Hono<{ Bindings: Env }>();

// ─── GET / — All sources with health status ─────────────────────────
health.get('/', async (c) => {
  const healthRepo = new HealthRepo(c.env.DB);
  const sourcesRepo = new SourcesRepo(c.env.DB);

  const sources = await sourcesRepo.list();
  const allHealth = await healthRepo.getAllHealth();

  // Build a map of source_id → health record
  const healthMap = new Map(allHealth.map((h) => [h.source_id, h]));

  const data = sources.map((source) => {
    const h = healthMap.get(source.id);
    return {
      source_id: source.id,
      competitor_name: source.competitor_name,
      source_type: source.source_type,
      source_url: source.source_url,
      enabled: Boolean(source.enabled),
      color: statusToColor(h?.status || null),
      status: h?.status || 'unknown',
      consecutive_failures: h?.consecutive_failures || 0,
      last_error: h?.last_error || null,
      last_check_at: h?.last_check_at || null,
      avg_response_ms: h?.avg_response_ms || 0,
      total_entries_found: h?.total_entries_found || 0,
    };
  });

  return c.json({ data, total: data.length });
});

// ─── GET /:sourceId — Detailed health for one source ────────────────
health.get('/:sourceId', async (c) => {
  const sourceId = c.req.param('sourceId');
  if (!VALID_ID_REGEX.test(sourceId)) {
    return c.json({ error: 'Invalid source ID format' }, 400);
  }

  const sourcesRepo = new SourcesRepo(c.env.DB);
  const source = await sourcesRepo.getById(sourceId);
  if (!source) {
    return c.json({ error: 'Source not found' }, 404);
  }

  const healthRepo = new HealthRepo(c.env.DB);
  const h = await healthRepo.getHealth(sourceId);

  return c.json({
    data: {
      source_id: source.id,
      competitor_name: source.competitor_name,
      source_type: source.source_type,
      source_url: source.source_url,
      enabled: Boolean(source.enabled),
      color: statusToColor(h?.status || null),
      status: h?.status || 'unknown',
      consecutive_failures: h?.consecutive_failures || 0,
      last_http_status: h?.last_http_status || null,
      last_error: h?.last_error || null,
      last_check_at: h?.last_check_at || null,
      avg_response_ms: h?.avg_response_ms || 0,
      total_entries_found: h?.total_entries_found || 0,
    },
  });
});

// ─── POST /:sourceId/reset — Reset a disabled source ────────────────
health.post('/:sourceId/reset', async (c) => {
  const sourceId = c.req.param('sourceId');
  if (!VALID_ID_REGEX.test(sourceId)) {
    return c.json({ error: 'Invalid source ID format' }, 400);
  }

  const sourcesRepo = new SourcesRepo(c.env.DB);
  const source = await sourcesRepo.getById(sourceId);
  if (!source) {
    return c.json({ error: 'Source not found' }, 404);
  }

  const healthRepo = new HealthRepo(c.env.DB);
  await healthRepo.resetHealth(sourceId);

  return c.json({ status: 'reset', source_id: sourceId });
});

export default health;
