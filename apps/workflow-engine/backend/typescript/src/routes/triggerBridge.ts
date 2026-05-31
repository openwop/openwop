/**
 * Durable trigger bridge — read surface (RFC 0083 §C, sample host-extension).
 *
 * The `GET /v1/trigger-subscriptions[/{id}]` read that RFC 0083 deferred to
 * `Active → Accepted` — so an operator can see a subscription's state +
 * delivery attempts (active / paused / failed / dead-lettered). Tenant-scoped
 * (RFC 0074 carry-forward). Per-source management (register/fire) is internal
 * (the Kanban board registers its own subscription); a `PATCH .../{id}` pauses.
 *
 * @see src/host/triggerBridgeService.ts
 * @see spec/v1/trigger-bridge.md §B/§C
 */

import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';
import {
  getSubscription,
  listDeliveries,
  listSubscriptions,
  setSubscriptionState,
} from '../host/triggerBridgeService.js';

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

export function registerTriggerBridgeRoutes(app: Express): void {
  app.get('/v1/trigger-subscriptions', async (req, res, next) => {
    try {
      res.json({ subscriptions: await listSubscriptions(tenantOf(req)) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/trigger-subscriptions/:subscriptionId', async (req, res, next) => {
    try {
      const sub = await getSubscription(req.params.subscriptionId);
      if (!sub || sub.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Trigger subscription not found.', 404, { subscriptionId: req.params.subscriptionId });
      }
      res.json({ subscription: sub, deliveries: await listDeliveries(sub.subscriptionId) });
    } catch (err) {
      next(err);
    }
  });

  // Operator pause/resume (§B). { state: 'paused' | 'active' }.
  app.patch('/v1/trigger-subscriptions/:subscriptionId', async (req, res, next) => {
    try {
      const sub = await getSubscription(req.params.subscriptionId);
      if (!sub || sub.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Trigger subscription not found.', 404, { subscriptionId: req.params.subscriptionId });
      }
      const toState = (req.body ?? {}).state;
      if (toState !== 'paused' && toState !== 'active') {
        throw new OpenwopError('validation_error', 'Field `state` MUST be `paused` or `active`.', 400, { field: 'state' });
      }
      await setSubscriptionState(sub.subscriptionId, toState);
      res.json({ subscription: await getSubscription(sub.subscriptionId) });
    } catch (err) {
      next(err);
    }
  });
}
