/**
 * DAG-aware workflow executor.
 *
 * Builds a node-state snapshot from the WorkflowDefinition's nodes +
 * edges, then drains a ready-queue with bounded concurrency. Per-node
 * work (NodeRegistry dispatch, BYOK secret prep, OTel span, event log)
 * is unchanged from the legacy linear executor — only the *order* and
 * *parallelism* are new.
 *
 * Suspend semantics:
 *   - When any node returns `suspended`, that node's state is `suspended`;
 *     the run keeps draining other ready branches.
 *   - When no ready/running nodes remain AND at least one node is
 *     suspended, the run transitions to `waiting-*` (kind = first
 *     suspended node's interrupt kind).
 *
 * Resume semantics (see resumeRun in this module):
 *   - Resolver flips the suspended node to `completed` with the resolved
 *     value mapped onto its `outputs.input` port.
 *   - The scheduler re-enters and drains until the next terminal.
 *
 * Replay determinism: the Layer-2 invocation log (per spec/v1/replay.md)
 * keys outputs on (runId, nodeId, request-hash), so re-execution is
 * idempotent regardless of scheduler order. The canonical post-hoc
 * ordering is `event.sequence` — the executor's single-process event-log
 * writer serializes appends so concurrent completions get monotonic
 * sequence numbers. Multi-process hosts (e.g., Postgres) achieve the
 * same property via a storage-layer monotonic sequence.
 *
 * @see scheduler.ts for the trigger-rule + condition evaluation.
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';
import { getNodeRegistry } from './nodeRegistry.js';
import { getEventLog } from './eventLog.js';
import { getSuspendManager } from './suspendManager.js';
import { hasCapability } from './runtimeCapabilities.js';
import {
  setRunSecrets,
  getRunSecrets,
  clearRunSecrets,
  stripSecretsFromPersisted,
  nonEnumerableSecretsView,
} from '../byok/ephemeralRunSecrets.js';
import { resolveSecret } from '../byok/secretResolver.js';
import { OpenwopError } from '../types.js';
import type { Storage } from '../storage/storage.js';
import type {
  EdgeDef,
  NodeContext,
  NodeOutcome,
  WorkflowDefinition,
} from './types.js';
import type { RunRecord } from '../types.js';
import type { ProviderPolicyResolver } from '../host/index.js';
import { createAiProvidersAdapter, AiProviderError } from '../aiProviders/aiProvidersHost.js';
import { buildHostSurfaceBundle } from '../host/inMemorySurfaces.js';
import {
  buildGraph,
  buildNodeInputs,
  freshSnapshot,
  inspectDisposition,
  markCompleted,
  markFailed,
  markSuspended,
  maxConcurrentNodes,
  popReady,
  releaseDownstream,
  type SchedulerGraph,
  type SchedulerSnapshot,
} from './scheduler.js';

export interface ExecuteRunResult {
  status: RunRecord['status'];
  /** Set of node ids that were suspended when the run paused. Replaces the
   *  legacy `pausedAtIndex` field; for purely linear back-compat callers,
   *  pausedAtIndex is also surfaced when exactly one node is suspended. */
  pausedNodeIds?: string[];
  /** Back-compat: index of the suspended node in `definition.nodes`. Only
   *  set for linear (no-edges or implicit-linear) workflows with exactly
   *  one suspended node. */
  pausedAtIndex?: number;
}

/**
 * Emit the canonical terminal-failure event sequence: `node.failed`
 * (when a node was active) → `run.failed` → update run record.
 */
function emitTerminalFailure(input: {
  storage: Storage;
  runId: string;
  nodeId?: string;
  error: { code: string; message: string };
}): void {
  const eventLog = getEventLog();
  const errorPayload = stripSecretsFromPersisted({ error: input.error });
  if (input.nodeId) {
    eventLog.append({
      runId: input.runId,
      nodeId: input.nodeId,
      type: 'node.failed',
      payload: errorPayload,
    });
  }
  eventLog.append({
    runId: input.runId,
    type: 'run.failed',
    payload: errorPayload,
  });
  input.storage.updateRun(input.runId, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    error: input.error,
  });
  clearRunSecrets(input.runId);
}

/**
 * Normalize a definition to always have `edges`. Legacy callers that pass
 * `nodes` without `edges` get an implicit linear chain so the scheduler
 * walks them in array order.
 */
function withImplicitEdges(definition: WorkflowDefinition): WorkflowDefinition {
  if (definition.edges && definition.edges.length > 0) return definition;
  // Implicit linear edges for back-compat.
  const linearEdges: EdgeDef[] = [];
  for (let i = 0; i + 1 < definition.nodes.length; i++) {
    const src = definition.nodes[i]!;
    const tgt = definition.nodes[i + 1]!;
    linearEdges.push({
      edgeId: `implicit_${i}`,
      sourceNodeId: src.nodeId,
      targetNodeId: tgt.nodeId,
    });
  }
  return { ...definition, edges: linearEdges };
}

/**
 * Run a single node: resolve module, build ctx, dispatch, emit events.
 * Returns the outcome plus a `'caller-handle-terminal'` discriminator
 * so the scheduler knows whether to mark failed / suspended.
 */
async function runOneNode(input: {
  storage: Storage;
  run: RunRecord;
  nodeRef: { nodeId: string; typeId: string; config?: Record<string, unknown> };
  inputsByPort: Record<string, unknown>;
  policyResolver?: ProviderPolicyResolver;
}): Promise<
  | { kind: 'success'; outputs: Record<string, unknown> }
  | { kind: 'failure'; error: { code: string; message: string } }
  | {
      kind: 'suspended';
      interrupt: NonNullable<Extract<NodeOutcome, { status: 'suspended' }>['interrupt']>;
    }
> {
  const tracer = trace.getTracer('openwop.workflow-engine-sample');
  const registry = getNodeRegistry();
  const eventLog = getEventLog();

  const { storage, run, nodeRef, inputsByPort, policyResolver } = input;
  const module = await registry.resolve(nodeRef.typeId);
  if (!module) {
    const error = { code: 'workflow_not_found', message: `node module not registered: ${nodeRef.typeId}` };
    eventLog.append({
      runId: run.runId,
      nodeId: nodeRef.nodeId,
      type: 'node.failed',
      payload: stripSecretsFromPersisted({ error }),
    });
    return { kind: 'failure', error };
  }

  // Capability gating per spec/v1/host-capabilities.md §"Refuse on missing".
  if (module.requires) {
    for (const cap of module.requires) {
      if (!hasCapability(cap)) {
        const error = {
          code: 'host_capability_missing',
          message: `capability ${cap} not provided by host`,
        };
        eventLog.append({
          runId: run.runId,
          nodeId: nodeRef.nodeId,
          type: 'node.failed',
          payload: stripSecretsFromPersisted({ error }),
        });
        return { kind: 'failure', error };
      }
    }
  }

  storage.updateRun(run.runId, { currentNodeId: nodeRef.nodeId });
  eventLog.append({ runId: run.runId, nodeId: nodeRef.nodeId, type: 'node.started', payload: {} });

  const rawSecrets = getRunSecrets(run.runId);
  const secretsForCtx = nonEnumerableSecretsView(rawSecrets);
  const aiAdapter = policyResolver
    ? createAiProvidersAdapter({
        runId: run.runId,
        nodeId: nodeRef.nodeId,
        tenantId: run.tenantId,
        ...(run.scopeId ? { scopeId: run.scopeId } : {}),
        attempt: 1,
        secrets: rawSecrets,
        policyResolver,
      })
    : null;
  const surfaces = buildHostSurfaceBundle({
    tenantId: run.tenantId,
    ...(run.scopeId ? { scopeId: run.scopeId } : {}),
  });

  // Back-compat: many existing node implementations read ctx.inputs as a
  // single payload (e.g., `(ctx.inputs as Record<string,unknown>).prompt`).
  // The DAG scheduler passes a port-map. For source nodes (no incoming
  // edges) we unwrap `inputs.input` back to the original run inputs so
  // legacy nodes that ran in the linear executor continue to read the
  // same shape. For non-source nodes, port-keyed access is the supported
  // path going forward.
  const ctxInputs: unknown =
    Object.keys(inputsByPort).length === 1 && 'input' in inputsByPort
      ? inputsByPort.input
      : inputsByPort;

  const ctx: NodeContext = {
    runId: run.runId,
    nodeId: nodeRef.nodeId,
    tenantId: run.tenantId,
    scopeId: run.scopeId,
    inputs: ctxInputs,
    config: nodeRef.config ?? {},
    configurable: run.configurable ?? {},
    attempt: 1,
    secrets: secretsForCtx,
    async emit(type, payload) {
      eventLog.append({
        runId: run.runId,
        nodeId: nodeRef.nodeId,
        type,
        payload: stripSecretsFromPersisted(payload),
      });
    },
    ...(aiAdapter ? { callAI: aiAdapter.callAI, callAIWithTools: aiAdapter.callAIWithTools } : {}),
    storage: surfaces.storage,
    db: surfaces.db,
    fs: surfaces.fs,
    queueBus: surfaces.queueBus,
    observability: surfaces.observability,
  };

  let outcome: NodeOutcome;
  const span = tracer.startSpan(`openwop.node.${nodeRef.typeId}`, {
    attributes: {
      'openwop.run_id': run.runId,
      'openwop.node_id': nodeRef.nodeId,
      'openwop.node_type': nodeRef.typeId,
    },
  });
  try {
    outcome = await module.execute(ctx);
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    const code = err instanceof AiProviderError ? err.code : 'internal_error';
    outcome = { status: 'failure', error: { code, message } };
  } finally {
    span.end();
  }

  if (outcome.status === 'success') {
    eventLog.append({
      runId: run.runId,
      nodeId: nodeRef.nodeId,
      type: 'node.completed',
      payload: stripSecretsFromPersisted({ outputs: outcome.outputs }),
    });
    // Normalize outputs to a Record<string, unknown> for the snapshot.
    const outputsObj =
      outcome.outputs && typeof outcome.outputs === 'object' && !Array.isArray(outcome.outputs)
        ? (outcome.outputs as Record<string, unknown>)
        : { output: outcome.outputs };
    return { kind: 'success', outputs: outputsObj };
  }

  if (outcome.status === 'failure') {
    eventLog.append({
      runId: run.runId,
      nodeId: nodeRef.nodeId,
      type: 'node.failed',
      payload: stripSecretsFromPersisted({ error: outcome.error }),
    });
    return { kind: 'failure', error: outcome.error };
  }

  // Suspended.
  return { kind: 'suspended', interrupt: outcome.interrupt };
}

export async function executeRun(
  storage: Storage,
  run: RunRecord,
  rawDefinition: WorkflowDefinition,
  options: {
    resumeFromNodeIndex?: number;
    /** New-style resume: hydrate the snapshot from these completed nodes. */
    resumeSnapshot?: SerializedSnapshot;
    resumeValue?: unknown;
    /** When resuming, the nodeId whose suspension just resolved. */
    resumeNodeId?: string;
    policyResolver?: ProviderPolicyResolver;
  } = {},
): Promise<ExecuteRunResult> {
  const eventLog = getEventLog();
  const suspend = getSuspendManager();
  const definition = withImplicitEdges(rawDefinition);
  const isResume = options.resumeSnapshot !== undefined || options.resumeFromNodeIndex !== undefined;

  if (!isResume) {
    eventLog.append({ runId: run.runId, type: 'run.started', payload: { workflowId: run.workflowId } });
    storage.updateRun(run.runId, { status: 'running' });
  } else {
    eventLog.append({
      runId: run.runId,
      type: 'run.resumed',
      payload: { resumedAtNode: options.resumeNodeId ?? null },
    });
    storage.updateRun(run.runId, { status: 'running' });
  }

  // Cycle detection + snapshot construction.
  let graph: SchedulerGraph;
  let snapshot: SchedulerSnapshot;
  try {
    graph = buildGraph(definition);
    snapshot = options.resumeSnapshot
      ? hydrateSnapshot(definition, options.resumeSnapshot)
      : freshSnapshot(definition);
  } catch (err) {
    const code = (err as Error & { code?: string }).code ?? 'workflow_invalid';
    const message = err instanceof Error ? err.message : String(err);
    emitTerminalFailure({ storage, runId: run.runId, error: { code, message } });
    return { status: 'failed' };
  }

  // When resuming from the legacy linear path (`resumeFromNodeIndex`), seed
  // every prior node as completed using `resumeValue` as the seed input on
  // the resume target.
  if (options.resumeFromNodeIndex !== undefined && !options.resumeSnapshot) {
    for (let i = 0; i < options.resumeFromNodeIndex; i++) {
      const id = definition.nodes[i]?.nodeId;
      if (id) {
        snapshot.nodeState.set(id, 'completed');
        snapshot.nodeOutputs.set(id, { output: undefined });
      }
    }
    const resumeNode = definition.nodes[options.resumeFromNodeIndex]?.nodeId;
    if (resumeNode) {
      // Set the previous-node output to the resumed value so the resume target
      // sees it on its `input` port.
      const prev = definition.nodes[options.resumeFromNodeIndex - 1]?.nodeId;
      if (prev) snapshot.nodeOutputs.set(prev, { output: options.resumeValue });
      snapshot.nodeState.set(resumeNode, 'ready');
      releaseDownstream(prev ?? resumeNode, graph, snapshot);
    }
  }

  // Resume-by-snapshot: mark the resumed node as completed with the resolve value.
  if (options.resumeSnapshot && options.resumeNodeId) {
    snapshot.nodeOutputs.set(options.resumeNodeId, { output: options.resumeValue });
    snapshot.nodeState.set(options.resumeNodeId, 'completed');
    releaseDownstream(options.resumeNodeId, graph, snapshot);
  }

  // Resolve all required secrets up-front (only on initial run; resumes
  // already have the run-secrets bundle in the ephemeral store).
  if (!isResume) {
    try {
      await prepareRunSecrets(run, definition);
    } catch (err) {
      const code = err instanceof OpenwopError ? err.code : 'internal_error';
      const message = err instanceof Error ? err.message : String(err);
      emitTerminalFailure({ storage, runId: run.runId, error: { code, message } });
      return { status: 'failed' };
    }
  }

  const maxConcurrency = maxConcurrentNodes();
  const nodeById = new Map(definition.nodes.map((n) => [n.nodeId, n]));
  /** In-flight node tasks. Set lets us race them with Promise.race when
   *  no new ready nodes are available — replaces the 5ms busy-wait poll
   *  used in earlier revisions. */
  const inflight = new Set<Promise<void>>();
  /** Per-node interrupt kind, captured at suspension time so finalizeRun
   *  can map kind → waiting-* status (approval → 'waiting-approval',
   *  cancellation → 'paused', else 'waiting-input'). */
  const suspendedKinds = new Map<string, string>();

  function launch(nodeId: string): void {
    const nodeRef = nodeById.get(nodeId);
    const task = (async () => {
      if (!nodeRef) {
        markFailed(nodeId, { code: 'internal_error', message: `node ${nodeId} not in definition` }, snapshot);
        return;
      }
      const inputsByPort = buildNodeInputs(nodeId, graph, snapshot, run.inputs);
      const out = await runOneNode({
        storage,
        run,
        nodeRef,
        inputsByPort,
        ...(options.policyResolver ? { policyResolver: options.policyResolver } : {}),
      });
      if (out.kind === 'success') {
        markCompleted(nodeId, out.outputs, snapshot);
        releaseDownstream(nodeId, graph, snapshot);
      } else if (out.kind === 'failure') {
        markFailed(nodeId, out.error, snapshot);
        releaseDownstream(nodeId, graph, snapshot);
      } else {
        const interrupt = suspend.createInterrupt({
          runId: run.runId,
          nodeId,
          kind: out.interrupt.kind,
          data: out.interrupt.data,
          resumeSchema: out.interrupt.resumeSchema,
        });
        eventLog.append({
          runId: run.runId,
          nodeId,
          type: 'node.suspended',
          payload: { interruptId: interrupt.interruptId, kind: interrupt.kind },
        });
        suspendedKinds.set(nodeId, out.interrupt.kind);
        markSuspended(nodeId, snapshot);
      }
    })();
    // Self-remove on settle so Promise.race doesn't see completed tasks.
    const wrapped = task.finally(() => { inflight.delete(wrapped); });
    inflight.add(wrapped);
  }

  /**
   * Drain ready queue with bounded concurrency. Returns when no more nodes
   * can run without external input.
   */
  while (true) {
    const slots = Math.max(0, maxConcurrency - inflight.size);
    const batch = slots > 0 ? popReady(slots, snapshot) : [];

    if (batch.length === 0 && inflight.size === 0) {
      const disp = inspectDisposition(snapshot, graph, 0);
      if (disp.done) {
        return finalizeRun({
          storage, run, snapshot, graph, definition, disposition: disp, suspendedKinds,
        });
      }
      emitTerminalFailure({
        storage,
        runId: run.runId,
        error: { code: 'internal_error', message: 'scheduler stalled — no ready, no running, no suspended' },
      });
      return { status: 'failed' };
    }

    if (batch.length === 0) {
      // No newly-ready nodes; wait for one in-flight node to settle so we
      // can re-evaluate readiness. Promise.race resolves as soon as any
      // pending task settles (Note: .finally already removed it from the
      // set by the time we re-enter the loop).
      await Promise.race(inflight);
      continue;
    }

    for (const nodeId of batch) launch(nodeId);
  }
}

function finalizeRun(input: {
  storage: Storage;
  run: RunRecord;
  snapshot: SchedulerSnapshot;
  graph: SchedulerGraph;
  definition: WorkflowDefinition;
  disposition: ReturnType<typeof inspectDisposition>;
  suspendedKinds: Map<string, string>;
}): ExecuteRunResult {
  const { storage, run, snapshot, definition, disposition, suspendedKinds } = input;
  const eventLog = getEventLog();
  if (disposition.status === 'completed') {
    // Aggregate the outputs of every node with no outgoing edges (terminal
    // nodes) as the run's output. For pure-linear workflows this matches the
    // legacy executor exactly.
    const terminals = definition.nodes
      .map((n) => n.nodeId)
      .filter((id) => (input.graph.outgoing.get(id)?.length ?? 0) === 0)
      .filter((id) => snapshot.nodeState.get(id) === 'completed');
    let output: unknown;
    if (terminals.length === 1) {
      const terminalOutputs = snapshot.nodeOutputs.get(terminals[0]!);
      output = unwrapSingleOutput(terminalOutputs);
    } else if (terminals.length > 1) {
      output = Object.fromEntries(
        terminals.map((id) => [id, unwrapSingleOutput(snapshot.nodeOutputs.get(id))]),
      );
    }
    eventLog.append({
      runId: run.runId,
      type: 'run.completed',
      payload: stripSecretsFromPersisted({ output }),
    });
    storage.updateRun(run.runId, { status: 'completed', completedAt: new Date().toISOString() });
    clearRunSecrets(run.runId);
    return { status: 'completed' };
  }
  if (disposition.status === 'failed') {
    const err = snapshot.nodeErrors.get(disposition.failedNodeId!) ?? {
      code: 'internal_error',
      message: 'unknown node failure',
    };
    emitTerminalFailure({ storage, runId: run.runId, error: err });
    return { status: 'failed' };
  }
  // Waiting on suspended branch(es).
  const suspendedIds = [...snapshot.nodeState.entries()]
    .filter(([, s]) => s === 'suspended')
    .map(([id]) => id);
  const firstSuspended = disposition.suspendedNodeId ?? suspendedIds[0]!;
  const interruptKind = inferWaitingKind(firstSuspended, suspendedKinds);
  storage.updateRun(run.runId, { status: interruptKind, currentNodeId: firstSuspended });
  // Persist scheduler snapshot for resume.
  persistSnapshot(storage, run.runId, snapshot, suspendedKinds);
  // Back-compat: also surface pausedAtIndex for legacy callers when the
  // workflow is purely linear and exactly one node is suspended.
  const linearShape = (input.definition.edges ?? []).every((e) => e.edgeId.startsWith('implicit_'));
  const pausedAtIndex =
    suspendedIds.length === 1 && linearShape
      ? input.definition.nodes.findIndex((n) => n.nodeId === firstSuspended)
      : undefined;
  return {
    status: interruptKind,
    pausedNodeIds: suspendedIds,
    ...(pausedAtIndex !== undefined && pausedAtIndex >= 0 ? { pausedAtIndex } : {}),
  };
}

function inferWaitingKind(
  nodeId: string,
  suspendedKinds: Map<string, string>,
): RunRecord['status'] {
  const kind = suspendedKinds.get(nodeId);
  if (kind === 'approval') return 'waiting-approval';
  if (kind === 'cancellation') return 'paused';
  return 'waiting-input';
}

function unwrapSingleOutput(outputs?: Record<string, unknown>): unknown {
  if (!outputs) return undefined;
  if ('output' in outputs && Object.keys(outputs).length === 1) return outputs.output;
  return outputs;
}

/* ─── Snapshot persistence (for resume) ─────────────────────── */

/** Persisted scheduler snapshot. The version tag lets a future schema
 *  change (e.g., adding per-node attempt counters) refuse incompatible
 *  resume rather than silently producing wrong state. Sample is in-memory
 *  so this only matters across in-process re-init, but the discipline
 *  prevents the bug class from leaking into the host storage shape. */
export interface SerializedSnapshot {
  schemaVersion: 1;
  nodeState: Array<[string, string]>;
  nodeOutputs: Array<[string, Record<string, unknown>]>;
  nodeErrors: Array<[string, { code: string; message: string }]>;
  /** Per-node interrupt kind, mirrored from `suspendedKinds`. */
  suspendedKinds?: Array<[string, string]>;
}

function persistSnapshot(
  storage: Storage,
  runId: string,
  snapshot: SchedulerSnapshot,
  suspendedKinds: Map<string, string>,
): void {
  const ser: SerializedSnapshot = {
    schemaVersion: 1,
    nodeState: [...snapshot.nodeState.entries()].map(([k, v]) => [k, v]),
    nodeOutputs: [...snapshot.nodeOutputs.entries()],
    nodeErrors: [...snapshot.nodeErrors.entries()],
    suspendedKinds: [...suspendedKinds.entries()],
  };
  storage.updateRun(runId, { schedulerSnapshot: JSON.stringify(ser) as never });
}

function hydrateSnapshot(
  definition: WorkflowDefinition,
  ser: SerializedSnapshot,
): SchedulerSnapshot {
  if (ser.schemaVersion !== 1) {
    throw Object.assign(
      new Error(`unsupported scheduler snapshot version: ${(ser as { schemaVersion: number }).schemaVersion}`),
      { code: 'unsupported_snapshot_version' },
    );
  }
  const fresh = freshSnapshot(definition);
  for (const [id, s] of ser.nodeState) fresh.nodeState.set(id, s as never);
  for (const [id, o] of ser.nodeOutputs) fresh.nodeOutputs.set(id, o);
  for (const [id, e] of ser.nodeErrors) fresh.nodeErrors.set(id, e);
  return fresh;
}

/* ─── Secret prep (unchanged from linear executor) ─────────── */

async function prepareRunSecrets(run: RunRecord, definition: WorkflowDefinition): Promise<void> {
  const required = new Map<string, string>();
  for (const node of definition.nodes) {
    const cfgRefs = (node.config?.credentialRefs as string[] | undefined) ?? [];
    for (const ref of cfgRefs) {
      const value = resolveSecret(ref);
      if (value) required.set(ref, value);
    }
  }
  const cfgRefs = (run.configurable?.credentialRefs as string[] | undefined) ?? [];
  for (const ref of cfgRefs) {
    const value = resolveSecret(ref);
    if (value) required.set(ref, value);
    else {
      throw new OpenwopError(
        'credential_unavailable',
        `Required credential ${ref} not resolved by host`,
        400,
        { credentialRef: ref },
      );
    }
  }
  if (required.size > 0) {
    setRunSecrets(run.runId, Object.fromEntries(required));
  }
}
