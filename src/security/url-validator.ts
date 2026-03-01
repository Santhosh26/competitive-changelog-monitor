/**
 * SSRF-safe URL validator.
 *
 * Every URL configured as a source MUST pass through this before any fetch().
 *
 * WHY THIS MATTERS:
 * SSRF (Server-Side Request Forgery) is when an attacker tricks your server
 * into making requests to internal resources. Since our app fetches URLs that
 * users configure, a malicious user could set a source URL to:
 *   - http://169.254.169.254/latest/meta-data/  (AWS/GCP metadata endpoint)
 *   - http://127.0.0.1:8080/admin                (internal admin panel)
 *   - http://10.0.0.1/internal-api               (private network)
 *
 * Our validator blocks ALL of these by enforcing:
 *   1. HTTPS only (no HTTP — prevents downgrade + most internal targets use HTTP)
 *   2. No private/reserved IP ranges (RFC 1918, link-local, loopback, IPv6 private)
 *   3. No Cloudflare internal domains (prevent self-reference loops)
 *   4. Standard port only (443 for HTTPS)
 *   5. Valid TLD (no "localhost", no bare IPs)
 *
 * Reference: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
 */

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// Private/reserved IPv4 ranges (CIDR notation → checker functions)
const PRIVATE_IPV4_RANGES: Array<{ prefix: number[]; bits: number; label: string }> = [
  { prefix: [10], bits: 8, label: 'RFC 1918 (10.0.0.0/8)' },
  { prefix: [172, 16], bits: 12, label: 'RFC 1918 (172.16.0.0/12)' },
  { prefix: [192, 168], bits: 16, label: 'RFC 1918 (192.168.0.0/16)' },
  { prefix: [169, 254], bits: 16, label: 'Link-local (169.254.0.0/16)' },
  { prefix: [127], bits: 8, label: 'Loopback (127.0.0.0/8)' },
  { prefix: [0], bits: 8, label: 'Current network (0.0.0.0/8)' },
  { prefix: [100, 64], bits: 10, label: 'Shared address (100.64.0.0/10)' },
  { prefix: [198, 18], bits: 15, label: 'Benchmark (198.18.0.0/15)' },
];

// Cloudflare internal domains we must not target (prevent self-reference)
const BLOCKED_DOMAIN_SUFFIXES = [
  '.workers.dev',
  '.pages.dev',
  '.cloudflareclient.com',
  '.cloudflare-gateway.com',
];

/**
 * Check if a string looks like an IPv4 address.
 */
function isIPv4(hostname: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/**
 * Check if a string looks like an IPv6 address (including bracket-wrapped).
 */
function isIPv6(hostname: string): boolean {
  const cleaned = hostname.replace(/^\[|\]$/g, '');
  return cleaned.includes(':');
}

/**
 * Check if an IPv4 address falls within a private/reserved range.
 */
function isPrivateIPv4(ip: string): string | null {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => isNaN(o) || o < 0 || o > 255)) {
    return 'Invalid IPv4 address';
  }

  for (const range of PRIVATE_IPV4_RANGES) {
    let match = true;
    for (let i = 0; i < range.prefix.length; i++) {
      if (range.bits >= (i + 1) * 8) {
        // Full octet must match
        if (octets[i] !== range.prefix[i]) {
          match = false;
          break;
        }
      } else {
        // Partial octet — check high bits
        const maskBits = range.bits - i * 8;
        const mask = (0xff << (8 - maskBits)) & 0xff;
        if ((octets[i] & mask) !== (range.prefix[i] & mask)) {
          match = false;
          break;
        }
      }
    }
    if (match) return range.label;
  }

  return null;
}

/**
 * Check if an IPv6 address is private/reserved.
 */
function isPrivateIPv6(hostname: string): string | null {
  const cleaned = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (cleaned === '::1') return 'IPv6 loopback (::1)';
  if (cleaned.startsWith('fc') || cleaned.startsWith('fd')) return 'IPv6 unique-local (fc00::/7)';
  if (cleaned.startsWith('fe80')) return 'IPv6 link-local (fe80::/10)';
  if (cleaned === '::' || cleaned === '0:0:0:0:0:0:0:0') return 'IPv6 unspecified (::)';

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4MappedMatch = cleaned.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch) {
    const v4Result = isPrivateIPv4(v4MappedMatch[1]);
    if (v4Result) return `IPv4-mapped IPv6 → ${v4Result}`;
  }

  return null;
}

/**
 * Check if the hostname has a valid TLD (not localhost, not numeric-only).
 */
function hasValidTLD(hostname: string): boolean {
  if (hostname === 'localhost') return false;
  if (isIPv4(hostname)) return false;
  if (isIPv6(hostname)) return false;

  // Must contain at least one dot and a TLD
  const parts = hostname.split('.');
  if (parts.length < 2) return false;

  const tld = parts[parts.length - 1];
  // TLD must be alphabetic and at least 2 chars
  return /^[a-zA-Z]{2,}$/.test(tld);
}

/**
 * Validate that a URL is safe to fetch (no SSRF).
 *
 * Returns { valid: true } if the URL is safe, or { valid: false, reason: "..." } if not.
 */
export function validateUrl(url: string): ValidationResult {
  // 1. Must be a parseable URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // 2. Must use HTTPS (never HTTP for external fetches)
  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: `Protocol must be HTTPS, got ${parsed.protocol.replace(':', '')}`,
    };
  }

  // 3. Must not use non-standard ports (only 443 for HTTPS)
  if (parsed.port && parsed.port !== '443') {
    return {
      valid: false,
      reason: `Non-standard port ${parsed.port} is not allowed (only 443 for HTTPS)`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 4. Must not be a bare IP address (require domain names with valid TLDs)
  if (isIPv4(hostname)) {
    const privateRange = isPrivateIPv4(hostname);
    if (privateRange) {
      return { valid: false, reason: `Private IP blocked: ${privateRange}` };
    }
    // Even public IPs are blocked — require a domain name
    return { valid: false, reason: 'Bare IP addresses are not allowed; use a domain name' };
  }

  if (isIPv6(hostname)) {
    const privateRange = isPrivateIPv6(hostname);
    if (privateRange) {
      return { valid: false, reason: `Private IPv6 blocked: ${privateRange}` };
    }
    return { valid: false, reason: 'Bare IPv6 addresses are not allowed; use a domain name' };
  }

  // 5. Must have a valid TLD (not "localhost")
  if (!hasValidTLD(hostname)) {
    return {
      valid: false,
      reason: `Hostname "${hostname}" must have a valid TLD (not localhost or bare IP)`,
    };
  }

  // 6. Must not target Cloudflare internal domains
  for (const suffix of BLOCKED_DOMAIN_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return {
        valid: false,
        reason: `Cloudflare internal domain "${suffix}" is blocked (prevents self-reference)`,
      };
    }
  }

  return { valid: true };
}
