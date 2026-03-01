# Production Deployment Guide

## Commit Status
✅ Phase 7 committed to git (commit: 20bdb09)

All 7 phases complete and committed:
- Phase 1-6: Core platform (backend + API + AI + digests)
- Phase 7: Dashboard + security (JWT validation + CSP headers + frontend)

---

## Pre-Deployment Checklist

### 1. Environment Setup
- [ ] Cloudflare account with Workers Paid plan ($5/month minimum)
- [ ] GitHub account (or other git hosting for backup)
- [ ] Telegram bot token (for digest notifications)
- [ ] Claude Haiku API key for AI classification
- [ ] Custom domain (optional, for branded dashboard)

### 2. Code Review
- [ ] All TypeScript compiles without errors
- [ ] No console.log statements left for debugging
- [ ] All secrets in `.dev.vars` (not in code)
- [ ] wrangler.toml has placeholder IDs marked for replacement
- [ ] Security headers tested locally
- [ ] XSS protection verified

### 3. Testing
- [ ] All 10 test categories passing (see TESTING.md)
- [ ] API endpoints respond correctly
- [ ] Frontend loads and renders
- [ ] Entry actions working (review, note, share, battlecard)
- [ ] Filters and search functional
- [ ] Mobile responsive design tested
- [ ] Browser DevTools shows no CSP violations

---

## Deployment Steps

### Step 1: Set Up Git Remote (Backup)

```bash
# Add remote to GitHub (or GitLab, Bitbucket, etc.)
git remote add origin https://github.com/YOUR_USERNAME/competitive-changelog-monitor.git
git branch -M main
git push -u origin main
```

**Why:** Keeps your code safe in remote repository, enables CI/CD in future.

---

### Step 2: Deploy Worker to Cloudflare

#### 2a. Create D1 Database (if not already done)

```bash
wrangler d1 create competitive-changelog-monitor-prod
```

This returns a database ID. Update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "competitive-changelog-monitor-prod"
database_id = "YOUR_DATABASE_ID_HERE"
```

#### 2b. Create KV Namespace (if not already done)

```bash
wrangler kv:namespace create changelog-monitor-kv-prod
```

Update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"
```

#### 2c. Create R2 Bucket (if not already done)

```bash
wrangler r2 bucket create changelog-monitor-snapshots-prod
```

Update `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "SNAPSHOTS"
bucket_name = "changelog-monitor-snapshots-prod"
```

#### 2d. Set Secrets

```bash
# Telegram credentials
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID

# Claude API
wrangler secret put ANTHROPIC_API_KEY
```

When prompted, paste the actual values (not placeholders).

#### 2e. Run Database Migrations

```bash
wrangler d1 execute competitive-changelog-monitor-prod --file migrations/0001_create_sources.sql
wrangler d1 execute competitive-changelog-monitor-prod --file migrations/0002_create_entries.sql
wrangler d1 execute competitive-changelog-monitor-prod --file migrations/0003_create_snapshots.sql
wrangler d1 execute competitive-changelog-monitor-prod --file migrations/0004_create_digests.sql
wrangler d1 execute competitive-changelog-monitor-prod --file migrations/0005_create_source_health.sql
wrangler d1 execute competitive-changelog-monitor-prod --file migrations/0006_create_rules.sql
wrangler d1 execute competitive-changelog-monitor-prod --file migrations/0007_create_actions.sql
wrangler d1 execute competitive-changelog-monitor-prod --file migrations/0008_seed_sources.sql
```

#### 2f. Deploy Worker

```bash
# Deploy to production
wrangler deploy --env production

# Or deploy to default (also goes to production)
wrangler deploy
```

Verify deployment:
```bash
# Check status
wrangler deployments list
```

**Result:** Your Worker is now live at `https://competitive-changelog-monitor.YOUR_ACCOUNT.workers.dev`

---

### Step 3: Deploy Frontend to Cloudflare Pages

#### 3a. Create Pages Project

**Option A: Via CLI**
```bash
wrangler pages project create competitive-changelog-monitor
```

**Option B: Via Dashboard**
1. Go to https://dash.cloudflare.com/
2. Select your account
3. Go to Pages
4. Click "Create a project"
5. Choose "Direct upload"
6. Name: `competitive-changelog-monitor`
7. Upload the `frontend/` folder

#### 3b. Configure Build Settings

If using Git integration:
- Framework preset: None
- Build command: (leave blank, no build needed)
- Build output directory: `/frontend`
- Root directory: `/`

#### 3c: Upload Frontend Files

```bash
# From project root
wrangler pages publish frontend/ --project-name competitive-changelog-monitor
```

**Result:** Your dashboard is now at `https://competitive-changelog-monitor.pages.dev`

---

### Step 4: Configure Cloudflare Access (Authentication)

#### 4a. Create Access Application

1. Go to https://dash.cloudflare.com/
2. Go to Zero Trust → Access → Applications
3. Click "Create an application"
4. Choose "Self-hosted"

**Settings:**
- Application name: "Competitive Intelligence Dashboard"
- Subdomain: `intelligence` (or use custom domain)
- Domain: Your Cloudflare domain (e.g., `company.com`)

Result: `https://intelligence.company.com` is protected by Access

**OR** use the Pages domain directly:
- Configure for: `https://competitive-changelog-monitor.pages.dev`

#### 4b. Create Access Policy

Click "Create a rule" to add policy:

**Policy 1: Allow by Email**
```
Selector: Email
Operator: Equals
Value: your@email.com
```

Add more team members:
```
Rule: Everyone in an email domain
Value: @company.com
```

**Policy 2: Require MFA (Optional but Recommended)**
```
Selector: MFA Status
Operator: Equals
Value: Presence
```

#### 4c. Configure Identity Provider

Go to Zero Trust → Settings → Authentication

**Add identity provider:**

**Option 1: One-Time PIN (Easiest, for testing)**
- Provider: "One-time PIN"
- Enable it

**Option 2: Google OAuth (Recommended for production)**
1. Go to Google Cloud Console
2. Create OAuth 2.0 credentials (OAuth consent screen)
3. Add authorized redirect URIs:
   - `https://YOUR_TEAM_DOMAIN.cloudflareaccess.com/cdn-cgi/access/callback`
4. Copy Client ID and Client Secret
5. In Access → Authentication, add Google provider:
   - Client ID: (paste)
   - Client Secret: (paste)

**Option 3: GitHub OAuth**
1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Create new OAuth App
3. Authorization callback URL: `https://YOUR_TEAM_DOMAIN.cloudflareaccess.com/cdn-cgi/access/callback`
4. Copy Client ID and Client Secret
5. In Access → Authentication, add GitHub provider

#### 4d. Test Access

1. Open incognito window
2. Go to your dashboard URL
3. You should be redirected to Access login
4. Authenticate with your provider
5. CF_Authorization cookie is injected
6. Dashboard loads successfully

---

### Step 5: Configure Custom Domain (Optional)

To use a custom domain instead of `.pages.dev`:

1. Go to Pages project → Custom domains
2. Click "Set up a custom domain"
3. Enter your domain (e.g., `dashboard.company.com`)
4. Add CNAME record pointing to `<YOUR_PAGES_PROJECT>.pages.dev`
5. Wait for DNS to propagate (~5 minutes)

For Access-protected domains, also configure in Zero Trust:
- Go to Access → Applications
- Create application for your custom domain
- Set Access policy as in Step 4b

---

### Step 6: Set Up Environment Variables for Production

Create `wrangler.toml` environment section:

```toml
[env.production]
routes = [
  { pattern = "competitive-changelog-monitor.YOUR_ACCOUNT.workers.dev/*", zone_id = "YOUR_ZONE_ID" }
]

[env.production.env]
ENVIRONMENT = "production"

[[env.production.d1_databases]]
binding = "DB"
database_name = "competitive-changelog-monitor-prod"
database_id = "YOUR_DATABASE_ID"

[[env.production.kv_namespaces]]
binding = "KV"
id = "YOUR_KV_ID"

[[env.production.r2_buckets]]
binding = "SNAPSHOTS"
bucket_name = "changelog-monitor-snapshots-prod"
```

Deploy with:
```bash
wrangler deploy --env production
```

---

### Step 7: Set Up Cron Triggers

Update `wrangler.toml` with cron schedules:

```toml
[[triggers.crons]]
cron = "0 */6 * * *"  # Every 6 hours - fetch sources

[[triggers.crons]]
cron = "0 8 * * 1"    # Monday 8 AM UTC - send digest
```

Verify in Cloudflare dashboard:
- Go to Workers
- Select your Worker
- Go to Triggers → Cron
- Should see both schedules listed

---

### Step 8: Set Up Monitoring & Alerts

#### 8a. Enable Analytics

In Cloudflare Workers dashboard:
- Go to your Worker
- Enable "Real-time logs"
- Check "Metrics" tab for request counts, error rates

#### 8b. Set Up CSP Violation Reporting

In your Worker, you can log CSP violations:

```typescript
// Send CSP reports to a logging endpoint
app.post('/api/csp-report', (c) => {
  const violation = c.req.json();
  console.log('[CSP Violation]', violation);
  // Could send to external logging service
  return c.text('logged');
});
```

In your frontend HTML, add CSP report directive:
```html
<!-- In frontend/index.html <head> -->
<meta http-equiv="Content-Security-Policy"
      content="...; report-uri https://YOUR_DOMAIN/api/csp-report">
```

#### 8c. Set Up Email Alerts

In Cloudflare dashboard:
- Go to Notifications
- Create alert for:
  - Worker errors (failure rate > 1%)
  - High error rate
  - High API latency

#### 8d. Monitor AI Costs

Check Claude API costs:
- Go to https://console.anthropic.com/
- API Billing section
- Set up budget alerts if desired
- (Default budget in code: $5/month)

---

### Step 9: Verify Production Deployment

#### 9a. Test Dashboard Access

```bash
# Should redirect to Access login
curl -I https://intelligence.company.com/

# After logging in via browser, should load dashboard
# Check DevTools → Network for API calls
# All calls should have CF_Authorization header
```

#### 9b. Test API Endpoints

```bash
# After obtaining JWT from Access login
curl -H "Authorization: Bearer YOUR_JWT" \
  https://competitive-changelog-monitor.YOUR_ACCOUNT.workers.dev/api/entries

# Should return entries without 401 Unauthorized error
```

#### 9c. Test CSP Headers

```bash
curl -I https://competitive-changelog-monitor.YOUR_ACCOUNT.workers.dev/api/entries | grep "Content-Security-Policy"

# Should show CSP header present
```

#### 9d. Test XSS Protection

In browser console on dashboard:
```javascript
// Try injecting XSS payload in search
// Type: <img src=x onerror=alert(1)>
// CSP should block execution
// No alert() should appear
```

#### 9e. Test Cron Triggers

Manually test cron by calling:
```bash
# Test fetch job
curl -X POST https://YOUR_DOMAIN/api/trigger/fetch \
  -H "Authorization: Bearer YOUR_JWT"

# Should return fetch results
# Check Workers logs for scheduled execution
```

---

### Step 10: Enable Caching (Optional Performance)

In `wrangler.toml`:

```toml
[env.production]
routes = [
  {
    pattern = "competitive-changelog-monitor.YOUR_ACCOUNT.workers.dev/*",
    custom_domain = true,
    zone_id = "YOUR_ZONE_ID"
  }
]
```

Add cache control headers in `src/index.ts`:

```typescript
app.use('*', async (c, next) => {
  await next();

  // Cache static assets for 1 day
  if (c.req.path().endsWith('.css') || c.req.path().endsWith('.js')) {
    c.header('Cache-Control', 'public, max-age=86400');
  }

  // Cache API responses for 5 minutes (if safe)
  if (c.req.path().startsWith('/api/')) {
    c.header('Cache-Control', 'private, max-age=300');
  }
});
```

---

## Post-Deployment Verification

### Checklist

- [ ] Dashboard accessible at https://YOUR_DOMAIN
- [ ] Access login redirects unauthenticated users
- [ ] All 5 views load (Feed, Digests, Health, Search, Trends)
- [ ] Entry filters work (competitor, tag, relevance)
- [ ] Search returns results
- [ ] Entry actions work (review, note, share, battlecard)
- [ ] Health status shows correctly
- [ ] Digest expansion works
- [ ] Charts render on Trends view
- [ ] Mobile view is responsive
- [ ] Browser DevTools shows no CSP violations
- [ ] Worker logs show requests (Real-time logs)
- [ ] D1 database has data (120 entries)
- [ ] Cron triggers listed in Workers dashboard
- [ ] Fetch job runs on schedule (every 6 hours)
- [ ] Digest job runs on schedule (Monday 8 AM UTC)

### Performance Baseline

Test with:
```bash
# Page load time
curl -w "@curl-format.txt" -o /dev/null -s https://YOUR_DASHBOARD

# API response time
curl -w "Time: %{time_total}s\n" -o /dev/null -s https://YOUR_WORKER/api/entries
```

Target metrics:
- Dashboard load: < 2 seconds
- API response: < 500ms
- 99th percentile latency: < 1 second

---

## Rollback Plan

If issues occur in production:

### Rollback Worker
```bash
# List deployments
wrangler deployments list

# Rollback to previous version
wrangler rollback
```

### Rollback Pages
In Cloudflare dashboard:
- Go to Pages → Production deployment
- Click "Rollback" button
- Select previous deployment

### Restore Data
D1 database is persistent and won't be affected by code rollback.

If data corruption occurs:
```bash
# Export data as backup
wrangler d1 export DATABASE_NAME > backup.sql

# Restore from backup
wrangler d1 execute DATABASE_NAME --file backup.sql
```

---

## Monitoring & Maintenance

### Daily Checks

- [ ] Check Workers error rate (should be < 0.1%)
- [ ] Review any CSP violation reports
- [ ] Verify cron jobs executed

### Weekly Checks

- [ ] Check API latency trends
- [ ] Review Claude API usage ($0.40-0.50 typical)
- [ ] Ensure digest sends successfully every Monday

### Monthly Checks

- [ ] Review analytics dashboard
- [ ] Check Cloudflare bill (should be ~$5)
- [ ] Update competitor sources if needed
- [ ] Review entry tags and AI classification quality

---

## Troubleshooting

### API returns 401 Unauthorized

**Cause:** CF_Authorization token missing or invalid

**Solution:**
1. Check Access is properly configured
2. Verify token is being sent in requests
3. Check token expiration (tokens expire after ~24 hours)
4. Logout and re-login via Access

### CSP violations in console

**Cause:** Inline script or resource loading that CSP blocks

**Solution:**
1. Identify the resource in console error
2. Update CSP policy to allow it (if safe)
3. Or refactor code to not use inline scripts
4. Test locally first before deploying

### Cron jobs not running

**Cause:** Cron trigger not configured or invalid schedule

**Solution:**
1. Check `wrangler.toml` has `[[triggers.crons]]` section
2. Verify cron syntax is valid
3. Redeploy Worker: `wrangler deploy`
4. Check Workers dashboard Triggers tab
5. Manually test with `/api/trigger/fetch` endpoint

### Database connection errors

**Cause:** D1 binding not configured or database down

**Solution:**
1. Verify `wrangler.toml` has `[[d1_databases]]` section
2. Check database ID matches actual D1 database
3. Verify database exists: `wrangler d1 list`
4. Run migrations again if schema missing

### High latency (> 1 second)

**Cause:** Browser Rendering API is slow for HTML adapters

**Solution:**
1. Check which sources are using Browser adapter
2. Increase `check_interval_hours` to reduce frequency
3. Cache rendered pages longer
4. Consider switching HTML sources to simpler adapters if possible

---

## Security Hardening Checklist

- [ ] All secrets using `wrangler secret put` (not in code)
- [ ] CSP headers set on all responses
- [ ] HTTPS enforced (automatic with Cloudflare)
- [ ] CORS not enabled (API is same-origin only)
- [ ] SQL injection protection via parameterized queries
- [ ] XSS protection via textContent rendering
- [ ] SSRF protection via URL validator
- [ ] Rate limiting configured (if needed)
- [ ] Access policy restricts to authorized users
- [ ] MFA enabled for Access login (recommended)
- [ ] Secrets rotated regularly (Telegram token, API key)
- [ ] Logs monitored for suspicious activity

---

## Cost Estimation

**Monthly costs (typical usage):**

| Service | Cost | Notes |
|---------|------|-------|
| Workers | $5 | Paid plan (required for cron) |
| D1 | Free | <5M reads/day, <100K writes/day |
| KV | Free | <100K reads/day, <1K writes/day |
| R2 | Free | 10GB storage, 10M reads/month |
| Pages | Free | Static hosting |
| Access | Free | <50 users |
| Claude API | $0.40-0.50 | ~100 entries/week × $0.001 |
| **Total** | **~$5.50** | **Estimated monthly** |

**One-time costs:**
- Custom domain: Included in Cloudflare plan
- Setup: Free

---

## Next Steps After Deployment

1. **Monitor for 1 week** before considering stable
2. **Gather user feedback** on dashboard UX
3. **Optimize** based on analytics and error logs
4. **Add more competitors** as confidence increases
5. **Set up team access** via Access policies
6. **Integrate with internal tools** (Slack bot, battlecard updater, etc.)
7. **Build custom rules** in D1 for your specific competitors
8. **Create automated workflows** for digest action items

---

## Support & Documentation

- **Cloudflare Docs:** https://developers.cloudflare.com/
- **Workers Docs:** https://developers.cloudflare.com/workers/
- **Pages Docs:** https://developers.cloudflare.com/pages/
- **Access Docs:** https://developers.cloudflare.com/cloudflare-one/identity/
- **D1 Docs:** https://developers.cloudflare.com/d1/
- **Project Instructions:** See `project_instructions.md`
- **Testing Guide:** See `TESTING.md`

---

## Deployment Timeline

- **Setup:** 15-30 minutes (create accounts, configure services)
- **Deployment:** 5-10 minutes (deploy Worker and Pages)
- **Configuration:** 15-20 minutes (Access policies, identity providers)
- **Testing:** 10-15 minutes (verify all features work)
- **Total:** ~60 minutes for full production setup

Good luck! Your competitive intelligence platform is ready for production. 🚀
