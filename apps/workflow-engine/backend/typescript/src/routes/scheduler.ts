/**
 * Sample-extension scheduler CRUD — `/v1/host/sample/scheduler/jobs`.
 *
 * Namespace: sample-extension under `/v1/host/sample/*`; this is NOT part of
 * the normative OpenWOP wire contract (vendor-prefixed per
 * spec/v1/host-extensions.md). It exposes the durable host-side scheduled-job
 * store (host/schedulingService.ts) — which sits alongside the RFC 0052
 * `scheduling/tick` conformance seam — as a list/create/delete/enable/trigger
 * surface so the agent "Schedules" tab (and CLI tooling) can manage agent-owned
 * cron jobs.
 *
 * Routes:
 *   GET    /v1/host/sample/scheduler/jobs[?rosterId=]     — list jobs (tenant-scoped; optional roster filter)
 *   POST   /v1/host/sample/scheduler/jobs                 — register a job (optional roster/agent attribution)
 *   PATCH  /v1/host/sample/scheduler/jobs/{jobId}         — enable/disable a job
 *   DELETE /v1/host/sample/scheduler/jobs/{jobId}         — remove a job
 *   POST   /v1/host/sample/scheduler/jobs/{jobId}/trigger — fire now (starts a real run)
 *
 * RFC 0052 semantics:
 *   - §B.2 fire-once-per-tick: a `/trigger` advances the deterministic clock
 *     one tick and fires the job exactly once.
 *   - §B.3 horizon: a `firstFireAtMs` beyond the advertised `maxFutureHorizon`
 *     is rejected with `schedule_horizon_exceeded` (400).
 *   - §B.4 missed-tick policy lives in the service's `missedWindow` /
 *     `singleTick` evaluator and is exercised by the conformance seam.
 *
 * The job store is now a read-through durable collection — jobs survive a
 * restart and a multi-instance deployment stays consistent (PRD §13).
 *
 * @see RFCS/0052-scheduling-and-time-based-triggers.md §B
 */

import { randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';
import type { HostAdapterSuite } from '../host/index.js';
import type { Storage } from '../storage/storage.js';
import {
  registerJob,
  listJobs,
  listJobsByRoster,
  getJob,
  deleteJob,
  updateJob,
  markJobFired,
  singleTick,
  currentTick,
} from '../host/schedulingService.js';
import { getRosterEntry } from '../host/rosterService.js';
import { startWorkflowRun } from '../host/runStarter.js';

interface Deps {
  storage: Storage;
  hostSuite: HostAdapterSuite;
}

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

export function registerSchedulerRoutes(app: Express, deps: Deps): void {
  app.get('/v1/host/sample/scheduler/jobs', async (req, res, next) => {
    try {
      const tenantId = tenantOf(req);
      const rosterId = typeof req.query.rosterId === 'string' ? req.query.rosterId : undefined;
      const jobs = rosterId ? await listJobsByRoster(tenantId, rosterId) : await listJobs(tenantId);
      res.json({ jobs });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/scheduler/jobs', async (req, res, next) => {
    try {
      const tenantId = tenantOf(req);
      const body = (req.body ?? {}) as {
        jobId?: unknown;
        cronExpr?: unknown;
        workflowId?: unknown;
        firstFireAtMs?: unknown;
        rosterId?: unknown;
        agentId?: unknown;
        enabled?: unknown;
        metadata?: unknown;
        timezone?: unknown;
      };
      if (typeof body.cronExpr !== 'string' || body.cronExpr.length === 0) {
        throw new OpenwopError(
          'validation_error',
          'Field `cronExpr` is required and MUST be a non-empty string.',
          400,
          { field: 'cronExpr' },
        );
      }
      const jobId =
        typeof body.jobId === 'string' && body.jobId.length > 0 ? body.jobId : randomUUID();

      // Optional RFCS/0086 roster binding — scope the schedule to a named
      // agent. The member must live in the caller's tenant (404→400 like the
      // Kanban board binding). When bound, the member's agentId is recorded
      // for attribution unless the caller passes one explicitly.
      let rosterId: string | undefined;
      let agentId = typeof body.agentId === 'string' ? body.agentId : undefined;
      if (body.rosterId !== undefined) {
        if (typeof body.rosterId !== 'string') {
          throw new OpenwopError('validation_error', 'Field `rosterId` MUST be a string when present.', 400, {
            field: 'rosterId',
          });
        }
        const entry = await getRosterEntry(body.rosterId);
        if (!entry || entry.tenantId !== tenantId) {
          throw new OpenwopError('validation_error', 'Field `rosterId` does not name a roster entry in this tenant.', 400, {
            field: 'rosterId',
          });
        }
        rosterId = entry.rosterId;
        agentId = agentId ?? entry.agentRef.agentId;
      }

      const input: Parameters<typeof registerJob>[0] = {
        jobId,
        tenantId,
        cronExpr: body.cronExpr,
      };
      if (typeof body.workflowId === 'string') input.workflowId = body.workflowId;
      if (typeof body.firstFireAtMs === 'number') input.firstFireAtMs = body.firstFireAtMs;
      if (rosterId !== undefined) input.rosterId = rosterId;
      if (agentId !== undefined) input.agentId = agentId;
      if (typeof body.enabled === 'boolean') input.enabled = body.enabled;
      if (body.metadata && typeof body.metadata === 'object') {
        input.metadata = body.metadata as Record<string, unknown>;
      }
      if (typeof body.timezone === 'string') input.timezone = body.timezone;

      const result = await registerJob(input);
      if (!result.ok) {
        // RFC 0052 §B.3 — schedule_horizon_exceeded is a scheduling-specific
        // code not in the normative OpenwopErrorCode union; return it inline
        // with the canonical { error, message } envelope shape and a 400.
        res.status(400).json({
          error: result.error.code,
          message: result.error.message,
          details: { maxFutureHorizon: 'P30D' },
        });
        return;
      }
      res.status(201).json(result.job);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/scheduler/jobs/:jobId', async (req, res, next) => {
    try {
      const job = await getJob(req.params.jobId);
      if (!job || job.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', `Scheduled job ${req.params.jobId} not found.`, 404, {
          jobId: req.params.jobId,
        });
      }
      const body = (req.body ?? {}) as {
        enabled?: unknown;
        cronExpr?: unknown;
        workflowId?: unknown;
        metadata?: unknown;
        timezone?: unknown;
      };
      const patch: Parameters<typeof updateJob>[1] = {};
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') {
          throw new OpenwopError('validation_error', 'Field `enabled` MUST be a boolean.', 400, { field: 'enabled' });
        }
        patch.enabled = body.enabled;
      }
      if (body.cronExpr !== undefined) {
        if (typeof body.cronExpr !== 'string' || body.cronExpr.length === 0) {
          throw new OpenwopError('validation_error', 'Field `cronExpr` MUST be a non-empty string.', 400, { field: 'cronExpr' });
        }
        patch.cronExpr = body.cronExpr;
      }
      if (body.workflowId !== undefined) {
        if (typeof body.workflowId !== 'string') {
          throw new OpenwopError('validation_error', 'Field `workflowId` MUST be a string.', 400, { field: 'workflowId' });
        }
        patch.workflowId = body.workflowId;
      }
      if (body.timezone !== undefined) {
        if (typeof body.timezone !== 'string') {
          throw new OpenwopError('validation_error', 'Field `timezone` MUST be a string.', 400, { field: 'timezone' });
        }
        patch.timezone = body.timezone;
      }
      if (body.metadata !== undefined) {
        if (typeof body.metadata !== 'object' || body.metadata === null) {
          throw new OpenwopError('validation_error', 'Field `metadata` MUST be an object.', 400, { field: 'metadata' });
        }
        patch.metadata = body.metadata as Record<string, unknown>;
      }
      if (Object.keys(patch).length === 0) {
        throw new OpenwopError('validation_error', 'Provide at least one editable field (enabled, cronExpr, workflowId, metadata, timezone).', 400, {});
      }
      const updated = await updateJob(req.params.jobId, patch);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/scheduler/jobs/:jobId', async (req, res, next) => {
    try {
      const job = await getJob(req.params.jobId);
      if (!job || job.tenantId !== tenantOf(req)) {
        throw new OpenwopError(
          'not_found',
          `Scheduled job ${req.params.jobId} not found.`,
          404,
          { jobId: req.params.jobId },
        );
      }
      await deleteJob(req.params.jobId);
      res.status(200).json({ removed: true, jobId: req.params.jobId });
    } catch (err) {
      next(err);
    }
  });

  // Express 4 + path-to-regexp v6 dislikes a bare `:` inside a path segment,
  // so the action verb is matched via a regex-free trailing segment.
  app.post('/v1/host/sample/scheduler/jobs/:jobId/trigger', async (req, res, next) => {
    try {
      const job = await getJob(req.params.jobId);
      if (!job || job.tenantId !== tenantOf(req)) {
        throw new OpenwopError(
          'not_found',
          `Scheduled job ${req.params.jobId} not found.`,
          404,
          { jobId: req.params.jobId },
        );
      }
      // §B.2 fire-once-per-tick: advance the deterministic clock once.
      const result = singleTick(req.params.jobId);
      const tick = currentTick();
      // When the schedule names a resolvable workflow, start a real run
      // attributed to the schedule (and its roster member, if any).
      let runId: string | null = null;
      if (result.runsFired > 0 && job.workflowId) {
        const schedule: Record<string, unknown> = { jobId: job.jobId, source: 'schedule' };
        if (job.rosterId) schedule.rosterId = job.rosterId;
        if (job.agentId) schedule.agentId = job.agentId;
        runId = await startWorkflowRun(deps, {
          tenantId: tenantOf(req),
          workflowId: job.workflowId,
          metadata: { schedule },
        });
      }
      await markJobFired(req.params.jobId, tick, runId ?? undefined);
      res.status(200).json({
        jobId: req.params.jobId,
        runsFired: result.runsFired,
        lastFiredTick: tick,
        ...(runId ? { runId } : {}),
      });
    } catch (err) {
      next(err);
    }
  });
}
