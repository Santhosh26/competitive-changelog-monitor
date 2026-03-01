-- Seed initial sources for testing
-- Start with RSS feeds (Tier 1) — most reliable

-- Cloudflare Blog RSS (we know this works — for testing)
INSERT OR IGNORE INTO sources (id, competitor_name, source_url, source_type, parser_config, check_interval_hours)
VALUES (
  'src_cloudflare_blog',
  'Cloudflare',
  'https://blog.cloudflare.com/rss/',
  'rss',
  '{}',
  6
);

-- Fastly Blog (HTML — no RSS feed available)
INSERT OR IGNORE INTO sources (id, competitor_name, source_url, source_type, parser_config, check_interval_hours)
VALUES (
  'src_fastly_blog',
  'Fastly',
  'https://www.fastly.com/blog',
  'html',
  '{"article_selector": "article", "title_selector": "h2 a, h3 a", "date_selector": "time[datetime]", "summary_selector": "p", "link_attribute": "href"}',
  6
);

-- AWS What's New RSS
INSERT OR IGNORE INTO sources (id, competitor_name, source_url, source_type, parser_config, check_interval_hours)
VALUES (
  'src_aws_whats_new',
  'AWS CloudFront',
  'https://aws.amazon.com/about-aws/whats-new/recent/feed/',
  'rss',
  '{}',
  6
);
