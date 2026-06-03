/**
 * Auth middleware. Supports two modes:
 *
 *   1. Signed session cookie (`__session` by default, configurable via
 *      OPENWOP_SESSION_COOKIE_NAME) — the default for
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
 *    __session=<payloadB64>.<sigB64>
 * where payloadB64 = base64url(JSON.stringify({sid, tenantId, tier, iat, exp}))
 *       sigB64     = base64url(HMAC_SHA256(secret, payloadB64))
 * Constant-time signature compare via timingSafeEqual.
 *
 * @see SECURITY/external-audit-engagement.md §2.1.1
 * @see plans/openwop-app-deployment-plan.md (P0.2)
 */

import type { RequestHandler } from 'express';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Principal } from '../types.js';
import { createLogger } from '../observability/logger.js';
import { noteTenantActivity } from '../routes/admin.js';
import {
  OidcVerifier,
  OidcVerificationError,
  readOidcConfigFromEnv,
  type OidcClaims,
} from './oidcVerifier.js';

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
  // RFC 0055 §C media-asset serving: GET /v1/host/sample/assets/{token} is
  // token-authed (the 32-byte capability token is the credential, like
  // /v1/interrupts/{token}), so embeddable <img src> URLs work without a
  // bearer/cookie. The store path (POST /v1/host/sample/media/put) is NOT
  // under this prefix and stays authenticated.
  '/v1/host/sample/assets',
  // Demo messaging relay device-loop (heartbeat/inbound/outbound/ack) is
  // authed by the per-device token in the `x-openwop-device-token` header
  // — the device token is the credential, like /v1/interrupts/{token}. The
  // operator endpoints (register/activate/revoke/enqueue, connectors,
  // sessions) are NOT under /device and stay bearer-authed.
  '/v1/host/sample/messaging/device',
  // Admin endpoints do their own constant-time check against
  // OPENWOP_ADMIN_TOKEN (separate from OPENWOP_API_KEYS so the
  // session/bearer paths can't confuse the two). Bypassing the
  // session-cookie auth path here lets Cloud Scheduler hit the
  // cleanup cron with just the Bearer admin token.
  '/v1/host/sample/admin',
];

// Firebase Hosting strips every cookie except `__session` from
// requests it forwards to Cloud Run/Functions
// (https://firebase.google.com/docs/hosting/manage-cache#using_cookies).
// Adopters fronting the workflow-engine with a different reverse proxy
// can override this via OPENWOP_SESSION_COOKIE_NAME — default keeps
// the app.openwop.dev demo working.
const COOKIE_NAME = process.env.OPENWOP_SESSION_COOKIE_NAME || '__session';
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

/**
 * Pure config check for the session secret — returns a human-readable reason
 * when production requires `OPENWOP_SESSION_SECRET` but it's unset/too short,
 * else null. Shared with the `/readiness` route so the health check reflects
 * the SAME condition that makes cookie-minting throw: previously readiness
 * returned 200 while the first session-minting POST 503'd, so the health check
 * lied about a deploy that was actually broken (PRD §8.3). Dev uses an ephemeral
 * fallback, so this is null outside production.
 */
export function sessionSecretConfigError(): string | null {
  const s = process.env.OPENWOP_SESSION_SECRET;
  if (s && s.length >= 32) return null;
  if (process.env.NODE_ENV === 'production') {
    return 'OPENWOP_SESSION_SECRET must be set in production (>=32 chars) — cookie-session minting will fail without it';
  }
  return null;
}

function readSessionSecret(): string {
  const s = process.env.OPENWOP_SESSION_SECRET;
  if (s && s.length >= 32) return s;
  const configError = sessionSecretConfigError();
  if (configError) {
    // Hard fail in production rather than mint cookies with a weak
    // / predictable secret. Cookie-mode deploys MUST set this.
    throw new Error(`${configError}. See P0.2 in the deploy plan.`);
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

/** Lazy-init OIDC verifier — if config is unset, returns null and the
 *  bearer branch falls through to the API-key allow-list. */
let oidcVerifierInstance: OidcVerifier | null | undefined;
function getOidcVerifier(): OidcVerifier | null {
  if (oidcVerifierInstance !== undefined) return oidcVerifierInstance;
  const cfg = readOidcConfigFromEnv();
  oidcVerifierInstance = cfg ? new OidcVerifier(cfg) : null;
  if (oidcVerifierInstance) {
    log.info('OIDC verifier configured', { issuer: cfg!.issuer, audience: cfg!.audience });
  }
  return oidcVerifierInstance;
}

/** Map a verified OIDC claim set to a deterministic openwop tenant id.
 *  Issuer-scoped SHA-256 of `<iss>:<sub>` so cross-IdP `sub` collisions
 *  are impossible. Truncates to 32 hex chars (128 bits) — plenty for
 *  unique-per-user across any realistic IdP+user count. */
function tenantIdFromOidc(claims: OidcClaims): string {
  const h = createHash('sha256').update(`${claims.iss}:${claims.sub}`).digest('hex').slice(0, 32);
  return `user:${h}`;
}

/** Test affordance — wipe the verifier singleton so subsequent calls
 *  re-read env vars. Used by unit tests that flip OPENWOP_OIDC_*. */
export function _resetOidcVerifier(): void {
  oidcVerifierInstance = undefined;
}

/** Sliding-window failure tracker for OIDC verify fall-throughs. A
 *  misconfigured `OPENWOP_OIDC_AUDIENCE` would silently downgrade
 *  every signed-in user to the anon path; without an aggregate signal
 *  the only evidence is per-request `log.warn` entries that get
 *  drowned out under normal token-rotation churn. We track the count
 *  in the trailing 60s window and emit a louder `log.error` (with the
 *  config snapshot operators need to debug) when failures cross the
 *  threshold — once per minute, so a sustained problem reports
 *  steadily without per-request noise. */
const FALLTHROUGH_WINDOW_MS = 60_000;
const FALLTHROUGH_ALARM_THRESHOLD = 10;
let fallthroughTimestamps: number[] = [];
let lastFallthroughAlarmAt = 0;

function noteOidcFallthrough(reason: string): void {
  const now = Date.now();
  // Drop timestamps outside the trailing window so the array stays
  // bounded to roughly one minute's worth of failures.
  fallthroughTimestamps = fallthroughTimestamps.filter((t) => now - t < FALLTHROUGH_WINDOW_MS);
  fallthroughTimestamps.push(now);
  if (
    fallthroughTimestamps.length >= FALLTHROUGH_ALARM_THRESHOLD
    && now - lastFallthroughAlarmAt > FALLTHROUGH_WINDOW_MS
  ) {
    lastFallthroughAlarmAt = now;
    const cfg = readOidcConfigFromEnv();
    log.error('OIDC fall-through rate exceeded threshold — verify OPENWOP_OIDC_* config', {
      countInWindow: fallthroughTimestamps.length,
      windowMs: FALLTHROUGH_WINDOW_MS,
      lastReason: reason,
      configuredIssuer: cfg?.issuer ?? null,
      configuredAudience: cfg?.audience ?? null,
    });
  }
}

/** Test affordance — reset the fall-through tracker so unit tests get
 *  a clean window between assertions. */
export function _resetFallthroughTracker(): void {
  fallthroughTimestamps = [];
  lastFallthroughAlarmAt = 0;
}

/** When bearer verification fails, the middleware can either (a) emit
 *  401 immediately (the original, strict behavior — required when
 *  cookies are disabled and there's nothing to fall back to) or (b)
 *  fall through to the cookie path so a browser with a healthy session
 *  cookie isn't poisoned by a stale Firebase ID token. (b) is the
 *  default when cookies are enabled. */
export function authMiddleware(): RequestHandler {
  const cookiesDisabled = process.env.OPENWOP_AUTH_DISABLE_COOKIES === 'true';
  // When set, a request with no bearer AND no valid session cookie gets a strict
  // 401 instead of an auto-minted anon session — the spec-correct bearer-required
  // posture (auth.md). Default-off preserves the app.openwop.dev demo's anon-session
  // UX; production / conformance set it so "no Authorization → 401" holds
  // independently of NODE_ENV (the anon fallback was previously only suppressed
  // under NODE_ENV=production).
  const enforceBearer = process.env.OPENWOP_AUTH_ENFORCE_BEARER === 'true';
  return async (req, res, next) => {
    if (PUBLIC_PATH_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
      next();
      return;
    }

    // Read + verify the session cookie ONCE up front, even though we
    // only consume it on the cookie path or the OIDC-promotion path
    // below. The bearer-success branch needs it to decide whether to
    // reissue the cookie as user-tier; the cookie branch needs it to
    // decide mint-vs-refresh. Computing it twice (the prior shape)
    // risked drift if the verification logic ever diverged between
    // the two sites. Skip entirely in `cookiesDisabled` mode — there
    // are no cookies to read.
    const cookieSession = (() => {
      if (cookiesDisabled) return null;
      const raw = readCookie(req.header('cookie'), COOKIE_NAME);
      return raw ? verifySession(raw) : null;
    })();

    // ─── 1. Bearer token (or ?apiKey= for SSE EventSource) ───
    const header = req.header('authorization');
    let bearerToken: string | undefined;
    if (header && header.toLowerCase().startsWith('bearer ')) {
      bearerToken = header.slice('bearer '.length).trim();
    } else if (typeof req.query.apiKey === 'string' && req.query.apiKey.trim().length > 0) {
      bearerToken = req.query.apiKey.trim();
    }
    if (bearerToken) {
      // Try the API-key allow-list first (cheap, sync). API keys are
      // short opaque strings; OIDC tokens are dot-segmented JWTs. The
      // shape disambiguates without crypto.
      if (readValidKeys().has(bearerToken)) {
        // API-key path — wildcard tenant (conformance harness / admin
        // tooling). Real deployments narrow via a key→tenant table.
        req.principal = {
          principalId: `bearer:${bearerToken.slice(0, 8)}`,
          tenants: ['*'],
          token: bearerToken,
        };
        next();
        return;
      }
      // Looks like a JWT? Try OIDC verification.
      const looksLikeJwt = bearerToken.split('.').length === 3;
      const oidc = getOidcVerifier();
      if (looksLikeJwt && oidc) {
        try {
          const claims = await oidc.verify(bearerToken);
          const tenantId = tenantIdFromOidc(claims);
          req.tenantId = tenantId;
          req.principal = {
            principalId: `oidc:${claims.sub}`,
            tenants: [tenantId],
            token: bearerToken,
          };
          noteTenantActivity(tenantId);
          // Promote the session cookie to user-tier so the cookie path
          // agrees with the bearer path on identity. Without this, any
          // subsequent request that drops the `Authorization` header
          // (token-cache race in the SPA, background revalidation,
          // EventSource without `?apiKey=`) falls back to the still-
          // anon cookie and lands at managed-dispatch as anon — even
          // though the user is signed in. Reissues only when the
          // existing cookie doesn't already match this user, so this
          // is a no-op on the steady-state hot path.
          if (!cookiesDisabled
            && (!cookieSession || cookieSession.tenantId !== tenantId || cookieSession.tier !== 'user')
          ) {
            const sid = base64urlEncode(randomBytes(18));
            const now = Math.floor(Date.now() / 1000);
            const upgraded: SessionPayload = {
              sid,
              tenantId,
              tier: 'user',
              iat: now,
              exp: now + COOKIE_TTL_SECONDS,
            };
            setSessionCookie(res, signSession(upgraded));
          }
          next();
          return;
        } catch (err: unknown) {
          // Stale / expired / wrong-audience JWTs would previously
          // kill the request with 401 even when the browser still
          // had a healthy session cookie. The Firebase JS SDK rotates
          // ID tokens ~hourly but the FE's `cachedIdToken` can lag
          // a few seconds behind the actual rotation, so any in-flight
          // request landing in that window used to hard-fail.
          //
          // Behavior split:
          //   - `cookiesDisabled` (server-to-server callers, the OIDC
          //     conformance test surface) — keep the strict 401 with
          //     the verification reason. There's no fallback path to
          //     use and silently downgrading would be wrong.
          //   - Cookies enabled (the browser case) — log + fall
          //     through to the cookie path so a healthy session
          //     cookie keeps the request alive. Worst case the user
          //     lands on the anon path, which still works for tenant-
          //     scoped reads that key off the resource's tenantId.
          const code = err instanceof OidcVerificationError ? err.code : 'verification_failed';
          if (cookiesDisabled) {
            res.status(401).json({
              error: 'unauthenticated',
              message: 'OIDC token rejected.',
              details: { reason: code },
            });
            return;
          }
          log.warn('OIDC verify failed — falling through to cookie path', { code });
          noteOidcFallthrough(code);
          // fall through
        }
      } else {
        // Bearer present, but neither in the allow-list nor a JWT
        // shape we can verify. Mirror the verify-failure branch:
        // strict 401 when cookies are disabled, log + fall through
        // otherwise.
        if (cookiesDisabled) {
          res.status(401).json({
            error: 'unauthenticated',
            message: 'Bearer token is not recognized by this host.',
          });
          return;
        }
        log.warn('Bearer token unrecognized — falling through to cookie path', {
          looksLikeJwt,
          hasOidc: oidc !== null,
        });
        noteOidcFallthrough(looksLikeJwt ? 'jwt_no_verifier' : 'not_jwt');
        // fall through
      }
    }

    // ─── 2. Session cookie (default for browsers) ───
    if (cookiesDisabled) {
      res.status(401).json({
        error: 'unauthenticated',
        message: 'Missing Bearer token (Authorization header) or apiKey query param.',
      });
      return;
    }
    let session = cookieSession;
    if (!session) {
      if (enforceBearer) {
        // Bearer-required posture: no anon fallback. Matches the spec contract
        // (auth.md) + lets the conformance `auth.test.ts` "no Authorization → 401"
        // pass against the reference host without forcing NODE_ENV=production.
        res.status(401).json({
          error: 'unauthenticated',
          message: 'Missing Bearer token (Authorization header) or apiKey query param.',
        });
        return;
      }
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
