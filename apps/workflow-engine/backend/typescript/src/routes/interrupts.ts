/**
 * Interrupt-resolution routes:
 *   POST /v1/runs/{runId}/interrupts/{nodeId}    — node-scoped resolve
 *   POST /v1/interrupts/{token}                   — token-scoped resolve (unauth-friendly)
 *   GET  /v1/interrupts/{token}                   — inspect (returns kind + resumeSchema)
 *
 * After resolution, the run resumes via executor.executeRun() with
 * the suspended node's index + the resolved value as input.
 */

import type { Express } from 'express';
import type { ResolveInterruptRequest } from '@openwop/openwop';
import type { Storage } from '../storage/storage.js';
import { OpenwopError } from '../types.js';
import { getSuspendManager } from '../executor/suspendManager.js';
import { getEventLog } from '../executor/eventLog.js';
import { executeRun } from '../executor/executor.js';
import { createLogger } from '../observability/logger.js';
import { createHostAdapterSuite, type HostAdapterSuite } from '../host/index.js';

const log = createLogger('routes.interrupts');

interface Deps {
  storage: Storage;
  hostSuite?: HostAdapterSuite;
}

export function registerInterruptRoutes(app: Express, deps: Deps): void {
  const { storage } = deps;
  // Lazily build a host suite for workflow lookups on resume; routes layer
  // below also reuses this. The shared suite is constructed in index.ts;
  // this fallback keeps the file self-contained for tests.
  const hostSuite = deps.hostSuite ?? createHostAdapterSuite({ storage });

  app.post('/v1/runs/:runId/interrupts/:nodeId', async (req, res, next) => {
    try {
      const { runId, nodeId } = req.params;
      const interrupt = storage.getInterruptByNode(runId, nodeId);
      if (!interrupt) throw new OpenwopError('interrupt_not_found', 'no open interrupt for this node', 404);
      if (interrupt.resolvedAt) throw new OpenwopError('interrupt_already_resolved', 'interrupt already resolved', 409);
      const body = req.body as ResolveInterruptRequest;
      await resolveAndResume(storage, hostSuite, interrupt.interruptId, body?.resumeValue);
      const run = storage.getRun(runId);
      res.json({ runId, nodeId, status: run?.status ?? 'running' });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/interrupts/:token', async (req, res, next) => {
    try {
      const { token } = req.params;
      const interrupt = storage.getInterruptByToken(token);
      if (!interrupt) throw new OpenwopError('invalid_interrupt_token', 'unknown interrupt token', 404);
      if (interrupt.resolvedAt) throw new OpenwopError('interrupt_already_resolved', 'interrupt already resolved', 409);
      const body = req.body as { resumeValue?: unknown };
      await resolveAndResume(storage, hostSuite, interrupt.interruptId, body?.resumeValue);
      res.json({ runId: interrupt.runId, nodeId: interrupt.nodeId, status: storage.getRun(interrupt.runId)?.status });
    } catch (err) {
      next(err);
    }
  });

  // Authenticated list of open interrupts for a run. Returns tokens —
  // public event log no longer carries them (see executor.ts §node.suspended).
  //
  // Vendor-prefixed under /v1/host/sample/* per host-extensions.md
  // §"Canonical prefixes". This endpoint is a strong RFC candidate —
  // every host that strips tokens from the public event log needs a
  // way for authed callers to list open interrupts with tokens. For
  // now it stays sample-scoped to avoid contract drift.
  app.get('/v1/host/sample/runs/:runId/interrupts', (req, res, next) => {
    try {
      const run = storage.getRun(req.params.runId);
      if (!run) throw new OpenwopError('run_not_found', `run ${req.params.runId} not found`, 404);
      const open = storage.listOpenInterrupts(run.runId);
      res.json({
        runId: run.runId,
        interrupts: open.map((it) => ({
          interruptId: it.interruptId,
          nodeId: it.nodeId,
          kind: it.kind,
          token: it.token,
          data: it.data,
          resumeSchema: it.resumeSchema,
          createdAt: it.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/interrupts/:token', (req, res, next) => {
    try {
      const interrupt = storage.getInterruptByToken(req.params.token);
      if (!interrupt) throw new OpenwopError('invalid_interrupt_token', 'unknown interrupt token', 404);
      res.json({
        kind: interrupt.kind,
        key: interrupt.interruptId,
        resumeSchema: interrupt.resumeSchema,
        data: interrupt.data,
        resolved: interrupt.resolvedAt != null,
      });
    } catch (err) {
      next(err);
    }
  });
}

async function resolveAndResume(
  storage: Storage,
  hostSuite: HostAdapterSuite,
  interruptId: string,
  resumeValue: unknown,
): Promise<void> {
  const interrupt = storage.getInterrupt(interruptId);
  if (!interrupt) throw new OpenwopError('interrupt_not_found', 'interrupt missing on resume', 404);

  getSuspendManager().resolve(interruptId, resumeValue);
  getEventLog().append({
    runId: interrupt.runId,
    nodeId: interrupt.nodeId,
    type: 'node.interrupt.resolved',
    payload: { interruptId, kind: interrupt.kind },
  });

  const run = storage.getRun(interrupt.runId);
  if (!run) throw new OpenwopError('run_not_found', `run ${interrupt.runId} missing during resume`, 404);
  const wf = await hostSuite.workflowCatalog.getWorkflow(run.workflowId);
  if (!wf) throw new OpenwopError('workflow_not_found', `workflow ${run.workflowId} not found`, 404);

  const nodeIndex = wf.definition.nodes.findIndex((n) => n.nodeId === interrupt.nodeId);
  if (nodeIndex < 0) throw new OpenwopError('internal_error', `suspended node ${interrupt.nodeId} not in workflow`, 500);

  // Resume the DAG scheduler. If a serialized snapshot exists (post-DAG),
  // hydrate it and mark the suspended node as completed with the resolved
  // value. If not (legacy linear path), fall back to `resumeFromNodeIndex`
  // which the executor handles via its implicit-linear chain logic.
  const serializedSnapshot = run.schedulerSnapshot;
  setImmediate(() => {
    const resumeOptions =
      typeof serializedSnapshot === 'string'
        ? (() => {
            try {
              return {
                resumeSnapshot: JSON.parse(serializedSnapshot) as never,
                resumeNodeId: interrupt.nodeId,
                resumeValue,
                policyResolver: hostSuite.providerPolicyResolver,
              };
            } catch {
              return {
                resumeFromNodeIndex: nodeIndex + 1,
                resumeValue,
                policyResolver: hostSuite.providerPolicyResolver,
              };
            }
          })()
        : {
            resumeFromNodeIndex: nodeIndex + 1,
            resumeValue,
            policyResolver: hostSuite.providerPolicyResolver,
          };
    executeRun(storage, run, wf.definition, resumeOptions).catch((err) => {
      log.error('resume dispatch failed', {
        runId: run.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}
