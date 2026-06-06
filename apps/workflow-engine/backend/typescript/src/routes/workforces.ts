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
  searchWorkforceTrace,
  setWorkforceStatus,
} from '../host/workforceService.js';
import type { WorkforceStatus } from '../host/workforce.js';
import {
  getMigrationJourney,
  patchMigrationJourney,
  type MigrationJourneyPatch,
} from '../host/migrationService.js';
import { MIGRATION_STAGE_KEYS, type MigrationStageKey, type StageStatus } from '../host/migrationJourney.js';

const WORKFORCE_STATUSES: readonly WorkforceStatus[] = ['shadow', 'piloting', 'production'];

/** Parse + validate the migration-journey PATCH body (light, host-extension). */
function parseMigrationPatch(body: unknown): MigrationJourneyPatch {
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: MigrationJourneyPatch = {};
  if ('target' in b) {
    const t = b.target as { workflowId?: unknown; targetOutcome?: unknown } | null;
    patch.target = t === null ? null : {
      workflowId: typeof t?.workflowId === 'string' ? t.workflowId : '',
      targetOutcome: typeof t?.targetOutcome === 'string' ? t.targetOutcome : '',
    };
  }
  if ('dataManifest' in b) {
    const d = b.dataManifest as { dataSources?: unknown; sensitivity?: unknown; approvalModel?: unknown } | null;
    patch.dataManifest = d === null ? null : {
      dataSources: typeof d?.dataSources === 'string' ? d.dataSources : '',
      sensitivity: typeof d?.sensitivity === 'string' ? d.sensitivity : '',
      approvalModel: typeof d?.approvalModel === 'string' ? d.approvalModel : '',
    };
  }
  if ('boundaries' in b) {
    const bd = b.boundaries as { auto?: unknown; review?: unknown } | null;
    const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    patch.boundaries = bd === null ? null : { auto: strArr(bd?.auto), review: strArr(bd?.review) };
  }
  if ('stageStatus' in b && b.stageStatus && typeof b.stageStatus === 'object') {
    const ss: Partial<Record<MigrationStageKey, StageStatus>> = {};
    for (const [k, v] of Object.entries(b.stageStatus as Record<string, unknown>)) {
      if (MIGRATION_STAGE_KEYS.includes(k as MigrationStageKey) && (v === 'pending' || v === 'done')) {
        ss[k as MigrationStageKey] = v;
      }
    }
    patch.stageStatus = ss;
  }
  return patch;
}

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

  // MG-0 — Workflow Migration journey state (per workforce).
  app.get('/v1/host/sample/workforces/:workforceId/migration', async (req, res, next) => {
    try {
      const wf = await getWorkforce(req.params.workforceId);
      if (!wf) {
        throw new OpenwopError('not_found', `Workforce \`${req.params.workforceId}\` not found.`, 404, {
          workforceId: req.params.workforceId,
        });
      }
      res.json(await getMigrationJourney(req.params.workforceId));
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/workforces/:workforceId/migration', async (req, res, next) => {
    try {
      const wf = await getWorkforce(req.params.workforceId);
      if (!wf) {
        throw new OpenwopError('not_found', `Workforce \`${req.params.workforceId}\` not found.`, 404, {
          workforceId: req.params.workforceId,
        });
      }
      res.json(await patchMigrationJourney(req.params.workforceId, parseMigrationPatch(req.body)));
    } catch (err) {
      next(err);
    }
  });

  // GA-2 — cross-run trace/audit search by correlationId / batchId / runId /
  // outcome / status. Single listRuns read; pure metadata search.
  app.get('/v1/host/sample/workforces/:workforceId/trace', async (req, res, next) => {
    try {
      const wf = await getWorkforce(req.params.workforceId);
      if (!wf) {
        throw new OpenwopError('not_found', `Workforce \`${req.params.workforceId}\` not found.`, 404, {
          workforceId: req.params.workforceId,
        });
      }
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const runs = await deps.storage.listRuns({ tenantId: tenantOf(req), limit: 5000 });
      res.json(searchWorkforceTrace(runs, req.params.workforceId, q));
    } catch (err) {
      next(err);
    }
  });
}
