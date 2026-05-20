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
      const interrupt = await storage.getInterruptByNode(runId, nodeId);
      if (!interrupt) throw new OpenwopError('interrupt_not_found', 'no open interrupt for this node', 404);
      // Cascaded-cancel detection per `interrupt-profiles.md
      // §openwop-interrupt-parent-child`: when the run is cancelled,
      // the interrupt is invalidated. Prefer 410 Gone over 409 so the
      // contract distinguishes "resource removed by external state"
      // from "resource already resolved by you" — the conformance suite
      // accepts both, but Gone is the more honest answer.
      const currentRun = await storage.getRun(runId);
      if (currentRun && currentRun.status === 'cancelled') {
        throw new OpenwopError('interrupt_gone', 'interrupt invalidated — run was cancelled', 410);
      }
      if (interrupt.resolvedAt) throw new OpenwopError('interrupt_already_resolved', 'interrupt already resolved', 409);
      const body = req.body as ResolveInterruptRequest;
      validateResumeValue(interrupt, body?.resumeValue);
      await resolveAndResume(storage, hostSuite, interrupt.interruptId, body?.resumeValue);
      const run = await storage.getRun(runId);
      res.json({ runId, nodeId, status: run?.status ?? 'running' });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/interrupts/:token', async (req, res, next) => {
    try {
      const { token } = req.params;
      const interrupt = await storage.getInterruptByToken(token);
      if (!interrupt) throw new OpenwopError('invalid_interrupt_token', 'unknown interrupt token', 404);
      if (interrupt.resolvedAt) throw new OpenwopError('interrupt_already_resolved', 'interrupt already resolved', 409);
      const body = req.body as { resumeValue?: unknown };
      // External-event interrupts validate correlation per
      // `interrupt-profiles.md §openwop-interrupt-external-event`:
      // the resume payload MUST match every field in
      // `interrupt.data.correlation`. Mismatched correlation
      // returns 422 without resuming.
      if (interrupt.kind === 'external-event') {
        const violation = checkExternalEventCorrelation(interrupt.data, body?.resumeValue);
        if (violation) {
          throw new OpenwopError(
            'validation_error',
            `External event correlation mismatch: ${violation}`,
            422,
            { mismatch: violation },
          );
        }
      }
      await resolveAndResume(storage, hostSuite, interrupt.interruptId, body?.resumeValue);
      const run = await storage.getRun(interrupt.runId);
      res.json({ runId: interrupt.runId, nodeId: interrupt.nodeId, status: run?.status });
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
  app.get('/v1/host/sample/runs/:runId/interrupts', async (req, res, next) => {
    try {
      const run = await storage.getRun(req.params.runId);
      if (!run) throw new OpenwopError('run_not_found', `run ${req.params.runId} not found`, 404);
      const open = await storage.listOpenInterrupts(run.runId);
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

  app.get('/v1/interrupts/:token', async (req, res, next) => {
    try {
      const interrupt = await storage.getInterruptByToken(req.params.token);
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

/**
 * Validate `resumeValue` against the interrupt's declared shape.
 * Per `interrupt.md §"resumeSchema"`: a resolve payload that
 * violates the schema MUST be rejected with 400 (validation_error)
 * or 422. Today we cover the common-case approval-gate enum check
 * (data.actions must contain resumeValue.action) without pulling
 * Ajv into the route layer; richer JSON-Schema validation can stack
 * later as resume contracts grow.
 */
function validateResumeValue(
  interrupt: { kind: string; data: unknown; resumeSchema?: unknown },
  resumeValue: unknown,
): void {
  if (interrupt.kind !== 'approval') return;
  const data = (interrupt.data ?? {}) as { actions?: unknown };
  if (!Array.isArray(data.actions)) return;
  const allowed = data.actions.filter((a): a is string => typeof a === 'string');
  if (allowed.length === 0) return;
  const action = (resumeValue && typeof resumeValue === 'object'
    ? (resumeValue as { action?: unknown }).action
    : undefined);
  if (typeof action !== 'string' || !allowed.includes(action)) {
    throw new OpenwopError(
      'validation_error',
      `resumeValue.action MUST be one of [${allowed.join(', ')}]; received ${JSON.stringify(action)}.`,
      400,
      { allowed, received: action },
    );
  }
}

/** Per `interrupt-profiles.md §openwop-interrupt-external-event`:
 *  the resume payload's fields MUST match every field in the
 *  interrupt's `data.correlation` object. Returns null on match, or
 *  a description of the first mismatch on miss.
 *
 *  Match semantics are deep-equal on each correlation key. Extra
 *  fields in the resume payload (e.g., the test's
 *  `externalReference`) are ignored — only the correlation keys
 *  declared by the suspended node need to match. */
function checkExternalEventCorrelation(
  interruptData: unknown,
  resumeValue: unknown,
): string | null {
  const data = (interruptData ?? {}) as { correlation?: unknown };
  const correlation = data.correlation;
  if (!correlation || typeof correlation !== 'object') return null;
  if (!resumeValue || typeof resumeValue !== 'object') {
    return 'resumeValue MUST be an object when interrupt declares correlation';
  }
  const rv = resumeValue as Record<string, unknown>;
  for (const [key, expected] of Object.entries(correlation as Record<string, unknown>)) {
    if (JSON.stringify(rv[key]) !== JSON.stringify(expected)) {
      return `correlation.${key} expected ${JSON.stringify(expected)}, got ${JSON.stringify(rv[key])}`;
    }
  }
  return null;
}

/** Per-interrupt vote ledger for quorum gates per
 *  `interrupt-profiles.md §openwop-interrupt-quorum`. In-memory by
 *  design — votes are ephemeral per suspend cycle; if the host
 *  process restarts, the run resumes from the persisted interrupt
 *  with vote count zero (acceptable: spec requires the votes to be
 *  visible during the gate's lifetime, not durable across restarts). */
const quorumVotes = new Map<string, { accepts: string[]; rejects: string[] }>();

/** Accumulate a quorum vote. Returns:
 *   - 'accept-quorum-met' → run can resume with accepted outcome
 *   - 'reject-majority' → gate fails with rejection
 *   - 'pending' → record vote, return 200 to client, DON'T resume
 *   - null → not a quorum gate; caller proceeds with normal resume */
function recordQuorumVote(
  interruptId: string,
  interruptData: unknown,
  resumeValue: unknown,
): 'accept-quorum-met' | 'reject-majority' | 'pending' | null {
  const data = (interruptData ?? {}) as { requiredApprovals?: number; rejectionPolicy?: string };
  const requiredApprovals = typeof data.requiredApprovals === 'number' && data.requiredApprovals > 1
    ? data.requiredApprovals
    : 0;
  if (requiredApprovals === 0) return null; // not a quorum gate
  const rv = (resumeValue ?? {}) as { action?: string; voter?: string };
  if (rv.action !== 'accept' && rv.action !== 'reject') return null;
  const voter = typeof rv.voter === 'string' ? rv.voter : `anon-${(quorumVotes.get(interruptId)?.accepts.length ?? 0) + (quorumVotes.get(interruptId)?.rejects.length ?? 0) + 1}`;
  let ledger = quorumVotes.get(interruptId);
  if (!ledger) {
    ledger = { accepts: [], rejects: [] };
    quorumVotes.set(interruptId, ledger);
  }
  if (rv.action === 'accept') ledger.accepts.push(voter);
  else ledger.rejects.push(voter);

  // Resolution checks.
  if (ledger.accepts.length >= requiredApprovals) return 'accept-quorum-met';
  if (data.rejectionPolicy === 'majority') {
    // Majority rejection = more than half of requiredApprovals
    // rejected. For requiredApprovals=3, majority-reject = 2 rejects.
    const majorityThreshold = Math.floor(requiredApprovals / 2) + 1;
    if (ledger.rejects.length >= majorityThreshold) return 'reject-majority';
  }
  return 'pending';
}

function clearQuorumVotes(interruptId: string): void {
  quorumVotes.delete(interruptId);
}

async function resolveAndResume(
  storage: Storage,
  hostSuite: HostAdapterSuite,
  interruptId: string,
  resumeValue: unknown,
): Promise<void> {
  const interrupt = await storage.getInterrupt(interruptId);
  if (!interrupt) throw new OpenwopError('interrupt_not_found', 'interrupt missing on resume', 404);

  // Quorum-gate handling: accumulate votes until threshold met.
  // Returns null when not a quorum gate (fall-through to normal resume).
  const quorumOutcome = recordQuorumVote(interruptId, interrupt.data, resumeValue);
  if (quorumOutcome === 'pending') {
    // Vote recorded but quorum not met. Emit a partial-vote event so
    // callers polling the event log can see the progress. The
    // interrupt stays open; the run stays in waiting-approval.
    await getEventLog().append({
      runId: interrupt.runId,
      nodeId: interrupt.nodeId,
      type: 'interrupt.vote.recorded',
      payload: { interruptId, kind: interrupt.kind, ledger: quorumVotes.get(interruptId) },
    });
    return;
  }
  if (quorumOutcome === 'reject-majority') {
    clearQuorumVotes(interruptId);
    // Fail the gate. Mark interrupt resolved with the rejection,
    // then mark the run failed. We don't resume execution.
    await storage.resolveInterrupt(interruptId, { action: 'reject', reason: 'quorum-majority-reject' }, new Date().toISOString());
    await getEventLog().append({
      runId: interrupt.runId,
      nodeId: interrupt.nodeId,
      type: 'run.failed',
      payload: {
        error: { code: 'approval_rejected', message: 'Quorum gate failed: majority rejected.' },
      },
    });
    await storage.updateRun(interrupt.runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: { code: 'approval_rejected', message: 'Quorum gate failed: majority rejected.' },
    });
    return;
  }
  if (quorumOutcome === 'accept-quorum-met') {
    clearQuorumVotes(interruptId);
    // Fall through to the normal resume path below.
  }

  await getSuspendManager().resolve(interruptId, resumeValue);
  await getEventLog().append({
    runId: interrupt.runId,
    nodeId: interrupt.nodeId,
    type: 'node.interrupt.resolved',
    payload: { interruptId, kind: interrupt.kind },
  });

  const run = await storage.getRun(interrupt.runId);
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
