/**
 * CORS middleware for cross-origin browser access.
 *
 * Sample default: reflect any Origin (open CORS). Real deployers wire
 * an allowlist via OPENWOP_CORS_ORIGINS (comma-separated). Always-on
 * because the React FE bundled with this sample runs on a different
 * port than the BE and would otherwise be blocked by the browser's
 * same-origin policy.
 *
 * Preflight OPTIONS requests are handled before the auth middleware so
 * the browser's preflight succeeds even without credentials (per the
 * CORS spec — credentials only matter on the actual request).
 */

import type { RequestHandler } from 'express';

function loadAllowedOrigins(): RegExp | string[] {
  const raw = process.env.OPENWOP_CORS_ORIGINS;
  if (!raw || raw === '*') return /.*/;
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export function corsMiddleware(): RequestHandler {
  return (req, res, next) => {
    const origin = req.header('origin');
    if (origin) {
      const allowed = loadAllowedOrigins();
      const ok = allowed instanceof RegExp ? allowed.test(origin) : allowed.includes(origin);
      if (ok) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
        res.set('Access-Control-Allow-Credentials', 'true');
        res.set(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type, Idempotency-Key, Last-Event-ID, Traceparent, Tracestate',
        );
        res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.set('Access-Control-Expose-Headers', 'Capabilities-Etag');
        res.set('Access-Control-Max-Age', '600');
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).send();
      return;
    }
    next();
  };
}
