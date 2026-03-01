/**
 * Cloudflare Access JWT validation middleware.
 *
 * Validates the CF_Authorization cookie (set by Cloudflare Access on all requests).
 * Extracts user email for audit logging and stores in context.
 *
 * In local dev (wrangler dev), CF_Authorization won't be present unless Access is configured.
 * For testing, we log a warning but allow the request to proceed.
 *
 * Reference: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

import { Context, Next } from 'hono';
import { Env } from '../env';

interface JWTPayload {
  iss?: string;
  sub?: string;
  aud?: string[];
  email?: string;
  name?: string;
  iat?: number;
  exp?: number;
}

/**
 * Parse and validate Cloudflare Access JWT.
 * Extracts claims without full JWKS validation (suitable for MVP).
 * In production, you would verify the signature against Cloudflare's public keys.
 */
function parseAccessJWT(token: string): JWTPayload | null {
  try {
    // JWT format: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode the payload (second part)
    const payloadStr = parts[1];
    // Add padding if needed
    const padding = 4 - (payloadStr.length % 4);
    const paddedPayload = padding < 4 ? payloadStr + '='.repeat(padding) : payloadStr;

    const decoded = atob(paddedPayload);
    const payload = JSON.parse(decoded) as JWTPayload;

    // Verify expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      console.warn('[auth] JWT expired');
      return null;
    }

    // Verify issuer is Cloudflare Access
    if (!payload.iss?.includes('cloudflareaccess')) {
      console.warn('[auth] JWT issuer not Cloudflare Access:', payload.iss);
      // Allow for local development
    }

    return payload;
  } catch (err: any) {
    console.error('[auth] JWT parsing failed:', err.message);
    return null;
  }
}

/**
 * Middleware: Validate Cloudflare Access JWT on incoming requests.
 * Extracts user email and stores in context.
 * Returns 401 if JWT is missing or invalid.
 */
export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  // Get JWT from CF_Authorization cookie or Authorization header
  let token: string | null = null;

  // Try CF_Authorization cookie first (standard Cloudflare Access cookie)
  const cookies = c.req.header('cookie');
  if (cookies) {
    const match = cookies.match(/CF_Authorization=([^;]+)/);
    if (match) {
      token = match[1];
    }
  }

  // Fall back to Authorization header
  if (!token) {
    const authHeader = c.req.header('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  // In production (behind Access), JWT must be present
  // In development (wrangler dev), allow requests without JWT but log warning
  if (!token) {
    const url = new URL(c.req.url);
    // Allow health check without auth
    if (url.pathname === '/') {
      await next();
      return;
    }

    // Check if running in development mode
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (isLocal) {
      console.warn('[auth] No CF_Authorization token found (development mode) — allowing request');
      c.set('user:email', 'dev@local');
      c.set('user:name', 'Developer');
      await next();
      return;
    }

    // Production: reject without token
    console.error('[auth] No CF_Authorization token found');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Parse and validate JWT
  const payload = parseAccessJWT(token);
  if (!payload) {
    console.error('[auth] Invalid or expired JWT');
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Extract user email and name for audit logging
  const email = payload.email || payload.sub || 'unknown';
  const name = payload.name || email.split('@')[0];

  // Store in context for downstream middleware/handlers to use
  c.set('user:email', email);
  c.set('user:name', name);
  c.set('user:jwt', payload);

  console.log(`[auth] Request from ${email} to ${new URL(c.req.url).pathname}`);

  await next();
}
