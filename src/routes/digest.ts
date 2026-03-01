/**
 * Digest API routes — generate and manage digests.
 *
 * Routes:
 *   POST /generate  — generate and send a digest immediately
 *   GET  /          — list recent digests
 *   GET  /:id       — get a specific digest
 */

import { Hono } from 'hono';
import { Env } from '../env';
import { generateAndSendDigest } from '../cron/digest-job';
import { DigestsRepo } from '../storage/digests-repo';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

const digest = new Hono<{ Bindings: Env }>();

// ─── POST /generate — Generate digest immediately ──────────────────
digest.post('/generate', async (c) => {
  let daysBack = 7;
  const daysParam = new URL(c.req.url).searchParams.get('days');
  if (daysParam) {
    const parsed = parseInt(daysParam, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 365) {
      daysBack = parsed;
    } else {
      return c.json({ error: 'days must be between 1 and 365' }, 400);
    }
  }

  try {
    const result = await generateAndSendDigest(c.env, {
      daysBack,
      sendTelegram: true,
      sendSlack: false,
    });

    return c.json(
      {
        status: 'ok',
        digest_id: result.digestId,
        entries_count: result.entriesCount,
        sent: result.sent,
      },
      201,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[digest-api] Generate failed: ${message}`);
    return c.json({ error: `Digest generation failed: ${message}` }, 500);
  }
});

// ─── GET / — List recent digests ────────────────────────────────────
digest.get('/', async (c) => {
  const repo = new DigestsRepo(c.env.DB);
  const limitParam = new URL(c.req.url).searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 20;

  if (isNaN(limit) || limit < 1 || limit > 100) {
    return c.json({ error: 'limit must be between 1 and 100' }, 400);
  }

  const data = await repo.list({ limit });

  return c.json({
    data,
    total: data.length,
    limit,
  });
});

// ─── GET /:id — Get a specific digest ────────────────────────────────
digest.get('/:id', async (c) => {
  const id = c.req.param('id');

  if (!VALID_ID_REGEX.test(id)) {
    return c.json({ error: 'Invalid digest ID format' }, 400);
  }

  const result = await c.env.DB
    .prepare('SELECT * FROM digests WHERE id = ?')
    .bind(id)
    .first();

  if (!result) {
    return c.json({ error: 'Digest not found' }, 404);
  }

  return c.json({ data: result });
});

export default digest;
