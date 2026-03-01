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
