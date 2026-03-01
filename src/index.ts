import { Hono } from 'hono';
import { Env } from './env';
import { requireAuth } from './security/auth';
import { orchestrateFetchJob, orchestrateDigestJob } from './cron/orchestrator';
import sourcesRoutes from './routes/sources';
import entriesRoutes from './routes/entries';
import healthRoutes from './routes/health';
import actionsRoutes from './routes/actions';
import digestRoutes from './routes/digest';
import { classifyEntry, getUsageStats } from './processing/ai-classifier';
import { computeFinalRelevance } from './delivery/relevance-scorer';
import { EntriesRepo } from './storage/entries-repo';

const app = new Hono<{ Bindings: Env }>();

// ─── Security headers (CSP, frame options, content-type sniffing) ────
app.use('*', async (c, next) => {
  await next();
  // Content Security Policy: strict sandbox, no inline scripts, only HTTPS resources
  c.header('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +        // No inline scripts, no external scripts
    "style-src 'self' 'unsafe-inline'; " + // Styles (unsafe-inline for framework injected styles)
    "img-src 'self' https: data:; " + // Images from self, HTTPS, data URIs
    "connect-src 'self'; " +       // API calls only to self
    "frame-src 'none'; " +          // No iframes
    "object-src 'none'; " +         // No plugins
    "base-uri 'self'; " +           // Restrict base URL
    "form-action 'self'"            // Form submission only to self
  );
  c.header('X-Content-Type-Options', 'nosniff');  // Don't sniff MIME types
  c.header('X-Frame-Options', 'DENY');             // Disable framing
  c.header('X-XSS-Protection', '1; mode=block');   // Legacy XSS protection
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// ─── Health check (no auth required) ────────────────────────────────
app.get('/', (c) =>
  c.json({ status: 'ok', service: 'competitive-changelog-monitor' }),
);

// ─── Trigger endpoint (protected) ────────────────────────────────────
// Runs the fetch job synchronously and returns results (unlike the cron
// handler which uses waitUntil and returns immediately).
app.post('/api/trigger/fetch', requireAuth, async (c) => {
  const result = await orchestrateFetchJob(c.env);
  return c.json({ status: 'ok', ...result });
});

// ─── AI classification endpoints (protected) ─────────────────────────

// GET /api/ai/usage — current month's Claude API usage and budget
app.get('/api/ai/usage', requireAuth, async (c) => {
  const stats = await getUsageStats(c.env.KV);
  return c.json({ data: stats });
});

// POST /api/ai/backfill — re-classify all existing entries with AI
app.post('/api/ai/backfill', requireAuth, async (c) => {
  const entriesRepo = new EntriesRepo(c.env.DB);
  const limitParam = new URL(c.req.url).searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  // Get entries that haven't been AI-classified yet (no ai_summary)
  const result = await c.env.DB
    .prepare(
      'SELECT id, title, summary, competitor_name, is_update FROM entries WHERE ai_summary IS NULL OR ai_summary = ? ORDER BY first_seen_at DESC LIMIT ?',
    )
    .bind('', limit)
    .all<{ id: string; title: string; summary: string; competitor_name: string; is_update: number }>();

  const entries = result.results || [];
  let classified = 0;
  let failed = 0;
  let aiUsed = 0;
  let keywordUsed = 0;

  for (const entry of entries) {
    try {
      const classification = await classifyEntry(
        entry.title,
        entry.summary || '',
        entry.competitor_name,
        c.env.ANTHROPIC_API_KEY,
        c.env.KV,
      );

      const finalRelevance = computeFinalRelevance(
        classification.relevance,
        { tags: classification.tags, is_update: Boolean(entry.is_update) },
        {},
      );

      await entriesRepo.updateClassification(
        entry.id,
        classification.tags,
        finalRelevance,
        classification.aiSummary || null,
      );

      if (classification.source === 'ai') aiUsed++;
      else keywordUsed++;
      classified++;
    } catch (err: any) {
      console.error(`[backfill] Failed to classify "${entry.title}": ${err.message}`);
      failed++;
    }
  }

  return c.json({
    status: 'ok',
    total: entries.length,
    classified,
    failed,
    ai_used: aiUsed,
    keyword_fallback: keywordUsed,
  });
});

// ─── API routes (all protected by Cloudflare Access JWT) ────────────
app.use('/api/*', requireAuth);
app.route('/api/sources', sourcesRoutes);
app.route('/api/entries', entriesRoutes);
app.route('/api/health', healthRoutes);
app.route('/api/actions', actionsRoutes);
app.route('/api/digest', digestRoutes);

// ─── Export Worker handlers ──────────────────────────────────────────
export default {
  fetch: app.fetch,

  /**
   * Cron handler — Cloudflare calls this on schedule.
   *
   * We differentiate between the two cron triggers using event.cron:
   * - "0 *​/6 * * *"  → Fetch all enabled sources (every 6 hours)
   * - "0 8 * * 1"    → Generate and send the weekly digest (Monday 8 AM UTC)
   *
   * ctx.waitUntil() tells the runtime to keep the Worker alive until the
   * async operation completes. Without it, the Worker terminates as soon
   * as the scheduled() handler returns — before our fetches finish.
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ) {
    switch (event.cron) {
      case '0 */6 * * *':
        // Every 6 hours: fetch sources, parse, store
        ctx.waitUntil(orchestrateFetchJob(env));
        break;
      case '0 8 * * 1':
        // Every Monday 8 AM UTC: generate and send digest
        ctx.waitUntil(orchestrateDigestJob(env));
        break;
      default:
        // Local dev: wrangler dev triggers with empty cron string.
        // Default to fetch job so we can test the pipeline locally.
        console.log(`[cron] Local trigger (no cron pattern) — running fetch job`);
        ctx.waitUntil(orchestrateFetchJob(env));
    }
  },
};
