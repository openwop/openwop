/**
 * Admin routes (P0.5 of the app.openwop.dev deploy hardening).
 * Vendor-prefixed under /v1/host/sample/admin/* — outside the OpenWOP
 * wire contract. Authed via a separate Bearer token from
 * OPENWOP_ADMIN_TOKEN (NOT the regular OPENWOP_API_KEYS) so admin
 * privileges don't leak through a regular API key.
 *
 * Endpoints:
 *
 *   POST /v1/host/sample/admin/cleanup
 *     Daily cleanup: wipes anon-session ephemeral BYOK secrets that
 *     haven't been touched in the cleanup window (default 24h). The
 *     session cookie itself expires after 24h, so any secret keyed by
 *     a tenantId we haven't seen recently has no live cookie that
 *     could read it.
 *
 *     CURRENT SCOPE: only ephemeral BYOK secrets + the tenant-activity
 *     tracker are wiped. Run records, event logs, and registered
 *     workflows live in `Storage` (sqlite or `memory://`), which lacks
 *     a `deleteRunsByTenant` API. They become unreachable as soon as
 *     the session cookie expires (the auth layer scopes every read
 *     to `req.tenantId`), and they're definitively gone on cold-start
 *     (Cloud Run min=0 typically recycles in <1h idle). Extending
 *     the Storage interface with per-tenant delete is queued as a
 *     follow-up — see the Phase-3 plan note in
 *     SECURITY/external-audit-engagement.md §2.1.1.
 *
 *     Cloud Scheduler hits this daily at 03:00 UTC:
 *       gcloud scheduler jobs create http openwop-app-daily-cleanup \
 *         --schedule="0 3 * * *" --uri="https://app.openwop.dev/api/v1/host/sample/admin/cleanup" \
 *         --http-method=POST --headers="Authorization=Bearer <ADMIN-TOKEN>"
 *
 * Authn: requires `Authorization: Bearer <token>` where token matches
 * process.env.OPENWOP_ADMIN_TOKEN. Returns 401 otherwise (NOT 403 —
 * the route is unauthenticated by default).
 */

import type { Express, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createLogger } from '../observability/logger.js';
import { clearExpiredEphemeralSecrets } from '../byok/secretResolver.js';

const log = createLogger('routes.admin');

/** Tracks the last time we observed a tenant — when the cleanup
 *  endpoint fires, any tenant not seen within the window gets wiped.
 *  Populated by sessionTouch() hooks from the auth middleware. */
const tenantLastSeen = new Map<string, number>();

/** Public seam: the auth middleware calls this on every authed
 *  request so we know which sessions are still live. */
export function noteTenantActivity(tenantId: string): void {
  tenantLastSeen.set(tenantId, Date.now());
}

function constantTimeBearerEq(received: string, expected: string): boolean {
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authAdmin(req: Request, res: Response): boolean {
  const expected = process.env.OPENWOP_ADMIN_TOKEN;
  if (!expected || expected.length < 16) {
    log.warn('admin route called but OPENWOP_ADMIN_TOKEN unset / too short');
    res.status(503).json({
      error: 'admin_disabled',
      message: 'OPENWOP_ADMIN_TOKEN must be set (>=16 chars) for admin routes to function.',
    });
    return false;
  }
  const header = req.header('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    res.status(401).json({
      error: 'unauthenticated',
      message: 'Missing Bearer admin token.',
    });
    return false;
  }
  const token = header.slice('bearer '.length).trim();
  if (!constantTimeBearerEq(token, expected)) {
    res.status(401).json({
      error: 'unauthenticated',
      message: 'Admin token mismatch.',
    });
    return false;
  }
  return true;
}

export function registerAdminRoutes(app: Express): void {
  app.post('/v1/host/sample/admin/cleanup', (req, res) => {
    if (!authAdmin(req, res)) return;

    // Cleanup window: any tenant whose `lastSeen` is older than this
    // gets wiped. Default 24h matches the cookie TTL — sessions older
    // than this can't be re-authed without minting a new cookie, so
    // their ephemeral secrets are unreachable anyway.
    const windowMs = Number(process.env.OPENWOP_CLEANUP_WINDOW_MS) || 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - windowMs;

    // Build the keep-set: tenants we've seen within the window.
    const keep = new Set<string>();
    for (const [tenantId, ts] of tenantLastSeen.entries()) {
      if (ts >= cutoff) keep.add(tenantId);
      else tenantLastSeen.delete(tenantId);
    }

    const wipedSecrets = clearExpiredEphemeralSecrets(keep);

    log.info('cleanup ran', {
      keepCount: keep.size,
      wipedSecrets,
      windowHours: Math.round(windowMs / 3_600_000),
    });

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      activeTenants: keep.size,
      wipedSecrets,
      windowMs,
    });
  });

  // GET variant for liveness / monitoring — returns current state
  // without performing any cleanup. Still admin-authed.
  app.get('/v1/host/sample/admin/cleanup/status', (req, res) => {
    if (!authAdmin(req, res)) return;
    const now = Date.now();
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      trackedTenants: tenantLastSeen.size,
      oldestActivityMs: tenantLastSeen.size === 0
        ? null
        : now - Math.min(...tenantLastSeen.values()),
    });
  });
}

// Test affordances
export function _resetTenantActivity(): void {
  tenantLastSeen.clear();
}
