# Learnings — Competitive Changelog Monitor

## Phase 1: Foundation, Schema & Security Scaffolding

### Schema Design Rationale
- **7 tables** covering the full lifecycle: sources → entries → snapshots → digests → rules → actions → health
- **Separate `source_health` table** rather than embedding health fields in `sources` — cleaner separation of concerns, health data changes frequently while source config is mostly static
- **`snapshots` table + R2** split: hash in D1 for fast comparison, full HTML in R2 for detailed diffing later. D1 has row size limits; R2 handles large objects with no egress fees
- **`cluster_id` in entries** enables deduplication — group the same announcement seen across RSS, blog, and changelog into one cluster
- **`parser_config` as JSON** in sources — each competitor site has different HTML structure, so CSS selectors are per-source, not hardcoded

### Two Cron Schedules
- **Every 6 hours** (`0 */6 * * *`): Fetch sources — frequent enough to catch updates same-day, not so frequent we get rate-limited by competitor sites
- **Every Monday 8 AM UTC** (`0 8 * * 1`): Send weekly digest — once a week prevents notification fatigue while keeping you current

### SSRF Protection Approach
- **Validate before every fetch** — even previously-valid URLs, because source configs can be modified
- **HTTPS only** — blocks most internal targets (which use HTTP) and prevents downgrade attacks
- **Block all private IP ranges** (RFC 1918, link-local, loopback) — prevents targeting cloud metadata endpoints (169.254.169.254) and internal networks
- **Block bare IPs** — require domain names with valid TLDs, so attackers can't bypass DNS
- **Block Cloudflare internal domains** (.workers.dev, .pages.dev) — prevents self-reference loops
- **Standard port only** (443) — no attacking services on unusual ports

### Key Concepts Learned
- **Cron triggers**: Cloudflare calls the Worker's `scheduled` handler on a cron schedule. Unlike `fetch`, there's no incoming HTTP request — use `event.cron` to differentiate schedules
- **`ctx.waitUntil()`**: Keeps the Worker alive until the Promise resolves. Without it, async operations (D1 writes, R2 puts) would be killed when the handler returns
- **Wrangler secrets vs env vars**: `wrangler secret put` encrypts at rest, only available to deployed Worker. `wrangler.toml` is committed to git — never put secrets there. `.dev.vars` is the local equivalent (in .gitignore)

## Phase 2: Multi-Adapter Ingestion

### Adapter Pattern
- **Factory pattern** (`getAdapter(sourceType)`) returns the correct adapter based on source config. The orchestrator doesn't care how content is fetched — it just calls `adapter.fetch()` and gets a uniform `FetchResult`.
- **4 tiers**: RSS(1) → API(2) → Static HTML(3) → Browser Rendering(4). Always pick the lightest that works.
- Adding a new adapter (e.g., Sitemap, Twitter/X) only requires implementing the `SourceAdapter` interface and adding a case to the factory — zero changes to orchestration code.

### Shared Safe-Fetch Utility
- Centralizing SSRF validation + response size limits in `safe-fetch.ts` ensures every adapter gets security controls automatically. If each adapter implemented its own fetch, a future adapter might forget the SSRF check.
- **Streaming body reader** for responses without Content-Length: reads chunks and counts bytes, aborting if total exceeds 5MB. Prevents OOM on Workers' 128MB memory limit.
- Custom `SafeFetchError` with typed `code` field enables callers to distinguish SSRF blocks from timeouts from size limits.

### Browser Rendering API
- Cloudflare runs headless Chromium at the edge. The Worker can launch a browser, navigate to a page, wait for JS to render, and extract the DOM.
- **Resource interception**: blocking images, fonts, and stylesheets during browser rendering speeds it up significantly and reduces cost.
- **Last resort only**: ~5-15s per page vs ~200ms for RSS. Limited to 2 concurrent sessions on paid plan.

### JS-Rendered Site Detection
- The HTML adapter detects JS-rendered pages by checking text-to-HTML ratio and SPA mount points (`<div id="root"></div>`). Logs a warning suggesting the browser adapter.
- **Fastly's blog is a confirmed SPA** — returned 217KB of HTML but almost no text content. Needs browser adapter for real content extraction.

### Source Health Tracking
- **4 states**: healthy → degraded (1-4 fails) → failing (5-9) → disabled (10+, auto-disabled)
- Health records use D1 upserts (`INSERT ... ON CONFLICT ... DO UPDATE`) for atomic updates
- Auto-disabling after 10 failures prevents a broken source from wasting cron time forever

### Real-World Findings
- **Cloudflare Blog RSS**: 482KB, ~880ms — works perfectly with RSS adapter
- **AWS What's New RSS**: 219KB, ~510ms — works perfectly with RSS adapter
- **Fastly Blog**: No RSS feed available. HTML adapter fetches but detects it's JS-rendered. Needs browser adapter for actual content.

### Local Dev Notes
- `wrangler dev` scheduled trigger via `/cdn-cgi/handler/scheduled` sends empty `event.cron` — need a default case in the handler
- For testing, a synchronous `POST /api/trigger/fetch` endpoint is much more useful than the async scheduled trigger
- R2 objects stored locally in `.wrangler/state/v3/r2/` — can inspect blob sizes to verify fetches
