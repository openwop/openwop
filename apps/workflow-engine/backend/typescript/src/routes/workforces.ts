/**
 * Governed Workforce — host-extension routes (sample-grade, non-normative).
 *
 * Surface under `/v1/host/sample/workforces`:
 *   GET  /                       list workforce definitions
 *   GET  /:workforceId           one workforce (the full bundle)
 *   GET  /:workforceId/metrics   aggregate telemetry for the caller's tenant
 *   GET  /:workforceId/governance graduated-autonomy timeline + governance posture
 *
 * VENDOR-NEUTRAL: no external-framework branding. Read-only in EP0 (the entity
 * is seeded; authoring CRUD lands in a later slice). Metrics aggregate from the
 * caller's runs alone (cost + cycle time are stashed in run metadata by the
 * generator), so this is a single `listRuns` read — no per-run event fan-out.
 *
 * @see src/host/workforceService.ts
 */

import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';
import type { Storage } from '../storage/storage.js';
import {
  aggregateAutonomyGraduation,
  aggregateGovernancePosture,
  aggregateWorkforceMetrics,
  getWorkforce,
  listWorkforces,
  setWorkforceStatus,
} from '../host/workforceService.js';
import type { WorkforceStatus } from '../host/workforce.js';

const WORKFORCE_STATUSES: readonly WorkforceStatus[] = ['shadow', 'piloting', 'production'];

interface Deps {
  storage: Storage;
}

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

export function registerWorkforceRoutes(app: Express, deps: Deps): void {
  app.get('/v1/host/sample/workforces', async (_req, res, next) => {
    try {
      res.json({ workforces: await listWorkforces() });
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/host/sample/workforces/:workforceId', async (req, res, next) => {
    try {
      const wf = await getWorkforce(req.params.workforceId);
      if (!wf) {
        throw new OpenwopError('not_found', `Workforce \`${req.params.workforceId}\` not found.`, 404, {
          workforceId: req.params.workforceId,
        });
      }
      res.json(wf);
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/host/sample/workforces/:workforceId/metrics', async (req, res, next) => {
    try {
      const wf = await getWorkforce(req.params.workforceId);
      if (!wf) {
        throw new OpenwopError('not_found', `Workforce \`${req.params.workforceId}\` not found.`, 404, {
          workforceId: req.params.workforceId,
        });
      }
      // Single read; aggregation is pure over run metadata (no event fan-out).
      const runs = await deps.storage.listRuns({ tenantId: tenantOf(req), limit: 5000 });
      res.json(aggregateWorkforceMetrics(runs, req.params.workforceId));
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/host/sample/workforces/:workforceId/governance', async (req, res, next) => {
    try {
      const wf = await getWorkforce(req.params.workforceId);
      if (!wf) {
        throw new OpenwopError('not_found', `Workforce \`${req.params.workforceId}\` not found.`, 404, {
          workforceId: req.params.workforceId,
        });
      }
      const runs = await deps.storage.listRuns({ tenantId: tenantOf(req), limit: 5000 });
      res.json({
        autonomy: aggregateAutonomyGraduation(runs, req.params.workforceId),
        posture: aggregateGovernancePosture(runs, req.params.workforceId),
      });
    } catch (err) {
      next(err);
    }
  });

  // MG-6 — graduated production cutover. Forward to `production` is GATED on
  // the agent having graduated to bounded-autonomous (currentTier === 'auto'),
  // so cutover is evidence-based, not a toggle. Rollback to shadow/piloting is
  // ALWAYS allowed (the kill-switch is always available).
  app.patch('/v1/host/sample/workforces/:workforceId', async (req, res, next) => {
    try {
      const status = (req.body as { status?: unknown } | undefined)?.status;
      if (typeof status !== 'string' || !WORKFORCE_STATUSES.includes(status as WorkforceStatus)) {
        throw new OpenwopError('validation_error', `Field \`status\` must be one of: ${WORKFORCE_STATUSES.join(', ')}.`, 400, {
          field: 'status',
        });
      }
      const wf = await getWorkforce(req.params.workforceId);
      if (!wf) {
        throw new OpenwopError('not_found', `Workforce \`${req.params.workforceId}\` not found.`, 404, {
          workforceId: req.params.workforceId,
        });
      }
      if (status === 'production') {
        const grad = aggregateAutonomyGraduation(
          await deps.storage.listRuns({ tenantId: tenantOf(req), limit: 5000 }),
          req.params.workforceId,
        );
        if (grad.currentTier !== 'auto') {
          throw new OpenwopError(
            'conflict',
            `Cannot cut over to production: the workforce must graduate to bounded-autonomous first (current tier: ${grad.currentTier ?? 'unknown'}).`,
            409,
            { workforceId: req.params.workforceId, currentTier: grad.currentTier, reason: 'cutover_not_eligible' },
          );
        }
      }
      const updated = await setWorkforceStatus(req.params.workforceId, status as WorkforceStatus);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
}
