/**
 * Actions API routes — log and query intelligence actions on entries.
 *
 * Routes:
 *   POST /:entryId/action  — log an action (reviewed, battlecard_updated, shared, etc.)
 *   GET  /:entryId/actions — get action history for an entry
 */

import { Hono } from 'hono';
import { Env } from '../env';
import { ActionsRepo } from '../storage/actions-repo';
import { EntriesRepo } from '../storage/entries-repo';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;
const VALID_ACTION_TYPES = [
  'reviewed',
  'battlecard_updated',
  'shared',
  'dismissed',
  'noted',
] as const;

const actions = new Hono<{ Bindings: Env }>();

// ─── POST /:entryId/action — Log an action ──────────────────────────
actions.post('/:entryId/action', async (c) => {
  const entryId = c.req.param('entryId');
  if (!VALID_ID_REGEX.test(entryId)) {
    return c.json({ error: 'Invalid entry ID format' }, 400);
  }

  // Verify entry exists
  const entriesRepo = new EntriesRepo(c.env.DB);
  const entry = await entriesRepo.getById(entryId);
  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { action_type, note } = body;

  if (!action_type || !VALID_ACTION_TYPES.includes(action_type)) {
    return c.json(
      {
        error: `action_type must be one of: ${VALID_ACTION_TYPES.join(', ')}`,
      },
      400,
    );
  }

  if (note !== undefined && note !== null && typeof note !== 'string') {
    return c.json({ error: 'note must be a string or null' }, 400);
  }
  if (note && note.length > 1000) {
    return c.json(
      { error: 'note must be 1000 characters or fewer' },
      400,
    );
  }

  const actionsRepo = new ActionsRepo(c.env.DB);
  const id = crypto.randomUUID();

  await actionsRepo.logAction({
    id,
    entry_id: entryId,
    action_type,
    note: note || null,
  });

  return c.json({ id, status: 'logged' }, 201);
});

// ─── GET /:entryId/actions — Get action history ─────────────────────
actions.get('/:entryId/actions', async (c) => {
  const entryId = c.req.param('entryId');
  if (!VALID_ID_REGEX.test(entryId)) {
    return c.json({ error: 'Invalid entry ID format' }, 400);
  }

  // Verify entry exists
  const entriesRepo = new EntriesRepo(c.env.DB);
  const entry = await entriesRepo.getById(entryId);
  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  const actionsRepo = new ActionsRepo(c.env.DB);
  const data = await actionsRepo.getByEntryId(entryId);

  return c.json({ data, total: data.length });
});

export default actions;
