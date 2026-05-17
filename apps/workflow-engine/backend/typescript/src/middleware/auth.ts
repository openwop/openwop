/**
 * Auth middleware. Supports two modes:
 *
 *   1. Signed session cookie (`openwop.session`) — the default for
 *      browser visitors on the public demo. On first request without
 *      a cookie, mints one: HS256 over a small JSON payload
 *      `{ sid, tenantId: "anon:<sid>", tier: "anon", iat, exp }`. Each
 *      visitor gets a fresh tenantId derived from their cookie so
 *      cross-tenant collisions are impossible. 24h sliding window.
 *
 *   2. Bearer-token allow-list — for the conformance harness + curl
 *      smoke + signed-in users (Phase 3). Token values come from
 *      `OPENWOP_API_KEYS` (CSV) or `OPENWOP_API_KEY` (single). Default
 *      `sample-token` for local dev; production deployments MUST set
 *      either OPENWOP_API_KEYS (real keys) or rely on cookies only.
 *
 * Modes are NOT mutually exclusive — Bearer auth wins when present;
 * cookie auth is the fallback. Set `OPENWOP_AUTH_DISABLE_COOKIES=true`
 * to require Bearer (legacy conformance / curl-only deploys).
 *
 * Public paths (`/health`, `/readiness`, `/.well-known/openwop`,
 * `/v1/openapi.json`, `/v1/packs/*`, `/v1/interrupts/*`) bypass auth
 * entirely.
 *
 * Tenant derivation: `req.principal.tenants[0]` and `req.tenantId` are
 * BOTH set from the authenticated principal. Routes that need a
 * tenant MUST read from `req.tenantId` (or fall back to req.body but
 * the principalAuthorizer will reject mismatched values). This kills
 * the cross-tenant impersonation hole where `body.tenantId` could be
 * any string a caller wanted.
 *
 * Session cookie shape — single base64url-encoded value containing
 * payload + HS256 signature:
 *    openwop.session=<payloadB64>.<sigB64>
 * where payloadB64 = base64url(JSON.stringify({sid, tenantId, tier, iat, exp}))
 *       sigB64     = base64url(HMAC_SHA256(secret, payloadB64))
 * Constant-time signature compare via timingSafeEqual.
 *
 * @see SECURITY/external-audit-engagement.md §2.1.1
 * @see plans/openwop-app-deployment-plan.md (P0.2)
 */

import type { RequestHandler } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Principal } from '../types.js';
import { createLogger } from '../observability/logger.js';
import { noteTenantActivity } from '../routes/admin.js';

const log = createLogger('middleware.auth');

declare module 'express-serve-static-core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Request {
    principal?: Principal;
    /** Tenant id derived from the authenticated principal. Routes
     *  SHOULD prefer this over `req.body.tenantId` so a misbehaving
     *  client can't claim another tenant. */
    tenantId?: string;
  }
}

const PUBLIC_PATH_PREFIXES = [
  '/health',
  '/readiness',
  '/.well-known/openwop',
  '/v1/openapi.json',
  '/v1/packs',
  '/v1/interrupts',
  // Admin endpoints do their own constant-time check against
  // OPENWOP_ADMIN_TOKEN (separate from OPENWOP_API_KEYS so the
  // session/bearer paths can't confuse the two). Bypassing the
  // session-cookie auth path here lets Cloud Scheduler hit the
  // cleanup cron with just the Bearer admin token.
  '/v1/host/sample/admin',
];

const COOKIE_NAME = 'openwop.session';
const COOKIE_TTL_SECONDS = 86_400; // 24h
const REFRESH_THRESHOLD_SECONDS = 21_600; // refresh when < 6h left

interface SessionPayload {
  sid: string;
  tenantId: string;
  tier: 'anon' | 'user';
  iat: number;
  exp: number;
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(s: string): Buffer {
  let pad = s.replace(/-/g, '+').replace(/_/g, '/');
  while (pad.length % 4 !== 0) pad += '=';
  return Buffer.from(pad, 'base64');
}

function readSessionSecret(): string {
  const s = process.env.OPENWOP_SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') {
    // Hard fail in production rather than mint cookies with a weak
    // / predictable secret. Cookie-mode deploys MUST set this.
    throw new Error('OPENWOP_SESSION_SECRET must be set in production (>=32 chars). See P0.2 in the deploy plan.');
  }
  // Dev fallback: stable per-process random secret. Cookies invalidate
  // on restart, which is fine for local dev.
  if (!process.env._OPENWOP_DEV_SESSION_SECRET) {
    process.env._OPENWOP_DEV_SESSION_SECRET = randomBytes(32).toString('hex');
    log.warn('OPENWOP_SESSION_SECRET unset; using ephemeral dev secret (cookies invalidate on restart)');
  }
  return process.env._OPENWOP_DEV_SESSION_SECRET;
}

function signSession(payload: SessionPayload): string {
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', readSessionSecret()).update(payloadB64).digest();
  return `${payloadB64}.${base64urlEncode(sig)}`;
}

function verifySession(cookie: string): SessionPayload | null {
  const dot = cookie.indexOf('.');
  if (dot <= 0 || dot === cookie.length - 1) return null;
  const payloadB64 = cookie.slice(0, dot);
  const sigB64 = cookie.slice(dot + 1);
  const expected = createHmac('sha256', readSessionSecret()).update(payloadB64).digest();
  let provided: Buffer;
  try { provided = base64urlDecode(sigB64); } catch { return null; }
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;
  let payload: SessionPayload;
  try { payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8')) as SessionPayload; }
  catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.tenantId !== 'string' || typeof payload.sid !== 'string') return null;
  return payload;
}

function mintAnonSession(): SessionPayload {
  const sid = base64urlEncode(randomBytes(18));
  const now = Math.floor(Date.now() / 1000);
  return {
    sid,
    tenantId: `anon:${sid}`,
    tier: 'anon',
    iat: now,
    exp: now + COOKIE_TTL_SECONDS,
  };
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  // RFC 6265 cookie header is `k1=v1; k2=v2; …`.
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return undefined;
}

function setSessionCookie(res: import('express').Response, signed: string): void {
  const secure = process.env.NODE_ENV === 'production' || process.env.OPENWOP_COOKIE_SECURE === 'true';
  // SameSite=Lax intentional. The cookie is scoped to the user-facing
  // host (app.openwop.dev) where the SPA + backend share an origin via
  // Firebase Hosting's `/api/**` → Cloud Run rewrite. Direct browser
  // requests to the underlying Cloud Run URL (`*-run.app`) are cross-
  // site, so the cookie correctly does NOT travel there. Do NOT relax
  // to SameSite=None — that would weaken CSRF defenses without
  // unlocking any legitimate flow (anyone hitting the Cloud Run URL
  // directly is already off the supported path).
  const parts = [
    `${COOKIE_NAME}=${signed}`,
    `Path=/`,
    `Max-Age=${COOKIE_TTL_SECONDS}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function readValidKeys(): ReadonlySet<string> {
  const multi = process.env.OPENWOP_API_KEYS;
  const single = process.env.OPENWOP_API_KEY;
  const raw = multi ?? single ?? 'sample-token';
  return new Set(raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0));
}

export function authMiddleware(): RequestHandler {
  const cookiesDisabled = process.env.OPENWOP_AUTH_DISABLE_COOKIES === 'true';
  return (req, res, next) => {
    if (PUBLIC_PATH_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
      next();
      return;
    }

    // ─── 1. Bearer token (or ?apiKey= for SSE EventSource) ───
    const header = req.header('authorization');
    let bearerToken: string | undefined;
    if (header && header.toLowerCase().startsWith('bearer ')) {
      bearerToken = header.slice('bearer '.length).trim();
    } else if (typeof req.query.apiKey === 'string' && req.query.apiKey.trim().length > 0) {
      bearerToken = req.query.apiKey.trim();
    }
    if (bearerToken) {
      if (!readValidKeys().has(bearerToken)) {
        res.status(401).json({
          error: 'unauthenticated',
          message: 'Bearer token is not recognized by this host.',
        });
        return;
      }
      // Bearer-authed principals get the wildcard tenant — they're
      // typically the conformance harness or a steward-internal tool.
      // Real deployments should narrow this via a key-to-tenant table.
      const principal: Principal = {
        principalId: `bearer:${bearerToken.slice(0, 8)}`,
        tenants: ['*'],
        token: bearerToken,
      };
      req.principal = principal;
      // No req.tenantId for bearer auth — caller provides it.
      next();
      return;
    }

    // ─── 2. Session cookie (default for browsers) ───
    if (cookiesDisabled) {
      res.status(401).json({
        error: 'unauthenticated',
        message: 'Missing Bearer token (Authorization header) or apiKey query param.',
      });
      return;
    }
    const cookieRaw = readCookie(req.header('cookie'), COOKIE_NAME);
    let session = cookieRaw ? verifySession(cookieRaw) : null;
    if (!session) {
      session = mintAnonSession();
      setSessionCookie(res, signSession(session));
    } else {
      // Sliding-window refresh: if the cookie is past the refresh
      // threshold, reissue it.
      const now = Math.floor(Date.now() / 1000);
      if (session.exp - now < REFRESH_THRESHOLD_SECONDS) {
        session.iat = now;
        session.exp = now + COOKIE_TTL_SECONDS;
        setSessionCookie(res, signSession(session));
      }
    }
    req.tenantId = session.tenantId;
    req.principal = {
      principalId: `session:${session.sid}`,
      tenants: [session.tenantId],
      token: '', // sessions don't carry a bearer token
    };
    // Tells the daily cleanup endpoint this tenant is still live so
    // its ephemeral BYOK secrets aren't GC'd.
    noteTenantActivity(session.tenantId);
    next();
  };
}
