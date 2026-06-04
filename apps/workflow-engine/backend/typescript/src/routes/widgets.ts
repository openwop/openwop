/**
 * REFERENCE DOMAIN ROUTES — the HTTP half of the canonical host-extension
 * vertical slice (white-label PRD §4; see src/host/examples/widgetService.ts
 * and HOST-EXTENSIONS.md).
 *
 * Demonstrates the route-layer conventions a real domain copies:
 *   - vendor-prefixed, non-normative namespace (`/v1/host/sample/...`),
 *   - the `tenantOf(req)` accessor (cookie-anon / OIDC tenant, or the shared
 *     `default` tenant for bearer-shared demo callers),
 *   - the fail-closed mutation mapping: a discriminated `{ ok: false, reason }`
 *     service result becomes HTTP 409 + a machine-readable reason — domain
 *     conflicts are never 500s and never silent successes,
 *   - errors flow to `next(err)` → the canonical error envelope middleware.
 *
 * ENV-GATED: mounts only when `OPENWOP_EXAMPLE_WIDGETS_ENABLED=true`, so the
 * example slice is runnable (and integration-testable) without polluting a
 * real deployment's API surface. The registration in registerAllRoutes.ts is
 * unconditional — the gate lives HERE, mirroring packs-test.ts.
 */

import type { Express, Request, Response } from 'express';
import {
  archiveWidget,
  createWidget,
  listWidgets,
  seedDemoWidgets,
  widgetSummary,
  type WidgetMutation,
} from '../host/examples/widgetService.js';
import { OpenwopError } from '../types.js';

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

/** The fail-closed bridge: every `ok: false` reason becomes a 409 with the
 *  machine-readable reason a typed client error can switch on. Reusable shape —
 *  copy this helper into your domain's route file (or lift it shared once a
 *  third domain needs it). */
function respondMutation(res: Response, result: WidgetMutation): void {
  if (result.ok) {
    res.status(200).json(result.widget);
    return;
  }
  if (result.reason === 'not_found') {
    res.status(404).json({ error: 'not_found', message: 'No such widget for this tenant.' });
    return;
  }
  res.status(409).json({
    error: 'conflict',
    reason: result.reason,
    message: 'The widget is not in a state that allows this mutation.',
  });
}

export function registerWidgetRoutes(app: Express): void {
  if (process.env.OPENWOP_EXAMPLE_WIDGETS_ENABLED !== 'true') return;

  app.get('/v1/host/sample/widgets', async (req, res, next) => {
    try {
      const items = await listWidgets(tenantOf(req));
      res.json({ widgets: items, total: items.length });
    } catch (err) {
      next(err);
    }
  });

  // Derived read-through projection — computed from the live store per
  // request; there is no stored summary row to drift.
  app.get('/v1/host/sample/widgets/summary', async (req, res, next) => {
    try {
      res.json(await widgetSummary(tenantOf(req)));
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/widgets', async (req, res, next) => {
    try {
      const name = (req.body as { name?: unknown })?.name;
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > 80) {
        throw new OpenwopError('validation_error', '`name` is required (a non-empty string ≤ 80 chars).', 400);
      }
      res.status(201).json(await createWidget(tenantOf(req), name.trim()));
    } catch (err) {
      next(err);
    }
  });

  // Idempotent demo seed — re-running is a no-op (`seeded: false`).
  app.post('/v1/host/sample/widgets/seed', async (req, res, next) => {
    try {
      res.json(await seedDemoWidgets(tenantOf(req)));
    } catch (err) {
      next(err);
    }
  });

  // The fail-closed mutation: archiving an archived widget is a 409 with
  // reason 'already_archived', not an error throw and not a silent success.
  app.post('/v1/host/sample/widgets/:widgetId/archive', async (req, res, next) => {
    try {
      respondMutation(res, await archiveWidget(tenantOf(req), req.params.widgetId));
    } catch (err) {
      next(err);
    }
  });
}
