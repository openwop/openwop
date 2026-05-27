/**
 * Sample-extension scheduler CRUD — `/v1/host/sample/scheduler/jobs`.
 *
 * Namespace: sample-extension under `/v1/host/sample/*`; this is NOT part of
 * the normative OpenWOP wire contract (vendor-prefixed per
 * spec/v1/host-extensions.md). It exposes the host-side scheduled-job store
 * (host/schedulingService.ts) — which already backs the RFC 0052
 * `scheduling/tick` conformance seam — as a minimal list/create/delete/
 * trigger surface so CLI tooling can manage cron jobs.
 *
 * Routes:
 *   GET    /v1/host/sample/scheduler/jobs               — list jobs
 *   POST   /v1/host/sample/scheduler/jobs               — register a job
 *   DELETE /v1/host/sample/scheduler/jobs/{jobId}       — remove a job
 *   POST   /v1/host/sample/scheduler/jobs/{jobId}:trigger — fire now (once)
 *
 * RFC 0052 semantics carried through from the underlying service:
 *   - §B.2 fire-once-per-tick: a `:trigger` advances the deterministic clock
 *     one tick and fires the job exactly once.
 *   - §B.3 horizon: a `firstFireAtMs` beyond the advertised
 *     `maxFutureHorizon` is rejected with `schedule_horizon_exceeded` (400).
 *   - §B.4 missed-tick policy lives in the service's `missedWindow` /
 *     `singleTick` evaluator and is exercised by the conformance seam.
 *
 * The store is process-local (sample-grade); a production host backs it with
 * a durable queue (RFC 0017 `queueBus`).
 *
 * @see RFCS/0052-scheduling-and-time-based-triggers.md §B
 */

import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { OpenwopError } from '../types.js';
import {
  registerJob,
  listJobs,
  getJob,
  deleteJob,
  triggerJob,
} from '../host/schedulingService.js';

export function registerSchedulerRoutes(app: Express): void {
  app.get('/v1/host/sample/scheduler/jobs', (_req, res) => {
    res.json({ jobs: listJobs() });
  });

  app.post('/v1/host/sample/scheduler/jobs', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        jobId?: unknown;
        cronExpr?: unknown;
        workflowId?: unknown;
        firstFireAtMs?: unknown;
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
      const input: { jobId: string; cronExpr: string; workflowId?: string; firstFireAtMs?: number } = {
        jobId,
        cronExpr: body.cronExpr,
      };
      if (typeof body.workflowId === 'string') input.workflowId = body.workflowId;
      if (typeof body.firstFireAtMs === 'number') input.firstFireAtMs = body.firstFireAtMs;

      const result = registerJob(input);
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

  app.delete('/v1/host/sample/scheduler/jobs/:jobId', (req, res, next) => {
    try {
      const removed = deleteJob(req.params.jobId);
      if (!removed) {
        throw new OpenwopError(
          'not_found',
          `Scheduled job ${req.params.jobId} not found.`,
          404,
          { jobId: req.params.jobId },
        );
      }
      res.status(200).json({ removed: true, jobId: req.params.jobId });
    } catch (err) {
      next(err);
    }
  });

  // Express 4 + path-to-regexp v6 dislikes a bare `:` inside a path segment,
  // so the action verb is matched via a regex-free trailing segment.
  app.post('/v1/host/sample/scheduler/jobs/:jobId/trigger', (req, res, next) => {
    try {
      const result = triggerJob(req.params.jobId);
      if (!result.ok) {
        throw new OpenwopError(
          'not_found',
          `Scheduled job ${req.params.jobId} not found.`,
          404,
          { jobId: req.params.jobId },
        );
      }
      const job = getJob(req.params.jobId);
      res.status(200).json({
        jobId: req.params.jobId,
        runsFired: result.result.runsFired,
        lastFiredTick: job?.lastFiredTick ?? null,
      });
    } catch (err) {
      next(err);
    }
  });
}
