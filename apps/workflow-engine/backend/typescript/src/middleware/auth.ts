/**
 * Bearer-token auth — sample-grade stub.
 *
 * Accepts any non-empty Bearer token and populates `req.principal` with
 * a synthetic principal whose tenants list is `['*']` (no real
 * authorization). Real deployers wire Firebase Auth / OIDC / their IdP.
 *
 * The `/health`, `/readiness`, and `/.well-known/openwop` routes are
 * exempt from auth; the discovery endpoint is intentionally public per
 * spec/v1/capabilities.md.
 */

import type { RequestHandler } from 'express';
import type { Principal } from '../types.js';

declare module 'express-serve-static-core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Request {
    principal?: Principal;
  }
}

const PUBLIC_PATH_PREFIXES = [
  '/health',
  '/readiness',
  '/.well-known/openwop',
  '/v1/openapi.json',
  // Pack-registry reads are public per spec/v1/node-packs.md §"Registry HTTP API".
  // Publishing (POST /v1/packs/...) would require auth — sample doesn't ship publish.
  '/v1/packs',
  // Signed-token interrupt resolution is intentionally unauth per spec —
  // the token IS the authorization. Note: this matches POST + GET on
  // /v1/interrupts/:token only; the authed-list endpoint lives under
  // /v1/host/sample/runs/:id/interrupts and is auth-gated.
  '/v1/interrupts',
];

/**
 * Configured valid Bearer tokens. Comma-separated via OPENWOP_API_KEYS.
 * Falls back to OPENWOP_API_KEY (single key) for the conformance harness.
 *
 * Sample policy: a presented Bearer token MUST match one of these. Real
 * deployers swap this for IdP-validated JWTs / Firebase Auth / etc.
 *
 * Read lazily on each request so tests can set the env after module load.
 * Cached with a process-wide reset on env change. For a sample, the
 * Set rebuild on every request is negligible (~1us); production deploys
 * memoize via a module-load-once handler when the IdP is wired.
 */
function readValidKeys(): ReadonlySet<string> {
  const multi = process.env.OPENWOP_API_KEYS;
  const single = process.env.OPENWOP_API_KEY;
  const raw = multi ?? single ?? 'sample-token';
  return new Set(raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0));
}

export function authMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (PUBLIC_PATH_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
      next();
      return;
    }
    // Header takes precedence; ?apiKey= is the EventSource fallback
    // (browsers can't set custom headers on EventSource per WHATWG).
    // Real deployers should NOT replicate this fallback — wire a session
    // cookie or a one-shot signed-token endpoint instead.
    const header = req.header('authorization');
    let token: string | undefined;
    if (header && header.toLowerCase().startsWith('bearer ')) {
      token = header.slice('bearer '.length).trim();
    } else if (typeof req.query.apiKey === 'string' && req.query.apiKey.trim().length > 0) {
      token = req.query.apiKey.trim();
    }
    if (!token) {
      res.status(401).json({
        error: 'unauthenticated',
        message: 'Missing Bearer token (Authorization header) or apiKey query param.',
      });
      return;
    }
    if (!readValidKeys().has(token)) {
      // Unknown token → 401 per spec/v1/auth.md §3 (NOT 200, NOT 403).
      res.status(401).json({
        error: 'unauthenticated',
        message: 'Bearer token is not recognized by this host.',
      });
      return;
    }
    const principal: Principal = {
      principalId: `sample-principal:${token.slice(0, 8)}`,
      tenants: ['*'],
      token,
    };
    req.principal = principal;
    next();
  };
}
