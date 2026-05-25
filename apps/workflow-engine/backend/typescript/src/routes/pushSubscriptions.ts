/**
 * Web Push subscription routes (PR #174).
 *
 *   POST   /v1/host/sample/notifications/push/subscribe
 *     body: { endpoint, keys: { p256dh, auth }, userAgent? }
 *     → 201 { subscriptionId }
 *
 *   DELETE /v1/host/sample/notifications/push/subscriptions/:id
 *     → 204; 404 when the id is unknown or not owned by the caller
 *
 *   GET    /v1/host/sample/notifications/push/subscriptions
 *     → 200 { subscriptions: [{ subscriptionId, endpoint, createdAt, userAgent? }] }
 *     — the `keys` are never returned (treated like credentials).
 *
 * Vendor-prefixed for the same reason the notification surface is:
 * not a normative openwop v1 spec, just the sample-host's add-on
 * (see `host-extensions.md`).
 *
 * Tenant scope follows the rest of the notification surface: every
 * action is authorized against `req.tenantId`, wildcard principals
 * can pass `?tenantId=foo` to operate on a specific tenant.
 */

import type { Express, Request } from 'express';
import { randomBytes } from 'node:crypto';
import type { Storage } from '../storage/storage.js';
import { OpenwopError, type PushSubscriptionRecord } from '../types.js';
import { getVapidPublicKey } from '../notifications/webPush.js';

const BASE = '/v1/host/sample/notifications/push';

interface Deps {
  storage: Storage;
}

export function registerPushSubscriptionRoutes(app: Express, deps: Deps): void {
  const { storage } = deps;

  // Config endpoint — exposes the VAPID public key so the FE can pass
  // it to `pushManager.subscribe()` without hard-coding it in the
  // bundle. Returns `{enabled: false}` when the BE doesn't have VAPID
  // env vars configured (local dev), so the FE can hide the affordance.
  // Unauthenticated — the public key is public by definition.
  app.get(`${BASE}/config`, (_req, res) => {
    const vapidPublicKey = getVapidPublicKey();
    if (vapidPublicKey) {
      res.json({ enabled: true, vapidPublicKey });
    } else {
      res.json({ enabled: false });
    }
  });

  app.post(`${BASE}/subscribe`, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      if (!tenantId) throw new OpenwopError('unauthenticated', 'sign in to enable push', 401);
      const body = req.body as {
        endpoint?: unknown;
        keys?: { p256dh?: unknown; auth?: unknown };
        userAgent?: unknown;
      };
      const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
      const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
      const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : '';
      const userAgent = typeof body.userAgent === 'string' ? body.userAgent : undefined;
      if (!endpoint || !p256dh || !auth) {
        throw new OpenwopError(
          'validation_error',
          'endpoint + keys.p256dh + keys.auth are required',
          400,
        );
      }

      // Endpoint is the canonical browser-handed URL we expect from
      // pushManager.subscribe(). Sanity-check the scheme to keep
      // obviously-broken inputs out of the table.
      if (!/^https?:/.test(endpoint)) {
        throw new OpenwopError('validation_error', 'endpoint must be an http(s) URL', 400);
      }

      const subscriptionId = randomBytes(16).toString('hex');
      const record: PushSubscriptionRecord = {
        subscriptionId,
        tenantId,
        endpoint,
        p256dhKey: p256dh,
        authKey: auth,
        userAgent,
        createdAt: new Date().toISOString(),
      };
      await storage.insertPushSubscription(record);
      res.status(201).json({ subscriptionId });
    } catch (err) {
      next(err);
    }
  });

  app.get(`${BASE}/subscriptions`, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      if (!tenantId) {
        res.json({ subscriptions: [] });
        return;
      }
      const subs = await storage.listPushSubscriptions(tenantId);
      // Project — never return `p256dhKey` / `authKey` since they're
      // effectively credentials. The FE only needs the id + endpoint
      // for listing / revoke flows.
      res.json({
        subscriptions: subs.map((s) => ({
          subscriptionId: s.subscriptionId,
          endpoint: s.endpoint,
          userAgent: s.userAgent,
          createdAt: s.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.delete(`${BASE}/subscriptions/:id`, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      if (!tenantId) throw new OpenwopError('unauthenticated', 'sign in to manage push', 401);
      // Look up by id + verify ownership before delete — prevents a
      // leaked subscriptionId from being used to revoke another
      // user's row. 404-on-mismatch hides existence.
      const sub = await storage.getPushSubscriptionByEndpoint(req.params.id);
      // The id-based path doesn't have a getById; list + filter is fine
      // for the FE's small subscription count (<5 typical).
      if (!sub) {
        const all = await storage.listPushSubscriptions(tenantId);
        const match = all.find((s) => s.subscriptionId === req.params.id);
        if (!match) throw new OpenwopError('not_found', 'subscription not found', 404);
        await storage.deletePushSubscription(req.params.id);
        res.status(204).end();
        return;
      }
      if (sub.tenantId !== tenantId) throw new OpenwopError('not_found', 'subscription not found', 404);
      await storage.deletePushSubscription(sub.subscriptionId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}

function resolveTenant(req: Request): string | undefined {
  const tenants = req.principal?.tenants ?? [];
  const wildcard = tenants.includes('*');
  const requestedTenant = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
  return wildcard ? requestedTenant : (req.tenantId ?? undefined);
}
