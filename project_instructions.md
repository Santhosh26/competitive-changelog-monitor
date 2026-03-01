# Competitive Changelog Monitor — A Competitive Intelligence Platform on Cloudflare

## Project Overview

Competitive Changelog Monitor is a **competitive intelligence platform** — not just a URL scraper — that automatically discovers, fetches, parses, diffs, classifies, and delivers structured intelligence about competitor product moves. It monitors blogs, changelogs, release notes, RSS feeds, and documentation pages across multiple competitors, detects what actually changed, classifies updates by relevance, and delivers actionable digests via Telegram, Slack, or email.

**Learning goal:** Build a production-grade, security-hardened platform using Cloudflare Workers (cron triggers, Browser Rendering API), D1 (relational modeling, change tracking), KV (caching, rate-limit counters), R2 (content snapshots), Pages (dashboard), and Access (authentication). This project goes significantly deeper than SecureNotes or TranscriptGrabber — it introduces multi-adapter architectures, content diffing, AI-powered classification, security hardening against SSRF/XSS, and a simple workflow/rules engine.

**Why this matters for your role:** As a Principal SE covering the ME region, you track Akamai, Zscaler, Fastly, Palo Alto, Fortinet, AWS CloudFront, Azure Front Door, and Google Cloud CDN. Instead of manually checking 10+ sites, this platform delivers a weekly digest you can forward to sales, use to update battlecards, or reference before a customer meeting. It also serves as a demo of Cloudflare's platform capabilities — cron workers, Browser Rendering, D1, Access — in a single real-world application.

**Tech stack:**
- Backend: Cloudflare Workers (TypeScript) with cron triggers
- Rendering: Cloudflare Browser Rendering API (for JS-rendered sites)
- Database: D1 (sources, entries, snapshots, digests, rules, source health)
- Cache: KV (source config, rate-limit counters, fetch dedup)
- Snapshots: R2 (full-page HTML snapshots for diffing)
- Classification: Claude API (semantic tagging and summarization)
- Notifications: Telegram Bot API, Slack Webhooks, email (Mailgun/SendGrid)
- Frontend: Cloudflare Pages (dashboard)
- Auth: Cloudflare Access (protect dashboard and API)
- Framework: Hono (lightweight, Workers-native)
- Parsing: Cheerio (static HTML), fast-xml-parser (RSS/Atom), DOMPurify (sanitization)

---

## Architecture Overview

This platform has five layers. Each phase builds one or more layers incrementally.

```
+------------------------------------------------------------------+
|                       CONTROL PLANE                               |
|  Sources Config  |  User Rules/Filters  |  Notification Prefs    |
|  (D1 + KV)       |  (D1)                |  (D1 + Wrangler Secrets)|
+--------+---------+----------------------+------------------------+
         |
+--------v---------------------------------------------------------+
|                      INGESTION LAYER                              |
|                                                                   |
|  +------------+  +------------+  +-------------+  +------------+ |
|  | RSS/Atom   |  | Static     |  | Browser     |  | API-based  | |
|  | Adapter    |  | HTML       |  | Rendering   |  | Adapter    | |
|  | (Tier 1)   |  | Adapter    |  | Adapter     |  | (Tier 2)   | |
|  |            |  | (Tier 3)   |  | (Tier 4)    |  |            | |
|  +------+-----+  +------+-----+  +------+------+  +-----+------+ |
|         |               |               |               |        |
|         +-------+-------+-------+-------+               |        |
|                 |                                        |        |
|          URL Validator  <------  SSRF Protection         |        |
|          Response Size Limiter                           |        |
|          Source Health Tracker                            |        |
+--------+------------------------------------------------+--------+
         |
+--------v---------------------------------------------------------+
|                     PROCESSING LAYER                              |
|                                                                   |
|  Parser -----> Snapshot & Differ -----> Deduplicator -----> Tagger|
|  (extract     (hash content,           (fuzzy-match       (keyword|
|   structured   detect changes,          across sources,    then AI |
|   entries)     store in R2)             group clusters)    classify)|
+--------+---------------------------------------------------------+
         |
+--------v---------------------------------------------------------+
|                      STORAGE LAYER                                |
|                                                                   |
|  D1: sources, entries, snapshots, digests, rules, source_health  |
|  KV: source config cache, rate-limit counters, fetch locks       |
|  R2: raw HTML snapshots (for diffing), exported digests          |
+---------+--------------------------------------------------------+
          |
+---------v--------------------------------------------------------+
|                      DELIVERY LAYER                               |
|                                                                   |
|  Rules Engine -------> Filter entries by user preferences        |
|  Relevance Scorer ---> Rank by importance (pricing > bug fix)    |
|  Digest Builder -----> Format (text, HTML, Markdown)             |
|  Notifier -----------> Telegram / Slack / Email                  |
+---------+--------------------------------------------------------+
          |
+---------v--------------------------------------------------------+
|                    PRESENTATION LAYER                              |
|                                                                   |
|  Cloudflare Pages Dashboard (behind Cloudflare Access):          |
|  - Browse entries by competitor, tag, date                       |
|  - Search across all stored intelligence                         |
|  - View content diffs (what changed on a page)                   |
|  - Source health dashboard (green/yellow/red per source)         |
|  - "Act on it" actions: link to battlecard, mark as reviewed     |
|  - Historical trend analysis: where is each competitor investing?|
+------------------------------------------------------------------+
```

### Source Adapter Priority (Which Fetching Strategy to Use)

Not all competitor sites are equal. The architecture uses a tiered adapter system:

| Tier | Adapter | When to Use | Reliability | Example |
|------|---------|-------------|-------------|---------|
| **1** | RSS/Atom | Site publishes a structured feed | Highest — structured data, rarely breaks | Most tech blogs have `/feed` or `/rss` |
| **2** | API-based | Site exposes a JSON API or search endpoint | High — structured, but may require auth | GitHub Releases API, Algolia search APIs |
| **3** | Static HTML | Site renders content server-side | Medium — works if site structure doesn't change | Simple WordPress blogs |
| **4** | Browser Rendering | Site uses client-side JS rendering (React, Next.js) | Lower — resource-intensive, slower | Modern SPA blogs (Akamai, Zscaler) |

**Critical insight:** Many modern competitor blogs (Akamai, Zscaler, Palo Alto) use client-side rendering. A raw `fetch()` returns an empty `<div id="root"></div>`. Cheerio cannot parse this — it only works on static HTML. For these sites, you **must** use Cloudflare's Browser Rendering API, which gives you a headless Chromium instance inside a Worker. Always try RSS first, then API, then static HTML, then Browser Rendering as a last resort.

---

## Who I Am

Santhosh Kumar — Principal Solutions Engineer at Cloudflare, 18 years AppSec background (OpenText Fortify, SAST/DAST). I'm learning Cloudflare's platform hands-on. I've already built SecureNotes (full CRUD app with Workers, D1, R2, KV, WAF, Access) and TranscriptGrabber (Workers, KV caching, D1 search, R2 exports). I have solid familiarity with Workers, D1, R2, KV, and basic Access/Zero Trust.

This project introduces new territory: **cron triggers**, **Browser Rendering API**, **content diffing**, **external API integrations** (Telegram, Claude API), **security hardening** (SSRF, XSS, input validation), and **multi-adapter architectures**. Explain these new concepts as we build — I'll pick up fast on everything else.

## How to Work With Me

- **Explain new Cloudflare concepts.** Cron triggers, Browser Rendering API, Wrangler secrets — these are new. Briefly explain why we're using each (2-3 sentences). Skip re-explaining Workers, D1, R2, KV basics I already know from SecureNotes.
- **Explain security decisions thoroughly.** With my AppSec background, I want to understand *why* each security control exists. When we add SSRF protection, explain the attack vector. When we sanitize HTML, explain the XSS risk. This is where I go deep.
- **Build incrementally but with security from Day 1.** Don't bolt security on at the end. Every phase should include the security controls for that phase's features.
- **Test before deploying.** Use `wrangler dev` locally. For cron triggers, use `wrangler dev --test-scheduled` to trigger crons manually.
- **Link to docs.** Cloudflare docs for new features (cron triggers, Browser Rendering), OWASP references for security controls.
- **Ask me about design decisions.** Multiple valid approaches exist throughout (e.g., Cheerio vs Browser Rendering per source, keyword tagger vs AI classifier). Present tradeoffs and let me decide.
- **Keep it demo-ready.** This should be something I'd proudly show a customer as an example of Cloudflare's platform capabilities.

## Prerequisites

Before starting, ensure:
- [ ] Cloudflare account (already set up from SecureNotes)
- [ ] **Workers Paid plan** ($5/month) — required for Browser Rendering API and higher cron limits
- [ ] Node.js v18+ installed
- [ ] Wrangler CLI installed and logged in (`wrangler whoami`)
- [ ] Familiarity with Workers, D1, R2, KV basics (from SecureNotes Phase 1)
- [ ] Telegram account and a bot created via BotFather (for notifications)
- [ ] Anthropic API key (for Claude-powered classification in Phase 5 — can skip initially)
- [ ] Basic understanding of RSS/Atom feeds (we'll learn the rest as we build)

If any prerequisite is missing, help me set it up before starting Phase 1.

## Folder Structure

```
competitive-changelog-monitor/
├── CLAUDE.md                          # This file (project instructions)
├── wrangler.toml                      # Wrangler config: cron triggers, bindings, secrets
├── package.json
├── tsconfig.json
├── .dev.vars                          # Local dev secrets (NEVER commit — in .gitignore)
├── .gitignore
├── src/
│   ├── index.ts                       # Main Worker: request handler + scheduled handler
│   ├── types.ts                       # All TypeScript interfaces and types
│   ├── env.ts                         # Env type definition (D1, KV, R2 bindings)
│   │
│   ├── routes/                        # API route handlers (Hono)
│   │   ├── sources.ts                 # CRUD for monitored sources
│   │   ├── entries.ts                 # Query entries (filter, search, paginate)
│   │   ├── digests.ts                 # Digest history and retrieval
│   │   ├── health.ts                  # Source health dashboard data
│   │   └── actions.ts                 # "Act on intelligence" actions (mark reviewed, link battlecard)
│   │
│   ├── ingestion/                     # Source adapters (Tier 1-4)
│   │   ├── adapter-factory.ts         # Returns correct adapter based on source_type
│   │   ├── rss-adapter.ts             # Tier 1: RSS/Atom feed parser
│   │   ├── api-adapter.ts             # Tier 2: JSON API adapter (GitHub releases, etc.)
│   │   ├── html-adapter.ts            # Tier 3: Static HTML scraper (Cheerio)
│   │   ├── browser-adapter.ts         # Tier 4: Browser Rendering API for JS-rendered sites
│   │   └── source-discovery.ts        # Auto-probe a domain for RSS/changelog URLs
│   │
│   ├── processing/                    # Content processing pipeline
│   │   ├── parser.ts                  # Extract structured entries from raw content
│   │   ├── differ.ts                  # Content snapshot hashing and diff detection
│   │   ├── deduplicator.ts            # Cross-source duplicate detection (fuzzy matching)
│   │   └── tagger.ts                  # Keyword tagger (Phase 3) + AI classifier (Phase 5)
│   │
│   ├── delivery/                      # Digest generation and notification
│   │   ├── digest-builder.ts          # Format digests (text, HTML, Markdown)
│   │   ├── relevance-scorer.ts        # Rank entries by importance
│   │   ├── rules-engine.ts            # User-configured filter rules
│   │   └── notifier.ts               # Send via Telegram / Slack / Email
│   │
│   ├── security/                      # Security utilities
│   │   ├── url-validator.ts           # SSRF protection: validate URLs, block private IPs
│   │   ├── sanitizer.ts              # HTML sanitization (DOMPurify wrapper)
│   │   ├── rate-limiter.ts           # Per-source and per-API rate limiting
│   │   └── auth.ts                   # Access JWT validation for API routes
│   │
│   ├── storage/                       # Data access layer
│   │   ├── sources-repo.ts            # D1 queries for sources table
│   │   ├── entries-repo.ts            # D1 queries for entries table
│   │   ├── snapshots-repo.ts          # D1 + R2 queries for content snapshots
│   │   ├── digests-repo.ts            # D1 queries for digests table
│   │   └── health-repo.ts            # D1 queries for source_health table
│   │
│   └── cron/                          # Scheduled job orchestration
│       ├── orchestrator.ts            # Main cron handler: coordinates the full pipeline
│       ├── fetch-job.ts               # Step 1: Fetch all enabled sources
│       ├── process-job.ts             # Step 2: Parse, diff, dedup, tag
│       └── deliver-job.ts             # Step 3: Generate digest, send notifications
│
├── migrations/
│   ├── 0001_create_sources.sql
│   ├── 0002_create_entries.sql
│   ├── 0003_create_snapshots.sql
│   ├── 0004_create_digests.sql
│   ├── 0005_create_source_health.sql
│   ├── 0006_create_rules.sql
│   └── 0007_create_actions.sql
│
├── frontend/                          # Cloudflare Pages dashboard
│   ├── index.html                     # Main dashboard page
│   ├── style.css                      # Styles
│   └── app.js                         # Frontend logic
│
├── test-data/                         # Sample HTML/RSS for local testing
│   ├── akamai-blog-sample.html
│   ├── zscaler-blog-sample.html
│   ├── fastly-rss-sample.xml
│   └── github-releases-sample.json
│
└── notes/
    └── learnings.md                   # What you learned building this
```

---

## Known Architectural Challenges (Read Before Building)

These are real problems you will hit. Every phase is designed to address them, but you should understand them upfront so you don't make early decisions that paint you into a corner.

### Challenge 1: Most Competitor Blogs Use Client-Side Rendering

A raw `fetch("https://www.akamai.com/blog")` returns a nearly empty HTML shell. The actual blog content is loaded by JavaScript after the page renders in a browser. **Cheerio cannot parse JavaScript-rendered content.** It only works on the raw HTML returned by the server.

**Solution:** The source adapter pattern (Phase 2) uses Cloudflare's **Browser Rendering API** for JS-rendered sites. This gives you a headless Chromium instance running inside a Worker. You navigate to the page, wait for JS to render, then extract the fully-rendered HTML. This is slower and more expensive than RSS or static HTML, so we use it only as a last resort — the adapter factory picks the lightest adapter that works for each source.

**Cloudflare docs:** https://developers.cloudflare.com/browser-rendering/

### Challenge 2: Content Changes vs. New Content

Competitor intelligence isn't just "what new blog posts appeared." It's also:
- A pricing page quietly changes from "$99/month" to "$149/month"
- A feature page updates from "Beta" to "Generally Available"
- A documentation page adds a new API endpoint
- A changelog entry is retroactively edited

The original design only detected new entries. The revised architecture stores **content snapshots** (full-page HTML saved to R2, with a SHA-256 hash stored in D1). On each fetch, we hash the new content and compare it to the last snapshot. If the hash differs, we store a new snapshot and flag the entry as "updated." This gives us a full change history.

### Challenge 3: Cross-Source Deduplication

If Akamai announces a new feature, it might appear on their blog, their changelog, their RSS feed, and their Twitter — all within the same day. Without deduplication, your digest shows the same announcement 4 times.

**Solution:** A deduplication layer (Phase 3) uses fuzzy title matching (normalized Levenshtein distance) and same-competitor + same-day heuristics to group related entries into clusters. The digest shows one entry per cluster, with a note like "(also seen on: changelog, RSS)."

### Challenge 4: Keyword Tagging Is Not Enough

A keyword tagger that checks `if (title.includes("security"))` will:
- False positive: "We're hiring a Security Engineer" (not a product update)
- False negative: "New behavioral API protection engine" (is security, but doesn't say "security")

**Solution:** Phase 3 starts with keyword tagging (good enough for v1). Phase 5 upgrades to Claude API semantic classification — send title + summary to Claude with a structured prompt, get back accurate tags and a relevance score. This is not optional for production use; keyword tagging alone makes digests too noisy.

### Challenge 5: Security (SSRF, XSS, Secrets, Auth)

This application fetches content from user-configured URLs and renders external HTML in a dashboard. Both of these are high-risk attack surfaces:

- **SSRF:** A malicious source URL like `http://169.254.169.254/latest/meta-data/` could target cloud metadata endpoints. Every URL must be validated before fetching.
- **Stored XSS:** Raw HTML from competitor sites stored in D1 and rendered in the dashboard could execute malicious JavaScript. All external content must be sanitized before rendering.
- **Secret leakage:** Telegram tokens, Claude API keys, and Mailgun keys must never appear in code or `wrangler.toml`. Use Wrangler secrets exclusively.
- **Unauthenticated access:** Without Cloudflare Access, anyone who discovers the dashboard URL can read your competitive intelligence.

Security controls are integrated into every phase, not bolted on at the end.

---

## Phase 1 — Foundation, Schema & Security Scaffolding

**Goal:** Set up the project, design a comprehensive D1 schema (with content snapshots, source health, and rules tables), configure cron triggers, and build the security utilities that every subsequent phase depends on.

**What you'll learn:** D1 relational modeling with change tracking, cron triggers, Wrangler secrets, SSRF protection patterns, URL validation.

### Steps

1. **Initialize the project**
   - Scaffold the folder structure above
   - Run `npm init -y` and install core dependencies:
     ```bash
     npm install hono
     npm install -D typescript @cloudflare/workers-types wrangler
     ```
   - Set up `tsconfig.json` for Workers (target: ESNext, module: ESNext, moduleResolution: Bundler)
   - Create a basic Hono app in `src/index.ts` with a health check route (`GET /` returns `{ status: "ok" }`)
   - Explain: What is a cron trigger? How does the `scheduled` event handler differ from the `fetch` handler?

2. **Configure `wrangler.toml` with cron trigger and bindings**
   ```toml
   name = "competitive-changelog-monitor"
   main = "src/index.ts"
   compatibility_date = "2025-02-27"
   compatibility_flags = ["nodejs_compat"]

   # Cron triggers — two schedules:
   # 1. Fetch sources every 6 hours (frequent enough to catch updates quickly)
   # 2. Send digest every Monday at 8 AM UTC (weekly summary)
   [triggers]
   crons = ["0 */6 * * *", "0 8 * * 1"]

   # D1 Database
   [[d1_databases]]
   binding = "DB"
   database_name = "competitive-changelog-monitor-db"
   database_id = "<your-d1-id>"

   # KV Namespace (config cache, rate-limit counters)
   [[kv_namespaces]]
   binding = "KV"
   id = "<your-kv-id>"

   # R2 Bucket (content snapshots)
   [[r2_buckets]]
   binding = "SNAPSHOTS"
   bucket_name = "changelog-monitor-snapshots"

   # Browser Rendering (for JS-rendered sites — requires Workers Paid plan)
   [browser]
   binding = "BROWSER"
   ```

   Explain: Why two cron schedules? The fetch cron runs every 6 hours so you catch competitor updates within the same day. The digest cron runs weekly so you're not overwhelmed with notifications. We differentiate between them in the `handleScheduled` handler by checking `event.cron`.

3. **Set up Wrangler secrets (NEVER store secrets in wrangler.toml or code)**
   ```bash
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHAT_ID
   wrangler secret put ANTHROPIC_API_KEY
   ```
   For local development, create `.dev.vars`:
   ```
   TELEGRAM_BOT_TOKEN=your-token-here
   TELEGRAM_CHAT_ID=your-chat-id
   ANTHROPIC_API_KEY=sk-ant-xxx
   ```
   Add `.dev.vars` to `.gitignore` immediately.

   Explain: Why Wrangler secrets instead of environment variables in `wrangler.toml`? Because `wrangler.toml` is committed to git. Secrets set via `wrangler secret put` are encrypted at rest and only available to the deployed Worker. `.dev.vars` is for local development only and must never be committed.

4. **Define the TypeScript types (`src/types.ts`)**
   ```typescript
   // A monitored source (competitor blog, changelog, RSS feed)
   export interface Source {
     id: string;
     competitor_name: string;
     source_url: string;
     source_type: 'rss' | 'atom' | 'api' | 'html' | 'browser';
     parser_config: string;       // JSON: CSS selectors, API paths, etc. per source
     check_interval_hours: number; // How often to check (default: 6)
     enabled: boolean;
     last_checked_at: string | null;
     last_success_at: string | null;
     consecutive_failures: number;
     created_at: string;
   }

   // A parsed entry (a single competitor update)
   export interface Entry {
     id: string;
     source_id: string;
     competitor_name: string;
     title: string;
     summary: string;            // Plain text summary (sanitized)
     content_url: string;        // Direct URL to the original entry
     published_at: string | null;
     tags: string[];             // ["Security", "API", "Pricing"]
     relevance_score: number;    // 0-100 (higher = more important)
     ai_summary: string | null;  // Claude-generated one-liner (Phase 5)
     is_update: boolean;         // true if this is a change to existing content
     cluster_id: string | null;  // Links to dedup cluster
     first_seen_at: string;
     last_seen_at: string;
     reviewed: boolean;          // User has seen this
     actioned: boolean;          // User has taken action (e.g., updated battlecard)
   }

   // A content snapshot (for change detection)
   export interface Snapshot {
     id: string;
     source_id: string;
     content_hash: string;       // SHA-256 of the page content
     r2_key: string;             // Key in R2 bucket for the full HTML
     captured_at: string;
     content_length: number;
   }

   // Source health record
   export interface SourceHealth {
     source_id: string;
     status: 'healthy' | 'degraded' | 'failing' | 'disabled';
     last_http_status: number | null;
     last_error: string | null;
     last_check_at: string;
     avg_response_ms: number;
     consecutive_failures: number;
     total_entries_found: number;
   }

   // A digest notification
   export interface Digest {
     id: string;
     digest_type: 'scheduled' | 'on_demand';
     period_start: string;
     period_end: string;
     entry_count: number;
     competitor_count: number;
     sent_via: string;           // 'telegram', 'slack', 'email'
     sent_at: string | null;
     created_at: string;
   }

   // A user-configured filter rule
   export interface Rule {
     id: string;
     name: string;
     condition_field: 'competitor_name' | 'tags' | 'relevance_score' | 'title';
     condition_operator: 'equals' | 'contains' | 'greater_than' | 'less_than';
     condition_value: string;
     action: 'include' | 'exclude' | 'highlight' | 'notify_immediately';
     enabled: boolean;
   }

   // Adapter result — what each source adapter returns
   export interface FetchResult {
     raw_content: string;
     content_type: 'html' | 'xml' | 'json';
     http_status: number;
     response_time_ms: number;
     content_length: number;
   }

   // Parsed entry before storage (pre-ID, pre-dedup)
   export interface RawParsedEntry {
     title: string;
     summary: string;
     content_url: string;
     published_at: string | null;
     raw_html_snippet: string;   // For diffing (not for rendering!)
   }
   ```

5. **Build the SSRF-safe URL validator (`src/security/url-validator.ts`)**

   This is a security-critical component. Every URL must pass through this before any fetch.

   ```typescript
   // Validates that a URL is safe to fetch (no SSRF)
   export function validateUrl(url: string): { valid: boolean; reason?: string } {
     // 1. Must be a valid URL
     // 2. Must use HTTPS (never HTTP for external fetches)
     // 3. Must not resolve to a private IP range:
     //    - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC 1918)
     //    - 169.254.0.0/16 (link-local / cloud metadata)
     //    - 127.0.0.0/8 (loopback)
     //    - ::1, fc00::/7 (IPv6 private)
     // 4. Must not target Cloudflare internal domains:
     //    - *.workers.dev, *.pages.dev (self-reference)
     //    - *.cloudflareclient.com
     // 5. Must not use non-standard ports (only 443 for HTTPS)
     // 6. Hostname must have a valid TLD (not "localhost", not bare IPs)
   }
   ```

   **Why this matters (explain to me):** SSRF (Server-Side Request Forgery) is when an attacker tricks your server into making requests to internal resources. Since our app fetches URLs that users configure, a malicious user could set a source URL to `http://169.254.169.254/latest/meta-data/` (AWS metadata endpoint) or `http://127.0.0.1:8080/admin`. Our validator blocks all of these.

   Reference: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery

6. **Build the HTML sanitizer (`src/security/sanitizer.ts`)**
   ```typescript
   // Sanitizes HTML content from external sources before storage or display
   // Uses DOMPurify to strip all scripts, event handlers, and dangerous elements
   // Returns plain text for summaries, sanitized HTML for display
   export function sanitizeForStorage(html: string): string { ... }
   export function sanitizeForDisplay(html: string): string { ... }
   export function extractPlainText(html: string): string { ... }
   ```

   Install: `npm install dompurify` (or use `isomorphic-dompurify` for Workers compatibility — test which works in the Workers runtime)

   **Why this matters:** We store `raw_html_snippet` from competitor sites. If we render this in the dashboard without sanitization, embedded JavaScript from the competitor's site (or a compromised version of it) executes in our browser. This is **Stored XSS**. DOMPurify strips all dangerous elements while preserving safe formatting.

7. **Create the D1 migration files**

   Split into separate migrations for clean versioning:

   **`migrations/0001_create_sources.sql`**
   ```sql
   CREATE TABLE sources (
     id TEXT PRIMARY KEY,
     competitor_name TEXT NOT NULL,
     source_url TEXT NOT NULL,
     source_type TEXT NOT NULL CHECK(source_type IN ('rss', 'atom', 'api', 'html', 'browser')),
     parser_config TEXT DEFAULT '{}',
     check_interval_hours INTEGER DEFAULT 6,
     enabled INTEGER DEFAULT 1,
     last_checked_at TEXT,
     last_success_at TEXT,
     consecutive_failures INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now')),
     UNIQUE(source_url)
   );

   CREATE INDEX idx_sources_competitor ON sources(competitor_name);
   CREATE INDEX idx_sources_enabled ON sources(enabled);
   ```

   **`migrations/0002_create_entries.sql`**
   ```sql
   CREATE TABLE entries (
     id TEXT PRIMARY KEY,
     source_id TEXT NOT NULL,
     competitor_name TEXT NOT NULL,
     title TEXT NOT NULL,
     summary TEXT,
     content_url TEXT NOT NULL,
     published_at TEXT,
     tags TEXT DEFAULT '[]',
     relevance_score INTEGER DEFAULT 50,
     ai_summary TEXT,
     is_update INTEGER DEFAULT 0,
     cluster_id TEXT,
     first_seen_at TEXT DEFAULT (datetime('now')),
     last_seen_at TEXT DEFAULT (datetime('now')),
     reviewed INTEGER DEFAULT 0,
     actioned INTEGER DEFAULT 0,
     FOREIGN KEY (source_id) REFERENCES sources(id),
     UNIQUE(source_id, content_url)
   );

   CREATE INDEX idx_entries_competitor ON entries(competitor_name);
   CREATE INDEX idx_entries_first_seen ON entries(first_seen_at DESC);
   CREATE INDEX idx_entries_tags ON entries(tags);
   CREATE INDEX idx_entries_relevance ON entries(relevance_score DESC);
   CREATE INDEX idx_entries_cluster ON entries(cluster_id);
   CREATE INDEX idx_entries_reviewed ON entries(reviewed);
   ```

   **`migrations/0003_create_snapshots.sql`**
   ```sql
   CREATE TABLE snapshots (
     id TEXT PRIMARY KEY,
     source_id TEXT NOT NULL,
     content_hash TEXT NOT NULL,
     r2_key TEXT NOT NULL,
     content_length INTEGER,
     captured_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (source_id) REFERENCES sources(id)
   );

   CREATE INDEX idx_snapshots_source ON snapshots(source_id, captured_at DESC);
   CREATE INDEX idx_snapshots_hash ON snapshots(content_hash);
   ```

   **`migrations/0004_create_digests.sql`**
   ```sql
   CREATE TABLE digests (
     id TEXT PRIMARY KEY,
     digest_type TEXT NOT NULL CHECK(digest_type IN ('scheduled', 'on_demand')),
     period_start TEXT NOT NULL,
     period_end TEXT NOT NULL,
     entry_count INTEGER DEFAULT 0,
     competitor_count INTEGER DEFAULT 0,
     content TEXT,
     sent_via TEXT,
     sent_at TEXT,
     created_at TEXT DEFAULT (datetime('now'))
   );

   CREATE INDEX idx_digests_created ON digests(created_at DESC);
   ```

   **`migrations/0005_create_source_health.sql`**
   ```sql
   CREATE TABLE source_health (
     source_id TEXT PRIMARY KEY,
     status TEXT DEFAULT 'healthy' CHECK(status IN ('healthy', 'degraded', 'failing', 'disabled')),
     last_http_status INTEGER,
     last_error TEXT,
     last_check_at TEXT,
     avg_response_ms INTEGER DEFAULT 0,
     consecutive_failures INTEGER DEFAULT 0,
     total_entries_found INTEGER DEFAULT 0,
     FOREIGN KEY (source_id) REFERENCES sources(id)
   );
   ```

   **`migrations/0006_create_rules.sql`**
   ```sql
   CREATE TABLE rules (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     condition_field TEXT NOT NULL,
     condition_operator TEXT NOT NULL,
     condition_value TEXT NOT NULL,
     action TEXT NOT NULL CHECK(action IN ('include', 'exclude', 'highlight', 'notify_immediately')),
     priority INTEGER DEFAULT 0,
     enabled INTEGER DEFAULT 1,
     created_at TEXT DEFAULT (datetime('now'))
   );
   ```

   **`migrations/0007_create_actions.sql`**
   ```sql
   CREATE TABLE entry_actions (
     id TEXT PRIMARY KEY,
     entry_id TEXT NOT NULL,
     action_type TEXT NOT NULL CHECK(action_type IN ('reviewed', 'battlecard_updated', 'shared', 'dismissed', 'noted')),
     note TEXT,
     created_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (entry_id) REFERENCES entries(id)
   );

   CREATE INDEX idx_actions_entry ON entry_actions(entry_id);
   ```

8. **Create and run migrations**
   ```bash
   wrangler d1 create competitive-changelog-monitor-db
   # Copy database_id to wrangler.toml

   wrangler kv namespace create CHANGELOG_MONITOR_KV
   # Copy namespace_id to wrangler.toml

   wrangler r2 bucket create changelog-monitor-snapshots

   # Run each migration in order:
   wrangler d1 execute competitive-changelog-monitor-db --file ./migrations/0001_create_sources.sql
   wrangler d1 execute competitive-changelog-monitor-db --file ./migrations/0002_create_entries.sql
   wrangler d1 execute competitive-changelog-monitor-db --file ./migrations/0003_create_snapshots.sql
   wrangler d1 execute competitive-changelog-monitor-db --file ./migrations/0004_create_digests.sql
   wrangler d1 execute competitive-changelog-monitor-db --file ./migrations/0005_create_source_health.sql
   wrangler d1 execute competitive-changelog-monitor-db --file ./migrations/0006_create_rules.sql
   wrangler d1 execute competitive-changelog-monitor-db --file ./migrations/0007_create_actions.sql
   ```

9. **Write the main Worker entry point with both handlers (`src/index.ts`)**
   ```typescript
   import { Hono } from 'hono';
   import { Env } from './env';
   import { orchestrateFetchJob } from './cron/orchestrator';

   const app = new Hono<{ Bindings: Env }>();

   // Health check
   app.get('/', (c) => c.json({ status: 'ok', service: 'competitive-changelog-monitor' }));

   // API routes will be added in later phases
   // app.route('/api/sources', sourcesRoutes);
   // app.route('/api/entries', entriesRoutes);
   // etc.

   export default {
     fetch: app.fetch,

     // Cron handler — Cloudflare calls this on schedule
     async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
       // Differentiate between fetch cron and digest cron
       if (event.cron === '0 */6 * * *') {
         // Every 6 hours: fetch sources, parse, store
         ctx.waitUntil(orchestrateFetchJob(env));
       } else if (event.cron === '0 8 * * 1') {
         // Every Monday 8 AM: generate and send digest
         ctx.waitUntil(orchestrateDigestJob(env));
       }
     }
   };
   ```

   Explain: What is `ctx.waitUntil()`? In a scheduled handler, the Worker terminates as soon as the handler returns. `waitUntil()` tells the runtime to keep the Worker alive until the passed Promise resolves — essential for async operations like fetching sources and writing to D1.

10. **Test the foundation**
    - Run `wrangler dev` and verify the health check returns `{ status: "ok" }`
    - Run `wrangler dev --test-scheduled` to trigger the cron handler manually
    - Query D1 to verify tables exist: `wrangler d1 execute competitive-changelog-monitor-db --command "SELECT name FROM sqlite_master WHERE type='table'"`

### Phase 1 Checkpoint
- [ ] Project scaffolded with all folders and base files
- [ ] `wrangler.toml` configured with D1, KV, R2 bindings and two cron triggers
- [ ] Secrets stored via `wrangler secret put` (not in code or `wrangler.toml`)
- [ ] `.dev.vars` created and `.gitignore` updated
- [ ] All 7 D1 migration files created and executed
- [ ] URL validator built and tested (try private IPs, localhost, valid URLs)
- [ ] HTML sanitizer built (test with `<script>alert(1)</script>` input)
- [ ] Main Worker entry point handles both `fetch` and `scheduled` events
- [ ] `wrangler dev` works, health check returns OK
- [ ] You understand: cron triggers, `waitUntil()`, why secrets must not be in code, SSRF attack vectors

**Break it exercise:** Try passing `http://169.254.169.254/latest/meta-data/` to your URL validator. Then try `http://127.0.0.1:8080`. Then try `https://example.com` (should pass). Verify only the last one is accepted.

**Write notes in `notes/learnings.md`:** Document the schema design rationale, why you chose two cron schedules, and the SSRF protection approach.

---

## Phase 2 — Multi-Adapter Ingestion (Get Content from the Wild)

**Goal:** Build the source adapter system that can fetch content from RSS feeds, static HTML pages, and JS-rendered sites. Include source discovery, SSRF-safe fetching, response size limits, and source health tracking.

**What you'll learn:** Cloudflare Browser Rendering API, RSS/Atom parsing, adapter pattern, source discovery, defensive fetching.

**Prerequisite:** Phase 1 complete — schema exists, URL validator works.

### Steps

1. **Build the adapter factory (`src/ingestion/adapter-factory.ts`)**
   ```typescript
   // Returns the correct adapter based on source_type
   // Each adapter implements: fetch(url, config) => FetchResult
   export function getAdapter(sourceType: Source['source_type']): SourceAdapter {
     switch (sourceType) {
       case 'rss':
       case 'atom':
         return new RssAdapter();
       case 'api':
         return new ApiAdapter();
       case 'html':
         return new HtmlAdapter();
       case 'browser':
         return new BrowserAdapter();
     }
   }
   ```

   Explain: The adapter pattern. Each source type has different fetching logic, but they all return the same `FetchResult` interface. The orchestrator doesn't care how content is fetched — it just calls `adapter.fetch()` and gets a result. This makes it easy to add new adapters later (e.g., a Sitemap adapter, a Twitter/X adapter).

2. **Build the RSS/Atom adapter (`src/ingestion/rss-adapter.ts`) — Tier 1**
   - Install: `npm install fast-xml-parser`
   - Fetch the RSS/Atom feed URL with SSRF-validated `fetch()`
   - Parse XML using `fast-xml-parser`
   - Extract `<item>` (RSS) or `<entry>` (Atom) elements
   - Return structured `FetchResult` with XML content
   - Handle: malformed XML, empty feeds, encoding issues

   **This is the most reliable adapter.** Many competitors publish RSS feeds:
   - Look for `<link rel="alternate" type="application/rss+xml">` in the page HTML
   - Common paths: `/feed`, `/rss`, `/atom.xml`, `/blog/rss`, `/blog/feed`
   - This is why source discovery (Step 5) matters — auto-probe for feeds

3. **Build the static HTML adapter (`src/ingestion/html-adapter.ts`) — Tier 3**
   - Install: `npm install cheerio`
   - Fetch the page with SSRF-validated `fetch()`
   - **Enforce response size limit**: abort if `Content-Length > 5MB`
   - **Set a fetch timeout**: abort after 10 seconds
   - Use proper User-Agent header:
     ```
     User-Agent: CompetitiveChangelogMonitor/1.0 (+https://yourdomain.com; bot)
     ```
   - Return the raw HTML as `FetchResult`
   - **Important:** This adapter only works for server-rendered pages. If the HTML contains `<div id="root"></div>` with no real content, it means the site is JS-rendered and needs the Browser Rendering adapter instead.

4. **Build the Browser Rendering adapter (`src/ingestion/browser-adapter.ts`) — Tier 4**
   ```typescript
   import puppeteer from '@cloudflare/puppeteer';

   export class BrowserAdapter implements SourceAdapter {
     async fetch(url: string, env: Env): Promise<FetchResult> {
       const browser = await puppeteer.launch(env.BROWSER);
       const page = await browser.newPage();

       // Security: set a navigation timeout
       page.setDefaultNavigationTimeout(15000);

       // Navigate and wait for content to render
       await page.goto(url, { waitUntil: 'networkidle0' });

       // Extract the fully-rendered HTML
       const html = await page.content();
       await browser.close();

       return {
         raw_content: html,
         content_type: 'html',
         http_status: 200,
         response_time_ms: /* measure */,
         content_length: html.length
       };
     }
   }
   ```

   Install: `npm install @cloudflare/puppeteer`

   Explain: What is the Browser Rendering API? Cloudflare runs headless Chromium instances at the edge. Your Worker can launch a browser, navigate to a page, wait for JavaScript to render, and extract the DOM. This is the only way to scrape React/Next.js/SPA competitor sites.

   **Costs and limits:**
   - Requires Workers Paid plan
   - Limited browser sessions per account (check current limits in docs)
   - Slower than direct fetch (~5-15 seconds per page vs. ~200ms for RSS)
   - Use sparingly — only for sources that genuinely need JS rendering

   **Cloudflare docs:** https://developers.cloudflare.com/browser-rendering/

5. **Build source discovery (`src/ingestion/source-discovery.ts`)**
   - Given a competitor's domain (e.g., `akamai.com`), auto-probe for:
     - RSS feeds: `/feed`, `/rss`, `/atom.xml`, `/blog/feed`, `/blog/rss.xml`
     - Changelogs: `/changelog`, `/whats-new`, `/releases`, `/release-notes`
     - Documentation updates: `/docs/changelog`, `/api/changelog`
     - GitHub: check for `github.com/{org}` releases
   - For HTML pages, look for `<link rel="alternate" type="application/rss+xml">` tags
   - Return a list of discovered URLs with their type (rss, html, etc.)
   - This saves the user from manually hunting for feed URLs

6. **Integrate SSRF protection into all adapters**
   - Before any `fetch()` call, run the URL through `validateUrl()` from Phase 1
   - If validation fails, log a security warning and skip the source
   - Never fetch a URL that hasn't been validated — even if it was previously valid (URLs can be modified)

7. **Add response size limiting to all adapters**
   ```typescript
   // In each adapter's fetch method:
   const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

   const response = await fetch(url, { /* headers */ });

   // Check Content-Length header first (fast path)
   const contentLength = parseInt(response.headers.get('content-length') || '0');
   if (contentLength > MAX_RESPONSE_BYTES) {
     throw new Error(`Response too large: ${contentLength} bytes (max: ${MAX_RESPONSE_BYTES})`);
   }

   // For responses without Content-Length, read with a size limit
   const reader = response.body?.getReader();
   // ... accumulate chunks, abort if total exceeds MAX_RESPONSE_BYTES
   ```

   **Why:** A competitor site (or a compromised one) could return a 100MB response. Without limits, your Worker would run out of memory (128MB limit) or CPU time (30s on paid plan).

8. **Build source health tracking**
   - After each fetch attempt, update the `source_health` table:
     - On success: set status to `healthy`, reset `consecutive_failures`, update `avg_response_ms`
     - On failure: increment `consecutive_failures`, record `last_error`
     - If `consecutive_failures >= 5`: set status to `failing`
     - If `consecutive_failures >= 10`: set status to `disabled` and skip future fetches
   - This prevents a broken source from slowing down or crashing every cron run

9. **Wire up the cron fetch job (`src/cron/fetch-job.ts`)**
   ```typescript
   export async function fetchAllSources(env: Env): Promise<void> {
     // 1. Get all enabled sources from D1
     // 2. Filter out sources that are 'disabled' in source_health
     // 3. Filter out sources checked within their check_interval_hours
     // 4. For each source:
     //    a. Validate the URL (SSRF check)
     //    b. Get the correct adapter from adapter-factory
     //    c. Fetch content
     //    d. Update source_health
     //    e. Store raw content for processing (or process inline)
     // 5. Log summary: X sources checked, Y succeeded, Z failed
   }
   ```

10. **Seed initial sources**
    - Use the API or `wrangler d1 execute` to insert 3-5 sources:
      - Fastly blog RSS: `https://www.fastly.com/blog/rss.xml` (type: `rss`)
      - Cloudflare blog (for testing — you know the structure): `https://blog.cloudflare.com/rss/` (type: `rss`)
      - A static HTML blog for testing the HTML adapter
      - A JS-rendered blog for testing the Browser Rendering adapter
    - **Start with RSS sources** — they're the most reliable. Add HTML and Browser Rendering sources only after RSS is working.

11. **Test locally**
    - Run `wrangler dev --test-scheduled` to trigger the fetch cron
    - Verify: RSS adapter fetches and returns structured XML
    - Verify: HTML adapter fetches and returns HTML
    - Verify: SSRF-blocked URLs are rejected with a clear error
    - Verify: source_health table is updated after each fetch
    - Verify: oversized responses are aborted

### Phase 2 Checkpoint
- [ ] Adapter factory returns the correct adapter for each source type
- [ ] RSS adapter fetches and parses XML from a real feed
- [ ] HTML adapter fetches static HTML pages
- [ ] Browser Rendering adapter fetches JS-rendered pages (if Workers Paid plan is active)
- [ ] Source discovery finds RSS feeds for a given domain
- [ ] SSRF protection blocks private IPs, localhost, and internal domains
- [ ] Response size limiter aborts oversized responses
- [ ] Source health is tracked in D1 after each fetch
- [ ] Sources with 10+ consecutive failures are auto-disabled
- [ ] Cron fetch job runs end-to-end with 3+ sources

**Break it exercise:** Add a source with URL `http://127.0.0.1:8080/secret`. Verify it's blocked by SSRF protection. Then add a source that returns a 404 consistently — verify it gets marked as `failing` after 5 attempts and `disabled` after 10.

---

## Phase 3 — Processing Pipeline (Parse, Diff, Dedup, Tag)

**Goal:** Build the processing layer that transforms raw fetched content into structured, deduplicated, tagged entries with change detection.

**What you'll learn:** Content parsing strategies, SHA-256 hashing for change detection, fuzzy string matching for deduplication, R2 for snapshot storage.

**Prerequisite:** Phase 2 complete — adapters fetch content successfully.

### Steps

1. **Build the content parser (`src/processing/parser.ts`)**

   The parser takes raw content (HTML or XML) and returns an array of `RawParsedEntry` objects.

   **For RSS/Atom feeds:**
   ```typescript
   export function parseRss(xml: string): RawParsedEntry[] {
     // Use fast-xml-parser to parse
     // Extract: title, link, pubDate/published, description/summary
     // Handle both RSS 2.0 (<item>) and Atom (<entry>) formats
     // Sanitize HTML in descriptions using sanitizer from Phase 1
   }
   ```

   **For HTML pages (per-source parser config):**
   - Different blogs have different HTML structures. The `parser_config` JSON field on each source stores CSS selectors specific to that site:
     ```json
     {
       "article_selector": "article.blog-post",
       "title_selector": "h2.post-title a",
       "date_selector": "time[datetime]",
       "summary_selector": "p.post-excerpt",
       "link_attribute": "href"
     }
     ```
   - The parser uses Cheerio with these selectors to extract entries
   - **Fallback selectors** if per-source config isn't set: try `<article>`, `<h1>`, `<h2>`, `<time>`, `<meta name="description">`

   Explain: Why per-source parser config? Because every website has different HTML structure. Akamai's blog uses different CSS classes than Zscaler's. By storing selectors per source, we can handle any site without changing code — just update the config.

2. **Build the content differ (`src/processing/differ.ts`)**
   ```typescript
   import { createHash } from 'node:crypto';

   export function hashContent(content: string): string {
     // Normalize: strip whitespace, lowercase, remove dynamic elements (timestamps, ads)
     const normalized = normalizeForDiff(content);
     return createHash('sha256').update(normalized).digest('hex');
   }

   export async function detectChanges(
     sourceId: string,
     newContent: string,
     env: Env
   ): Promise<{ isNew: boolean; isChanged: boolean; previousHash?: string }> {
     const newHash = hashContent(newContent);

     // Get the most recent snapshot for this source
     const lastSnapshot = await env.DB.prepare(
       'SELECT content_hash FROM snapshots WHERE source_id = ? ORDER BY captured_at DESC LIMIT 1'
     ).bind(sourceId).first();

     if (!lastSnapshot) {
       // First time seeing this source — store snapshot, return isNew
       await storeSnapshot(sourceId, newContent, newHash, env);
       return { isNew: true, isChanged: false };
     }

     if (lastSnapshot.content_hash === newHash) {
       // Content hasn't changed
       return { isNew: false, isChanged: false, previousHash: lastSnapshot.content_hash };
     }

     // Content changed! Store new snapshot
     await storeSnapshot(sourceId, newContent, newHash, env);
     return { isNew: false, isChanged: true, previousHash: lastSnapshot.content_hash };
   }

   async function storeSnapshot(sourceId: string, content: string, hash: string, env: Env) {
     const r2Key = `snapshots/${sourceId}/${Date.now()}.html`;

     // Store full HTML in R2 (for future diffing)
     await env.SNAPSHOTS.put(r2Key, content);

     // Store metadata in D1
     await env.DB.prepare(
       'INSERT INTO snapshots (id, source_id, content_hash, r2_key, content_length) VALUES (?, ?, ?, ?, ?)'
     ).bind(crypto.randomUUID(), sourceId, hash, r2Key, content.length).run();
   }
   ```

   **Why R2 for snapshots?** Full HTML pages can be 100KB-1MB each. Storing them in D1 (which has row size limits) isn't practical. R2 is designed for object storage — unlimited size, no egress fees. We store the hash in D1 (for fast comparison) and the full content in R2 (for detailed diffing when needed).

3. **Build the deduplicator (`src/processing/deduplicator.ts`)**
   ```typescript
   export function findDuplicates(
     newEntries: RawParsedEntry[],
     existingEntries: Entry[],
     sameCompetitor: boolean
   ): Map<string, string[]> {
     // Returns a map of cluster_id -> [entry_ids] for duplicate groups

     // Strategy:
     // 1. Exact URL match — same content_url = same entry (trivial)
     // 2. Title similarity — normalize titles (lowercase, strip punctuation)
     //    and compute similarity score. If > 0.8 AND same competitor AND
     //    published within 48 hours of each other → likely duplicate
     // 3. Assign cluster_id to group duplicates together
   }

   function normalizeTitle(title: string): string {
     return title.toLowerCase()
       .replace(/[^\w\s]/g, '')    // strip punctuation
       .replace(/\s+/g, ' ')       // normalize whitespace
       .trim();
   }

   function titleSimilarity(a: string, b: string): number {
     // Simple Jaccard similarity on word sets
     // (More sophisticated: Levenshtein distance, but Jaccard is faster and good enough)
     const wordsA = new Set(normalizeTitle(a).split(' '));
     const wordsB = new Set(normalizeTitle(b).split(' '));
     const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
     const union = new Set([...wordsA, ...wordsB]);
     return intersection.size / union.size;
   }
   ```

   Explain: Why Jaccard similarity instead of Levenshtein? For titles, word overlap is more meaningful than character-level edit distance. "Akamai Launches New API Security Feature" and "New API Security Feature from Akamai" have high Jaccard similarity (same words, different order) but moderate Levenshtein distance. Jaccard catches these better.

4. **Build the keyword tagger (`src/processing/tagger.ts`) — v1**

   This is the Phase 3 version. Phase 5 upgrades to AI classification.

   ```typescript
   interface TagRule {
     tag: string;
     includePatterns: RegExp[];     // Match ANY of these → add tag
     excludePatterns: RegExp[];     // Match ANY of these → DON'T add tag (overrides include)
   }

   const TAG_RULES: TagRule[] = [
     {
       tag: 'Security',
       includePatterns: [/\bwaf\b/i, /\bbot\s*(management|detection|mitigation)\b/i, /\bddos\b/i,
                         /\bapi\s*security\b/i, /\bvulnerabilit/i, /\bthreat/i, /\bmalware\b/i,
                         /\bzero.?day\b/i, /\bransomware\b/i, /\bcve-\d/i],
       excludePatterns: [/\bhiring\b/i, /\bjob\b/i, /\bcareer/i, /\bintern\b/i]
     },
     {
       tag: 'Zero Trust',
       includePatterns: [/\bzero\s*trust\b/i, /\bsase\b/i, /\bcasb\b/i, /\bdlp\b/i,
                         /\baccess\s*control\b/i, /\bidentity/i, /\bsso\b/i, /\bmfa\b/i],
       excludePatterns: []
     },
     {
       tag: 'Performance',
       includePatterns: [/\bcdn\b/i, /\bcach(e|ing)\b/i, /\blatency\b/i, /\bedge\s*compute/i,
                         /\bperformance\b/i, /\boptimiz/i, /\bfaster\b/i],
       excludePatterns: [/\bhiring\b/i]
     },
     {
       tag: 'Pricing',
       includePatterns: [/\bpric(e|ing)\b/i, /\bcost\b/i, /\btier\b/i, /\bplan\b/i,
                         /\bfree\s*tier\b/i, /\benterprise\s*plan\b/i, /\bsubscription\b/i],
       excludePatterns: []
     },
     {
       tag: 'Developer Platform',
       includePatterns: [/\bsdk\b/i, /\bapi\b/i, /\bcli\b/i, /\bterraform\b/i,
                         /\bserverless\b/i, /\bedge\s*function/i, /\bwasm\b/i, /\bruntime\b/i],
       excludePatterns: [/\bapi\s*security\b/i]  // "API security" is Security, not DevPlatform
     },
     {
       tag: 'Network',
       includePatterns: [/\bbgp\b/i, /\bmagic\s*transit\b/i, /\bsd-?wan\b/i,
                         /\bipsec\b/i, /\bgre\b/i, /\bpeering\b/i, /\binterconnect/i],
       excludePatterns: []
     }
   ];

   export function tagEntry(title: string, summary: string): string[] {
     const text = `${title} ${summary}`;
     const tags: string[] = [];

     for (const rule of TAG_RULES) {
       const included = rule.includePatterns.some(p => p.test(text));
       const excluded = rule.excludePatterns.some(p => p.test(text));
       if (included && !excluded) {
         tags.push(rule.tag);
       }
     }

     return tags.length > 0 ? tags : ['General'];
   }
   ```

   **Improvement over the original design:** The v1 tagger had simple `includes()` checks. This v2 uses regex patterns with word boundaries (`\b`) to avoid partial matches, and uses **exclude patterns** to filter false positives (e.g., "hiring" posts tagged as Security). It's still keyword-based — Phase 5 will replace this with Claude API classification for much higher accuracy.

5. **Wire up the processing pipeline (`src/cron/process-job.ts`)**
   ```typescript
   export async function processRawContent(
     source: Source,
     fetchResult: FetchResult,
     env: Env
   ): Promise<{ newEntries: number; updatedEntries: number; duplicates: number }> {
     // 1. Parse raw content into RawParsedEntry[]
     const rawEntries = parse(fetchResult, source.source_type, source.parser_config);

     // 2. Detect content changes (snapshot + hash)
     const changes = await detectChanges(source.id, fetchResult.raw_content, env);

     // 3. For each parsed entry:
     let newCount = 0, updateCount = 0, dupCount = 0;
     for (const raw of rawEntries) {
       // a. Sanitize title and summary
       const title = sanitizeForStorage(raw.title);
       const summary = sanitizeForStorage(raw.summary);

       // b. Check for duplicates against existing entries
       const existing = await findExistingEntry(source.id, raw.content_url, env);

       // c. Tag the entry
       const tags = tagEntry(title, summary);

       // d. Insert or update in D1
       if (!existing) {
         await insertEntry({ ...raw, title, summary, tags, source }, env);
         newCount++;
       } else {
         await updateEntryTimestamp(existing.id, env);
         updateCount++;
       }
     }

     // 4. Cross-source deduplication (within same competitor)
     // Run after all entries are stored
     await deduplicateWithinCompetitor(source.competitor_name, env);

     return { newEntries: newCount, updatedEntries: updateCount, duplicates: dupCount };
   }
   ```

6. **Test the processing pipeline**
   - Download sample RSS XML and HTML from competitor sites into `test-data/`
   - Feed them through the parser, differ, deduplicator, and tagger
   - Verify: entries are correctly parsed with title, URL, date
   - Verify: duplicate entries get the same cluster_id
   - Verify: tags are reasonable (spot-check 10+ entries)
   - Verify: content hash changes are detected

### Phase 3 Checkpoint
- [ ] RSS parser extracts entries from real Atom/RSS feeds
- [ ] HTML parser extracts entries using per-source CSS selectors
- [ ] Content differ detects new vs. changed vs. unchanged content
- [ ] Snapshots are stored in R2, hashes in D1
- [ ] Deduplicator groups related entries by cluster_id
- [ ] Tagger assigns relevant tags with regex patterns + exclude patterns
- [ ] All external content is sanitized before storage (no raw HTML stored unsanitized)
- [ ] Full pipeline runs: fetch → parse → diff → dedup → tag → store

**Break it exercise:** Feed the parser HTML with `<script>alert('xss')</script>` in a title. Verify the sanitizer strips it. Then feed two entries with very similar titles from the same competitor — verify they're clustered.

---

## Phase 4 — Storage, Querying & Source Management API

**Goal:** Build the D1 data access layer and REST API for managing sources, querying entries, and checking source health.

**What you'll learn:** D1 prepared statements, parameterized queries (SQL injection prevention), pagination, filtering, API design with Hono.

**Prerequisite:** Phase 3 complete — entries are being stored in D1.

### Steps

1. **Build the storage repositories**

   **`src/storage/entries-repo.ts`:**
   ```typescript
   export class EntriesRepo {
     constructor(private db: D1Database) {}

     // Get entries with flexible filtering
     async query(filters: {
       competitor?: string;
       tag?: string;
       since?: string;
       reviewed?: boolean;
       minRelevance?: number;
       limit?: number;
       offset?: number;
     }): Promise<Entry[]> {
       // Build query dynamically using PARAMETERIZED queries (never string concat!)
       // Always use db.prepare(...).bind(param1, param2, ...) — NEVER interpolate values
     }

     // Get new entries since a date (for digest generation)
     async getNewSince(since: string): Promise<Entry[]> { ... }

     // Mark entry as reviewed
     async markReviewed(entryId: string): Promise<void> { ... }

     // Search entries by keyword (D1 LIKE query)
     async search(keyword: string, limit: number): Promise<Entry[]> {
       // Use: WHERE title LIKE ? OR summary LIKE ?
       // Bind: `%${keyword}%` — parameterized, safe from SQL injection
     }
   }
   ```

   **CRITICAL — SQL Injection Prevention:** Every D1 query MUST use prepared statements with `.bind()`. Never concatenate user input into SQL strings. This is non-negotiable with my AppSec background.

   ```typescript
   // CORRECT:
   db.prepare('SELECT * FROM entries WHERE competitor_name = ?').bind(competitor).all();

   // WRONG — SQL INJECTION VULNERABLE:
   db.prepare(`SELECT * FROM entries WHERE competitor_name = '${competitor}'`).all();
   ```

2. **Build the REST API routes**

   **`src/routes/sources.ts`** — Manage monitored sources:
   - `GET /api/sources` — list all sources with their health status
   - `POST /api/sources` — add a new source (validates URL with SSRF checker)
   - `PUT /api/sources/:id` — update source config (parser selectors, interval, etc.)
   - `DELETE /api/sources/:id` — remove a source
   - `POST /api/sources/:id/check` — trigger an immediate check for one source
   - `POST /api/sources/discover` — auto-discover sources for a domain

   **`src/routes/entries.ts`** — Query entries:
   - `GET /api/entries` — list entries with filters: `?competitor=Akamai&tag=Security&days=30&reviewed=false`
   - `GET /api/entries/:id` — get a single entry with full details
   - `GET /api/entries/search?q=keyword` — full-text search
   - `PATCH /api/entries/:id` — mark as reviewed/actioned

   **`src/routes/health.ts`** — Source health:
   - `GET /api/health` — all sources with health status (green/yellow/red)
   - `GET /api/health/:sourceId` — detailed health history for one source
   - `POST /api/health/:sourceId/reset` — reset a disabled source back to healthy

   **`src/routes/actions.ts`** — Intelligence actions:
   - `POST /api/entries/:id/action` — log an action (reviewed, battlecard_updated, shared, noted)
   - `GET /api/entries/:id/actions` — get action history for an entry

3. **Add input validation to all API routes**
   - Validate all request bodies (required fields, correct types, reasonable lengths)
   - Validate URL parameters (valid UUIDs for IDs)
   - Return `400 Bad Request` with clear error messages for invalid input
   - Log all validation failures for debugging

4. **Add pagination to list endpoints**
   ```typescript
   // Standard pagination pattern:
   // GET /api/entries?limit=20&offset=0
   // Response includes: { data: [...], total: 150, limit: 20, offset: 0 }
   ```

5. **Wire up API routes to the Hono app in `src/index.ts`**

6. **Test all API routes**
   - Use `curl` or a REST client to test each endpoint
   - Verify: parameterized queries prevent SQL injection (try `' OR 1=1 --` in a filter)
   - Verify: SSRF protection works on `POST /api/sources` (try adding a source with a private IP)
   - Verify: pagination works correctly

### Phase 4 Checkpoint
- [ ] All CRUD API routes work for sources, entries, health, actions
- [ ] Queries use parameterized statements (no SQL injection possible)
- [ ] Source URLs are validated through SSRF checker on creation/update
- [ ] Pagination works on list endpoints
- [ ] Input validation rejects bad requests with clear error messages
- [ ] Source health endpoint shows green/yellow/red status per source
- [ ] Entry search works across titles and summaries
- [ ] Action logging works (reviewed, battlecard_updated, etc.)

---

## Phase 5 — Intelligent Classification (AI-Powered Tagging & Relevance)

**Goal:** Replace keyword tagging with Claude API semantic classification. Add relevance scoring so digests prioritize what matters most.

**What you'll learn:** Claude API integration from Workers, prompt engineering for classification, structured output parsing, cost management.

**Prerequisite:** Phase 4 complete — entries stored and queryable. Anthropic API key available.

### Steps

1. **Upgrade the tagger to use Claude API (`src/processing/tagger.ts`)**
   ```typescript
   export async function classifyWithAI(
     title: string,
     summary: string,
     competitorName: string,
     apiKey: string
   ): Promise<{ tags: string[]; relevance: number; aiSummary: string }> {
     const response = await fetch('https://api.anthropic.com/v1/messages', {
       method: 'POST',
       headers: {
         'x-api-key': apiKey,
         'anthropic-version': '2023-06-01',
         'content-type': 'application/json'
       },
       body: JSON.stringify({
         model: 'claude-haiku-4-5-20251001',  // Fast and cheap for classification
         max_tokens: 300,
         messages: [{
           role: 'user',
           content: `Classify this competitor product update.

Competitor: ${competitorName}
Title: ${title}
Summary: ${summary}

Respond in JSON only:
{
  "tags": ["<1-3 tags from: Security, Zero Trust, Performance, Pricing, Developer Platform, Network, Acquisition, Partnership, General>"],
  "relevance": <0-100 integer. 90-100: pricing/major launch. 70-89: significant feature. 50-69: minor update. 0-49: noise/hiring/marketing>,
  "summary": "<One sentence: what this means for a Cloudflare SE competing against this vendor>"
}

Rules:
- Pricing changes, product launches, and acquisition news are always 80+ relevance
- Hiring posts, marketing fluff, and event announcements are always below 30
- Bug fixes and minor updates are 40-60
- The summary should be actionable for a sales engineer, not just descriptive`
         }]
       })
     });

     const result = await response.json();
     // Parse the JSON from Claude's response
     // Fall back to keyword tagger if Claude API fails or returns invalid JSON
   }
   ```

   **Why Claude Haiku?** Classification is a lightweight task — Haiku is 10x cheaper than Opus and fast enough for batch processing. At ~$0.001 per entry, processing 100 entries per week costs ~$0.40/month.

   **Fallback:** If the Claude API is unavailable, falls back to the keyword tagger from Phase 3. Never let a classification failure prevent entries from being stored.

2. **Build the relevance scorer (`src/delivery/relevance-scorer.ts`)**

   Combines the AI relevance score with heuristic boosts:
   ```typescript
   export function computeFinalRelevance(
     aiScore: number,
     entry: Entry,
     source: Source
   ): number {
     let score = aiScore;

     // Boost for certain signals:
     if (entry.tags.includes('Pricing'))    score += 10;  // Pricing always matters
     if (entry.is_update)                   score += 5;   // Content changes are interesting
     if (source.consecutive_failures === 0) score += 0;   // Healthy source, no penalty
     if (source.consecutive_failures > 3)   score -= 10;  // Unreliable source, penalize

     return Math.max(0, Math.min(100, score));
   }
   ```

3. **Backfill existing entries**
   - Write a one-time script that re-classifies all existing entries using Claude API
   - Update tags, relevance_score, and ai_summary in D1
   - This upgrades your entire historical dataset from keyword tags to AI tags

4. **Cost tracking**
   - Log Claude API usage per cron run (tokens used, cost estimate)
   - Set a monthly budget cap — if exceeded, fall back to keyword tagger for the rest of the month
   - Store usage in KV: `claude-usage:{YYYY-MM}` → `{ tokens: N, cost_usd: X.XX }`

5. **Test classification quality**
   - Take 20 real entries from your D1 database
   - Compare keyword tagger output vs. Claude output
   - Verify: Claude correctly identifies hiring posts as low-relevance
   - Verify: Claude correctly tags "API protection" as Security even without the word "security"
   - Verify: the one-line summary is actionable (not just "Akamai released something")

### Phase 5 Checkpoint
- [ ] Claude API integration works from Workers
- [ ] Classification returns tags, relevance score, and one-line summary
- [ ] Fallback to keyword tagger works when Claude API is unavailable
- [ ] Relevance scoring combines AI score with heuristic boosts
- [ ] Cost tracking is in place with a monthly budget cap
- [ ] Classification quality is noticeably better than keyword-only

---

## Phase 6 — Digest Generation & Notifications

**Goal:** Generate formatted, relevance-ranked digests and deliver them via Telegram, Slack, or email.

**What you'll learn:** Template-based formatting, Telegram Bot API, Slack Webhooks, multi-channel notification.

**Prerequisite:** Phase 5 complete — entries have AI tags and relevance scores.

### Steps

1. **Build the rules engine (`src/delivery/rules-engine.ts`)**
   ```typescript
   export async function applyRules(entries: Entry[], env: Env): Promise<Entry[]> {
     const rules = await env.DB.prepare('SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC').all();

     let filtered = [...entries];
     for (const rule of rules.results) {
       filtered = filtered.filter(entry => {
         const matches = evaluateCondition(entry, rule);
         switch (rule.action) {
           case 'exclude': return !matches;   // Remove matching entries
           case 'include': return matches;     // Keep only matching entries
           default: return true;               // highlight/notify don't filter
         }
       });
     }
     return filtered;
   }
   ```

   This lets you configure rules like:
   - "Exclude entries with relevance < 30" (filter noise)
   - "Highlight entries tagged Pricing" (visual emphasis in digest)
   - "Notify immediately when Akamai releases something tagged Security" (real-time alert)

2. **Build the digest builder (`src/delivery/digest-builder.ts`)**

   ```
   =====================================
   COMPETITIVE INTELLIGENCE DIGEST
   Week of Feb 24 - Feb 28, 2026
   12 updates across 4 competitors
   =====================================

   --- CRITICAL (relevance 80+) ---

   AKAMAI
   [Pricing] Enterprise pricing updated for App & API Protector
     -> "Akamai raised prices ~15% on their core WAF product, potential opening for Cloudflare displacement"
     Source: https://akamai.com/blog/pricing-update

   ZSCALER
   [Security] New AI-powered phishing detection in ZIA
     -> "Zscaler added ML-based phishing detection to their gateway product, competing with Cloudflare's email security"
     Source: https://zscaler.com/blogs/new-phishing-detection

   --- NOTABLE (relevance 50-79) ---

   FASTLY
   [Developer Platform] Wasm runtime now supports Go 1.22
     -> "Fastly continues investing in edge compute; Cloudflare Workers still has broader language support"
     Source: https://fastly.com/blog/go-122-support

   PALO ALTO
   [Zero Trust] Prisma Access adds new DLP templates
     -> "PA expanding DLP capabilities; Cloudflare's DLP is catching up but still behind on pre-built templates"
     Source: https://paloaltonetworks.com/blog/prisma-dlp

   --- OTHER (relevance < 50) ---
   • [Akamai] Blog: "Join us at RSA Conference 2026" (marketing)
   • [Zscaler] Blog: "Hiring: Senior Engineer, Tel Aviv" (hiring)

   =====================================
   3 entries marked as reviewed | 0 battlecards updated
   Next digest: March 3, 2026
   =====================================
   ```

   Key design decisions:
   - Group by relevance tier (Critical / Notable / Other), not by competitor
   - Include the AI-generated actionable summary (the `->` line)
   - Link to original source
   - Show review/action stats at the bottom

3. **Build the Telegram notifier (`src/delivery/notifier.ts`)**
   ```typescript
   export async function sendTelegram(
     chatId: string,
     message: string,
     botToken: string
   ): Promise<boolean> {
     // Telegram message limit: 4096 characters
     // If digest exceeds limit, split into multiple messages

     const MAX_LENGTH = 4096;
     const chunks = splitMessage(message, MAX_LENGTH);

     for (const chunk of chunks) {
       const response = await fetch(
         `https://api.telegram.org/bot${botToken}/sendMessage`,
         {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
             chat_id: chatId,
             text: chunk,
             parse_mode: 'Markdown',
             disable_web_page_preview: true
           })
         }
       );

       if (!response.ok) {
         console.error('Telegram send failed:', await response.text());
         return false;
       }
     }
     return true;
   }
   ```

4. **Add Slack webhook support**
   ```typescript
   export async function sendSlack(webhookUrl: string, digest: string): Promise<boolean> {
     // Format as Slack blocks for richer formatting
     // Use sections, dividers, and mrkdwn for structured display
   }
   ```

5. **Wire up the digest cron job (`src/cron/deliver-job.ts`)**
   ```typescript
   export async function generateAndSendDigest(env: Env): Promise<void> {
     const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

     // 1. Get new entries since last digest
     const entries = await entriesRepo.getNewSince(oneWeekAgo);

     // 2. Apply user rules (filter, highlight)
     const filtered = await applyRules(entries, env);

     // 3. Build the digest
     const digest = buildDigest(filtered, { start: oneWeekAgo, end: new Date().toISOString() });

     // 4. Send via configured channels
     await sendTelegram(env.TELEGRAM_CHAT_ID, digest, env.TELEGRAM_BOT_TOKEN);

     // 5. Log digest to D1
     await digestsRepo.save({ ... });
   }
   ```

6. **Add an on-demand digest endpoint**
   - `POST /api/digest/generate?days=7` — generate and return a digest without sending notifications
   - Useful for previewing before sharing, or generating custom-period digests

7. **Test notifications end-to-end**
   - Seed 10+ entries across 3 competitors with varying relevance scores
   - Trigger the digest cron
   - Verify: Telegram message arrives, formatted correctly, grouped by relevance
   - Verify: entries below relevance threshold are in the "Other" section
   - Verify: the digest is split into multiple messages if too long for Telegram

### Phase 6 Checkpoint
- [ ] Rules engine filters entries based on user-configured rules
- [ ] Digest is formatted with relevance tiers (Critical / Notable / Other)
- [ ] AI summaries appear in the digest alongside each entry
- [ ] Telegram notifications send successfully (with message splitting)
- [ ] Slack webhook notifications work
- [ ] On-demand digest generation works via API
- [ ] Digest metadata is logged in D1
- [ ] Weekly cron generates and sends the digest automatically

**Break it exercise:** Set a bad Telegram token. Verify the cron completes without crashing and logs the error. Then set an extremely low relevance filter (exclude < 99) and verify the digest handles zero entries gracefully.

---

## Phase 7 — Dashboard with Security & Intelligence Actions

**Goal:** Build a secure web dashboard behind Cloudflare Access with XSS-safe rendering, filtering, search, source health monitoring, trend analysis, and "act on intelligence" workflows.

**What you'll learn:** Cloudflare Pages + Workers integration, Cloudflare Access for auth, Content Security Policy, XSS-safe rendering, frontend architecture.

**Prerequisite:** Phase 6 complete — digests and notifications working.

### Steps

1. **Protect the dashboard and API with Cloudflare Access**
   - Create an Access Application for the dashboard URL
   - Configure an identity provider (start with one-time PIN, then add Google/GitHub OAuth)
   - Set an Access policy: only allow your email address (and team members)
   - Add JWT validation middleware to all API routes (`src/security/auth.ts`):
     ```typescript
     // Validate the Cloudflare Access JWT on every API request
     // Extract user email from the JWT for audit logging
     // Return 401 if JWT is missing or invalid
     ```

   **Why this is non-negotiable:** Without Access, anyone who discovers your Worker URL can read your competitive intelligence and modify your sources. This is sensitive business data.

   Reference: https://developers.cloudflare.com/cloudflare-one/identity/

2. **Set Content Security Policy headers**
   ```typescript
   // Add to all responses from the dashboard:
   app.use('*', async (c, next) => {
     await next();
     c.header('Content-Security-Policy',
       "default-src 'self'; " +
       "script-src 'self'; " +       // No inline scripts, no external scripts
       "style-src 'self'; " +         // No inline styles from external content
       "img-src 'self' https:; " +    // Allow images from HTTPS sources
       "connect-src 'self'; " +       // API calls only to self
       "frame-src 'none'; " +         // No iframes
       "object-src 'none'"            // No plugins
     );
     c.header('X-Content-Type-Options', 'nosniff');
     c.header('X-Frame-Options', 'DENY');
   });
   ```

   **Why CSP?** Even with DOMPurify sanitization, defense-in-depth says we should also tell the browser to block inline scripts. If a sanitization bypass is ever found, CSP is the second line of defense.

3. **Build the dashboard frontend (`frontend/`)**

   **Main views:**
   - **Feed view** (default) — All entries, newest first, with filters for competitor, tag, relevance, and reviewed/unreviewed
   - **Digest view** — Past digests, click to expand
   - **Source health view** — Status dashboard: green (healthy), yellow (degraded), red (failing/disabled)
   - **Search view** — Full-text search across all entries
   - **Trends view** — Charts showing: entries per competitor over time, tags distribution, where competitors are investing

   **Entry card design:**
   ```
   ┌─────────────────────────────────────────────────────┐
   │ [Security] [Pricing]                   Relevance: 85│
   │                                                      │
   │ Akamai: Enterprise pricing updated for App & API... │
   │                                                      │
   │ "Akamai raised prices ~15% on their core WAF        │
   │  product, potential opening for Cloudflare           │
   │  displacement"                            — Claude AI│
   │                                                      │
   │ Source: akamai.com/blog/...    |  Feb 26, 2026      │
   │                                                      │
   │ [Mark Reviewed] [Update Battlecard] [Share] [Note]  │
   └─────────────────────────────────────────────────────┘
   ```

4. **XSS-safe rendering rules**
   - **NEVER** render `raw_html_snippet` or any external content using `innerHTML`
   - Always use `textContent` for plain text display
   - If HTML rendering is needed (e.g., summaries with links), use DOMPurify on the client side too
   - All data from the API should be treated as untrusted by the frontend

5. **Build "Act on Intelligence" actions**
   - **Mark as Reviewed** — update `reviewed` flag, track in `entry_actions`
   - **Update Battlecard** — log the action, optionally link to a battlecard file path
   - **Share** — generate a shareable digest snippet (text format) for Slack/email
   - **Add Note** — free-text note attached to an entry (stored in `entry_actions`)
   - **Dismiss** — hide low-value entries from the feed

6. **Build the Source Health dashboard**
   ```
   ┌────────────────────────────────────────────────────┐
   │ SOURCE HEALTH                                       │
   ├────────────────────────────────────────────────────┤
   │ 🟢 Fastly Blog RSS        | Last checked: 2h ago  │
   │    Avg response: 180ms    | 45 entries found       │
   │                                                     │
   │ 🟡 Akamai Blog (Browser)  | Last checked: 6h ago  │
   │    Avg response: 8200ms   | 2 consecutive failures │
   │    Last error: "Navigation timeout after 15s"      │
   │                                                     │
   │ 🔴 Zscaler Blog (HTML)    | DISABLED               │
   │    12 consecutive failures | Last: 403 Forbidden   │
   │    [Reset] [Change adapter to Browser] [Remove]    │
   └────────────────────────────────────────────────────┘
   ```

7. **Build simple trend analysis**
   - D1 query: entries grouped by competitor + month → line chart
   - D1 query: entries grouped by tag → pie/bar chart
   - Use a lightweight charting library (Chart.js or just SVG) — no heavy frameworks
   - Key insight this enables: "Akamai published 15 security updates in the last 3 months but only 2 performance updates — they're doubling down on security"

8. **Deploy the dashboard to Pages**
   - Set up Cloudflare Pages project
   - Configure custom domain (optional)
   - Verify Access policy blocks unauthenticated access

### Phase 7 Checkpoint
- [ ] Dashboard is behind Cloudflare Access — unauthenticated requests get login page
- [ ] CSP headers are set on all responses
- [ ] All external content is rendered XSS-safe (textContent, DOMPurify)
- [ ] Feed view shows entries with filters and search
- [ ] Source health view shows green/yellow/red status
- [ ] "Act on intelligence" actions work (review, note, share, battlecard link)
- [ ] Trend analysis shows entries over time by competitor and tag
- [ ] Dashboard is responsive and works on mobile

**Break it exercise:** Open browser dev tools and try to inject `<img src=x onerror=alert(1)>` into an entry title via the API. Verify CSP blocks execution even if the content reaches the DOM.

---

## Security Summary

All security controls in one place, for reference:

| Threat | Control | Phase | Layer |
|--------|---------|-------|-------|
| **SSRF** | URL validator blocks private IPs, localhost, internal domains | 1 | Ingestion |
| **Stored XSS** | DOMPurify sanitization on all external content before storage | 1 | Processing |
| **Reflected XSS** | CSP headers, textContent rendering, client-side DOMPurify | 7 | Presentation |
| **SQL Injection** | D1 prepared statements with `.bind()` — never string interpolation | 4 | Storage |
| **Secret Leakage** | Wrangler secrets (`wrangler secret put`), `.dev.vars` in `.gitignore` | 1 | All |
| **Unauthenticated Access** | Cloudflare Access on dashboard and API, JWT validation middleware | 7 | Presentation |
| **DoS via Large Responses** | 5MB response size limit on all adapters, fetch timeouts | 2 | Ingestion |
| **Source Abuse** | Rate limiting per source (max 1 fetch per `check_interval_hours`) | 2 | Ingestion |
| **API Abuse** | Rate limiting on API endpoints | 4 | Presentation |
| **Broken Sources** | Auto-disable after 10 consecutive failures, health dashboard | 2 | Ingestion |
| **Input Validation** | All API inputs validated (types, lengths, required fields) | 4 | All |

---

## Working Principles

Apply these throughout all phases:

1. **Security from Day 1.** Every phase includes its security controls. Don't bolt security on at the end — that's how vulnerabilities ship.
2. **Build incrementally.** Each phase produces something testable. Don't skip ahead.
3. **RSS first, Browser Rendering last.** Always try the lightest adapter that works. Browser Rendering is expensive and slow — use it only when nothing else works.
4. **Test locally first.** Use `wrangler dev` and `wrangler dev --test-scheduled` before deploying. Download sample data into `test-data/` for offline testing.
5. **Sanitize everything.** Every piece of external content (titles, summaries, HTML snippets) passes through the sanitizer before storage or display. No exceptions.
6. **Parameterize every query.** Every D1 query uses `.bind()`. No string interpolation. Ever.
7. **Be respectful to competitors' sites.** Use honest User-Agent headers, respect `robots.txt`, don't fetch more frequently than `check_interval_hours`.
8. **Track what you learn.** Write notes at each checkpoint — these become your reference material.
9. **Keep secrets secret.** Use `wrangler secret put` for production. Use `.dev.vars` for local dev. Never commit either.
10. **Monitor source health.** A broken source silently failing is worse than no source at all. The health dashboard exists so you know when something breaks.

## Cloudflare Products Used

| Product | How It's Used | Phase |
|---------|--------------|-------|
| **Workers** | API backend, cron orchestrator, all business logic | 1-7 |
| **Cron Triggers** | Two schedules: fetch every 6h, digest every Monday | 1 |
| **D1** | Sources, entries, snapshots metadata, digests, rules, health, actions | 1-7 |
| **KV** | Config cache, rate-limit counters, Claude API usage tracking | 1-6 |
| **R2** | Full-page HTML snapshots for content diffing | 3 |
| **Browser Rendering** | Headless Chromium for JS-rendered competitor sites | 2 |
| **Pages** | Dashboard frontend hosting | 7 |
| **Access** | Authentication for dashboard and API | 7 |

## Quick Reference — Plan Requirements

| Feature | Plan Required | Cost |
|---------|--------------|------|
| Workers + Cron | Free (limited) / Paid ($5/mo, recommended) | $5/month |
| D1 | Free tier (5M rows read/day, 100K writes/day) | Free |
| KV | Free tier (100K reads/day, 1K writes/day) | Free |
| R2 | Free tier (10GB storage, 10M reads/month) | Free |
| Browser Rendering | Workers Paid plan required | Included in $5/mo |
| Pages | Free | Free |
| Access | Free (up to 50 users) | Free |
| Claude API (Haiku) | Pay-as-you-go | ~$0.40/month for 100 entries/week |

**Estimated total cost: ~$5.40/month** (Workers Paid + Claude API). Everything else fits in free tiers for personal/team use.

## Getting Started

When you're ready to begin:

1. Check prerequisites (Node.js, Wrangler, Cloudflare account with Workers Paid plan, Telegram bot)
2. Create the `competitive-changelog-monitor/` folder
3. Run `npm init -y` and install: `npm install hono cheerio fast-xml-parser dompurify`
4. Create `wrangler.toml`, `.dev.vars`, `.gitignore`
5. Start **Phase 1**: Build the security utilities and D1 schema first — everything else depends on them
6. Build incrementally through each phase, testing locally before deploying
7. By the end of Phase 4, you'll have a working system (fetch → parse → store → query)
8. Phases 5-7 add intelligence, polish, and security hardening

---

**This isn't just a learning project — it's a tool that solves a real problem you face every week. By the time you finish Phase 7, you'll have a competitive intelligence platform that runs on Cloudflare's edge, costs under $6/month, and keeps you ahead of every competitor move in the ME region.**
