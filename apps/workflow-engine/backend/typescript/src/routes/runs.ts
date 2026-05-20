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
import { seedRunVariables, snapshotRunVariables } from '../host/variablesRuntime.js';
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
            // Per `rest-endpoints.md` POST /v1/runs response headers:
            // cache-served responses MUST carry `openwop-Idempotent-Replay:
            // true` so the client distinguishes a replayed response from
            // a fresh one (same runId, same status — header is the only
            // observable signal).
            res
              .status(existing.responseStatus)
              .set('openwop-Idempotent-Replay', 'true')
              .type('application/json')
              .send(existing.responseBody);
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
      // Seed the per-run variable bag from workflow defaults +
      // request inputs. Per `host/variablesRuntime.ts`: `inputs[name]`
      // overrides `variables[].defaultValue` by variable name; vars
      // without an override and without a default are not seeded
      // (read surface returns undefined → key absent in JSON).
      seedRunVariables(runId, wf.definition.variables, body.inputs);
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

  // Artifact endpoint stub. The host doesn't implement artifact
  // storage end-to-end yet, but the route MUST 401 on missing Bearer
  // BEFORE 404'ing on missing resource — per `artifact-auth` scenario
  // and `auth.md §"Error envelope"`. Without an explicit Bearer the
  // request would otherwise fall through to the catch-all 404 (the
  // auth middleware auto-issues anon cookies, so it never 401s on
  // missing Authorization). Same fix as `examples/hosts/sqlite/src/
  // server.ts` artifact stub. Closes the info-leak surface for every
  // HTTP method (per `auth.md`: auth-check stacks above
  // existence-check).
  const artifactPathRe = /^\/v1\/runs\/([^/]+)\/artifacts\/([^/]+)$/;
  app.use((req, res, next) => {
    const m = artifactPathRe.exec(req.path);
    if (!m) return next();
    const header = req.header('authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      res.status(401).json({
        error: 'unauthenticated',
        message: 'Artifact endpoint requires a Bearer token (anon session cookie is not sufficient).',
      });
      return;
    }
    if (req.method !== 'GET') {
      res.status(405).json({
        error: 'method_not_allowed',
        message: `Artifact endpoint accepts GET only; received ${req.method}.`,
      });
      return;
    }
    // Authed Bearer + GET — no artifact storage to look up, so 404
    // with the canonical not_found envelope. Positive-path coverage
    // lights up when the host gains an artifact-producing fixture.
    res.status(404).json({
      error: 'not_found',
      message: `artifact '${decodeURIComponent(m[2] ?? '')}' not found on run '${decodeURIComponent(m[1] ?? '')}'`,
    });
  });

  // Bulk-cancel per `rest-endpoints.md §"POST /v1/runs:bulk-cancel"`.
  // Top-level 200 when the request reached the host (per-id outcomes
  // carry partial failure); 400 on empty / oversized runIds. The
  // canonical URL uses the `:bulk-cancel` action segment, which
  // Express 4 doesn't accept directly in a path string (path-to-regexp
  // treats `:` as a param prefix) — use a literal regex to match.
  const MAX_RUN_IDS = 100;
  app.post(/^\/v1\/runs:bulk-cancel$/, async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { runIds?: unknown; reason?: unknown };
      if (!Array.isArray(body.runIds) || body.runIds.length === 0) {
        throw new OpenwopError(
          'validation_error',
          'runIds MUST be a non-empty array of run-id strings.',
          400,
          { maxRunIds: MAX_RUN_IDS },
        );
      }
      if (body.runIds.length > MAX_RUN_IDS) {
        throw new OpenwopError(
          'validation_error',
          `runIds length ${body.runIds.length} exceeds maxRunIds ${MAX_RUN_IDS}.`,
          400,
          { maxRunIds: MAX_RUN_IDS },
        );
      }
      const reason = (typeof body.reason === 'string' ? body.reason : 'bulk cancel');
      const terminal = ['completed', 'failed', 'cancelled'];
      const results: Array<{ runId: string; ok: boolean; status?: string; error?: { code: string; message: string } }> = [];
      for (const rawId of body.runIds) {
        if (typeof rawId !== 'string' || rawId.length === 0) {
          results.push({ runId: String(rawId), ok: false, error: { code: 'invalid_request', message: 'runId MUST be a non-empty string' } });
          continue;
        }
        const run = await storage.getRun(rawId);
        if (!run) {
          results.push({ runId: rawId, ok: false, error: { code: 'not_found', message: `run ${rawId} not found` } });
          continue;
        }
        if (terminal.includes(run.status)) {
          // Idempotent: re-cancelling an already-terminal run returns
          // ok with the existing terminal status. Conformance asserts
          // this directly per the "re-bulk-cancel after first cancel"
          // subtest.
          results.push({ runId: rawId, ok: true, status: run.status });
          continue;
        }
        try {
          await storage.updateRun(rawId, {
            status: 'cancelled',
            completedAt: new Date().toISOString(),
            error: { code: 'cancelled', message: reason },
          });
          await getEventLog().append({ runId: rawId, type: 'run.cancelled', payload: { reason } });
          notifyRunTerminal(rawId);
          results.push({ runId: rawId, ok: true, status: 'cancelled' });
        } catch (err) {
          results.push({ runId: rawId, ok: false, error: { code: 'internal_error', message: err instanceof Error ? err.message : String(err) } });
        }
      }
      res.status(200).json({ results });
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
      // Accept both `lastSequence` (spec-canonical per rest-endpoints.md)
      // and the sample's legacy `fromSeq`. `lastSequence=N` returns
      // events with sequence > N, so we add 1 when reading it. Beyond-
      // the-end values return an empty events array per the forward-
      // compat contract — NOT a 4xx.
      const lastSeqRaw = req.query.lastSequence;
      const fromSeq = lastSeqRaw !== undefined
        ? (Number(lastSeqRaw) || 0) + 1
        : (Number(req.query.fromSeq ?? 0) || 0);
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 1000);
      const events = await storage.listEvents(run.runId, { fromSeq, limit });
      const isComplete = ['completed', 'failed', 'cancelled'].includes(run.status);
      respondJson(res, 200, { events, isComplete });
    } catch (err) {
      next(err);
    }
  });

  // Debug-bundle export per `spec/v1/debug-bundle.md`. Returns the full
  // event log for a run plus run metadata + truncation metadata. The
  // optional `?maxEvents=N` query forces truncation (implementation-
  // defined per spec: "Hosts MAY raise the cap via implementation-
  // defined configuration") so conformance can drive the truncation
  // contract deterministically.
  app.get('/v1/runs/:runId/debug-bundle', async (req, res, next) => {
    try {
      const run = await storage.getRun(req.params.runId);
      if (!run) throw new OpenwopError('run_not_found', `run ${req.params.runId} not found`, 404);
      const allEvents = await storage.listEvents(run.runId, { fromSeq: 0, limit: 100_000 });
      const cap = req.query.maxEvents !== undefined ? Number(req.query.maxEvents) : Number.POSITIVE_INFINITY;
      const events = Number.isFinite(cap) && cap >= 0 ? allEvents.slice(0, cap) : allEvents;
      const truncated = events.length < allEvents.length;
      respondJson(res, 200, {
        runId: run.runId,
        workflowId: run.workflowId,
        status: run.status,
        events,
        truncated,
        ...(truncated ? { truncatedReason: `Bundle capped at maxEvents=${cap} (configured via query param).` } : {}),
        metrics: { eventCount: allEvents.length },
      });
    } catch (err) {
      next(err);
    }
  });
}

function projectRunSnapshot(run: RunRecord) {
  const variables = snapshotRunVariables(run.runId);
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
    // RFC 0022 §B / `workflow-definition.schema.json §variables` —
    // the per-run variable bag (seeded at run-create from
    // `workflow.variables[].defaultValue` + `request.inputs`). Absent
    // when the run was never seeded (legacy fixtures without a
    // `variables[]` declaration). The omission is meaningful — JSON
    // serialization drops `undefined` keys.
    ...(variables !== null ? { variables } : {}),
  };
}

function respondJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}
