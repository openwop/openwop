/**
 * Canonical run-lifecycle routes:
 *   POST   /v1/runs                       — create
 *   GET    /v1/runs/{runId}               — snapshot
 *   POST   /v1/runs/{runId}/cancel        — cancel
 *   POST   /v1/runs/{runId}:fork          — fork from sequence
 *
 * Idempotency: HTTP layer keyed on `Idempotency-Key`; engine layer
 * keyed on `invocationId` per `spec/v1/idempotency.md` (the engine
 * layer lives in src/executor/invocationLog.ts and is invoked by node
 * implementations that make external calls).
 */

import { randomUUID } from 'node:crypto';
import type { Express, Response } from 'express';
import type {
  CreateRunRequest,
  CreateRunResponse,
  ForkRunRequest,
  ForkRunResponse,
} from '@openwop/openwop';
import type { Storage } from '../storage/storage.js';
import type { HostAdapterSuite } from '../host/index.js';
import { OpenwopError, type RunRecord } from '../types.js';
import { executeRun } from '../executor/executor.js';
import { getEventLog } from '../executor/eventLog.js';
import { createLogger } from '../observability/logger.js';
import { runQuotaMiddleware, reserveConcurrentSlot } from '../middleware/rateLimit.js';
import { notifyRunTerminal } from '../executor/runLifecycle.js';

const log = createLogger('routes.runs');

interface Deps {
  storage: Storage;
  hostSuite: HostAdapterSuite;
}

export function registerRunRoutes(app: Express, deps: Deps): void {
  const { storage, hostSuite } = deps;

  app.post('/v1/runs', runQuotaMiddleware(), async (req, res, next) => {
    try {
      const body = req.body as CreateRunRequest;
      if (!body || typeof body !== 'object' || !body.workflowId) {
        throw new OpenwopError('invalid_request', 'workflowId is required', 400);
      }
      const principal = req.principal;
      if (!principal) throw new OpenwopError('unauthenticated', 'Bearer token required', 401);

      // Tenant id: session-authed callers get their cookie-derived
      // tenant by default; explicit body.tenantId still works but the
      // principalAuthorizer rejects a mismatch. Bearer-authed callers
      // fall back to the body field or 'default'. Closes the
      // cross-tenant impersonation hole flagged in the P0.2 deploy
      // hardening for app.openwop.dev.
      // Empty-string body.tenantId (e.g., SPA submitting under the
      // authenticated session) falls through to req.tenantId. Non-empty
      // body.tenantId is honored verbatim and may be rejected by
      // principalAuthorizer if it doesn't match the principal's
      // allow-list.
      const bodyTenant = typeof body.tenantId === 'string' && body.tenantId.length > 0 ? body.tenantId : undefined;
      const tenantId = bodyTenant ?? req.tenantId ?? 'default';
      const allowed = await hostSuite.principalAuthorizer.authorize(
        principal,
        'run.create',
        { tenantId, scopeId: body.scopeId },
      );
      if (!allowed) throw new OpenwopError('forbidden_tenant', `principal cannot operate under tenant ${tenantId}`, 403);

      const tenant = await hostSuite.tenantResolver.resolveTenant(tenantId);
      if (!tenant) throw new OpenwopError('forbidden_tenant', `tenant ${tenantId} not found`, 403);

      if (body.scopeId) {
        const scope = await hostSuite.scopeResolver.resolveScope(tenantId, body.scopeId);
        if (!scope) throw new OpenwopError('forbidden_scope', `scope ${body.scopeId} not in tenant ${tenantId}`, 403);
      }

      const wf = await hostSuite.workflowCatalog.getWorkflow(body.workflowId);
      if (!wf) {
        throw new OpenwopError(
          'workflow_not_found',
          // Don't echo body.workflowId in the message — defense-in-depth
          // against credential-shaped canaries planted in user input.
          // The `details` field carries it through the sanitizer.
          'Workflow not found in this catalog.',
          404,
          { workflowId: body.workflowId },
        );
      }

      // Idempotency-Key handling per spec/v1/idempotency.md: atomic
      // claim → first caller proceeds, concurrent callers either get
      // the cached response (final) or 409 (still in flight).
      const idempotencyKey = req.header('idempotency-key') ?? undefined;
      if (idempotencyKey) {
        const claim = await storage.claimIdempotency(idempotencyKey, new Date().toISOString());
        if (!claim.claimed) {
          const existing = claim.existing;
          if (existing && existing.responseBody !== '__pending__') {
            res.status(existing.responseStatus).type('application/json').send(existing.responseBody);
            return;
          }
          // Concurrent request still in flight. Per `idempotency.md` we
          // don't speculatively wait — return 409 and let the caller retry.
          throw new OpenwopError(
            'idempotency_key_conflict',
            'A request with this Idempotency-Key is currently in flight; retry after it completes.',
            409,
            { idempotencyKey },
          );
        }
      }

      const runId = randomUUID();
      const now = new Date().toISOString();
      const run: RunRecord = {
        runId,
        workflowId: body.workflowId,
        tenantId,
        scopeId: body.scopeId,
        status: 'pending',
        inputs: body.inputs ?? null,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
        configurable: (body.configurable as Record<string, unknown>) ?? {},
        callbackUrl: body.callbackUrl,
        idempotencyKey,
        createdAt: now,
        updatedAt: now,
      };
      await storage.insertRun(run);
      // Bind the run to a concurrent-runs slot (P0.4 rate limit) — the
      // middleware reserved abstract capacity in its pre-flight check,
      // and this call ties the reservation to the actual runId so the
      // runLifecycle bus can auto-release on run.completed / run.failed
      // / run.cancelled. No-op for routes outside the rate-limit
      // middleware (e.g., conformance harness bypass).
      reserveConcurrentSlot(req, runId);
      hostSuite.auditSink.record({
        principalId: principal.principalId,
        action: 'run.create',
        resource: `run:${runId}`,
        outcome: 'success',
        payload: { workflowId: body.workflowId, tenantId, scopeId: body.scopeId },
      });

      const response: CreateRunResponse = {
        runId,
        status: 'pending',
        eventsUrl: `${req.protocol}://${req.get('host')}/v1/runs/${runId}/events`,
        statusUrl: `${req.protocol}://${req.get('host')}/v1/runs/${runId}`,
      };

      // Cache the response for replay (now that it's final).
      if (idempotencyKey) {
        await storage.putIdempotency({
          key: idempotencyKey,
          responseBody: JSON.stringify(response),
          responseStatus: 201,
          createdAt: now,
        });
      }

      res.status(201).json(response);

      // Dispatch inline. Real impls hand off to Cloud Tasks / Pub/Sub / SQS
      // so the HTTP response returns immediately and the dispatcher runs
      // separately. setImmediate keeps the sample single-instance.
      setImmediate(() => {
        executeRun(storage, run, wf.definition, {
          policyResolver: hostSuite.providerPolicyResolver,
        }).catch((err) => {
          log.error('inline dispatch failed', {
            runId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /v1/runs — list recent runs for the authenticated tenant.
   *
   * Tenant scope is taken from req.tenantId (set by auth middleware
   * from the OIDC bearer or session cookie). Wildcard-tenant Bearer
   * callers (the conformance harness) can pass `?tenantId=foo` to
   * filter explicitly; otherwise tenant=* sees everything.
   *
   * Query params:
   *   status   optional run status filter
   *   limit    max rows (default 50, capped to 200)
   */
  app.get('/v1/runs', async (req, res, next) => {
    try {
      const requestedTenant = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
      const principalTenants = req.principal?.tenants ?? [];
      const principalIsWildcard = principalTenants.includes('*');
      const tenantFilter = principalIsWildcard
        ? requestedTenant
        : (req.tenantId ?? undefined);
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const runs = await storage.listRuns({
        ...(tenantFilter ? { tenantId: tenantFilter } : {}),
        ...(status ? { status } : {}),
        limit,
      });
      res.json({ runs: runs.map(projectRunSnapshot) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/runs/:runId', async (req, res, next) => {
    try {
      const run = await storage.getRun(req.params.runId);
      if (!run) throw new OpenwopError('run_not_found', `run ${req.params.runId} not found`, 404);
      res.json(projectRunSnapshot(run));
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/runs/:runId/cancel', async (req, res, next) => {
    try {
      const run = await storage.getRun(req.params.runId);
      if (!run) throw new OpenwopError('run_not_found', `run ${req.params.runId} not found`, 404);
      const terminal = ['completed', 'failed', 'cancelled'];
      if (terminal.includes(run.status)) {
        res.json({ runId: run.runId, status: run.status });
        return;
      }
      const reason = (req.body?.reason as string) ?? 'cancelled by request';
      await storage.updateRun(run.runId, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
        error: { code: 'cancelled', message: reason },
      });
      await getEventLog().append({
        runId: run.runId,
        type: 'run.cancelled',
        payload: { reason },
      });
      notifyRunTerminal(run.runId);
      res.json({ runId: run.runId, status: 'cancelled' });
    } catch (err) {
      next(err);
    }
  });

  // OpenWOP canonical URL is /v1/runs/{runId}:fork. Express
  // path-to-regexp parses `:fork` as a second parameter, so we pin the
  // route via regex literal. Captures runId in match[1].
  app.post(/^\/v1\/runs\/([^/:]+):fork$/, async (req, res, next) => {
    try {
      // Express regex routes expose captures via req.params['0'], ['1'], …
      const runId = (req.params as Record<string, string>)['0'];
      if (!runId) throw new OpenwopError('invalid_request', 'runId path segment required', 400);
      const sourceRun = await storage.getRun(runId);
      if (!sourceRun) throw new OpenwopError('run_not_found', `run ${runId} not found`, 404);
      const body = req.body as ForkRunRequest;
      if (typeof body?.fromSeq !== 'number' || body.fromSeq < 0) {
        throw new OpenwopError('fork_invalid_seq', 'fromSeq must be a non-negative integer', 400);
      }
      if (body.mode !== 'replay' && body.mode !== 'branch') {
        throw new OpenwopError('fork_unsupported_mode', `mode must be one of replay|branch`, 400);
      }
      const maxSeq = await storage.getMaxSequence(sourceRun.runId);
      if (body.fromSeq > maxSeq) {
        throw new OpenwopError('fork_invalid_seq', `fromSeq ${body.fromSeq} > maxSeq ${maxSeq}`, 400);
      }

      const newRunId = randomUUID();
      const now = new Date().toISOString();
      const forkedRun: RunRecord = {
        ...sourceRun,
        runId: newRunId,
        parentRunId: sourceRun.runId,
        parentSeq: body.fromSeq,
        forkMode: body.mode,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        completedAt: undefined,
        error: undefined,
        configurable: { ...sourceRun.configurable, ...(body.runOptionsOverlay ?? {}) },
        idempotencyKey: undefined,
      };
      await storage.insertRun(forkedRun);

      // Replay events up to fromSeq into the new run, then re-dispatch.
      // Sample-grade: copies events as-is. Real impls re-execute pure
      // nodes deterministically (the `replay` mode) vs. branching from
      // a checkpoint (the `branch` mode).
      const sourceEvents = await storage.listEvents(sourceRun.runId, { fromSeq: 0, limit: body.fromSeq });
      for (const ev of sourceEvents) {
        await getEventLog().append({
          runId: newRunId,
          type: ev.type,
          nodeId: ev.nodeId,
          payload: ev.payload,
          causationId: ev.eventId,
        });
      }

      const wf = await hostSuite.workflowCatalog.getWorkflow(forkedRun.workflowId);
      if (!wf) {
        throw new OpenwopError(
          'workflow_not_found',
          'Workflow not found in this catalog.',
          404,
          { workflowId: forkedRun.workflowId },
        );
      }

      const response: ForkRunResponse = {
        runId: newRunId,
        sourceRunId: sourceRun.runId,
        fromSeq: body.fromSeq,
        mode: body.mode,
        status: 'pending',
        eventsUrl: `${req.protocol}://${req.get('host')}/v1/runs/${newRunId}/events`,
      };
      res.status(201).json(response);

      setImmediate(() => {
        executeRun(storage, forkedRun, wf.definition, {
          policyResolver: hostSuite.providerPolicyResolver,
        }).catch((err) => {
          log.error('fork dispatch failed', {
            runId: newRunId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/runs/:runId/events/poll', async (req, res, next) => {
    try {
      const run = await storage.getRun(req.params.runId);
      if (!run) throw new OpenwopError('run_not_found', `run ${req.params.runId} not found`, 404);
      const fromSeq = Number(req.query.fromSeq ?? 0) || 0;
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 1000);
      const events = await storage.listEvents(run.runId, { fromSeq, limit });
      const isComplete = ['completed', 'failed', 'cancelled'].includes(run.status);
      respondJson(res, 200, { events, isComplete });
    } catch (err) {
      next(err);
    }
  });
}

function projectRunSnapshot(run: RunRecord) {
  return {
    runId: run.runId,
    workflowId: run.workflowId,
    status: run.status,
    currentNodeId: run.currentNodeId,
    startedAt: run.createdAt,
    completedAt: run.completedAt,
    error: run.error,
    parentRunId: run.parentRunId,
    parentSeq: run.parentSeq,
    forkMode: run.forkMode,
  };
}

function respondJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}
