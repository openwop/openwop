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

import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';
import { getNodeRegistry } from './nodeRegistry.js';
import { getEventLog } from './eventLog.js';
import { getSuspendManager } from './suspendManager.js';
import { hasCapability } from './runtimeCapabilities.js';
import {
  evaluateModelCapabilityGate,
  buildInsufficientPayload,
  buildSubstitutedPayload,
} from './modelCapabilityGate.js';
import { getModelCapabilityGateConfig } from '../host/modelCapabilityGateConfig.js';
import {
  setRunSecrets,
  getRunSecrets,
  clearRunSecrets,
  stripSecretsFromPersisted,
  nonEnumerableSecretsView,
} from '../byok/ephemeralRunSecrets.js';
import { resolveSecret } from '../byok/secretResolver.js';
import { sanitizeFreeTextDeep } from '../byok/textRedaction.js';
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
import { createAiProvidersAdapter, AiProviderError, type AiProviderErrorCode } from '../aiProviders/aiProvidersHost.js';
import { classifyDispatchError } from '../observability/errorRecovery.js';
import { buildHostSurfaceBundle, writeMemoryEntry, MEMORY_DEMO_REF } from '../host/inMemorySurfaces.js';
import { getInstanceId } from '../host/instanceId.js';
import { notifyRunTerminal } from './runLifecycle.js';
import { emitRunFailureNotification } from '../notifications/notify.js';
import { snapshotRunVariables, setRunVariable } from '../host/variablesRuntime.js';
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
/** RFC 0058 — host wall-clock ceiling per run, in milliseconds. Advertised
 *  as `capabilities.limits.maxRunDurationMs` (`routes/discovery.ts`) and used
 *  as the upper bound when resolving `RunOptions.configurable.runTimeoutMs`
 *  below. MUST equal the advertised value (advertise/enforce must agree). */
export const RUN_DURATION_CEILING_MS = 600_000;

/** Dispatch-lease duration (ms) stamped on a run at execution start. Exceeds the
 *  run-duration ceiling by a buffer so a legitimately long-running run is never
 *  swept; only a crashed instance's run (lease expired past this) is re-claimed. */
export const RUN_DISPATCH_LEASE_MS = RUN_DURATION_CEILING_MS + 120_000;

export async function emitTerminalFailure(input: {
  storage: Storage;
  runId: string;
  nodeId?: string;
  error: { code: string; message: string };
}): Promise<void> {
  const eventLog = getEventLog();
  // Enrich the canonical {code, message} pair with the BE's recovery
  // classifier output so consumers (e.g., the sample chat UI's
  // ErrorCard) can render a user-safe `userMessage` + a recommended
  // `action` without re-classifying on the FE. Additive per
  // `_errorObject` schema (`additionalProperties: true`); old consumers
  // ignore the new fields. See `observability/errorRecovery.ts` for the
  // classifier authoritative source.
  const classified = classifyDispatchError(
    new AiProviderError(input.error.code as AiProviderErrorCode, input.error.message),
  );
  const enrichedError = {
    ...input.error,
    category: classified.category,
    action: classified.action,
    userMessage: classified.userMessage,
    ...(classified.retryAfterMs !== undefined ? { retryAfterMs: classified.retryAfterMs } : {}),
  };
  const errorPayload = stripSecretsFromPersisted({ error: enrichedError });
  if (input.nodeId) {
    await eventLog.append({
      runId: input.runId,
      nodeId: input.nodeId,
      type: 'node.failed',
      payload: errorPayload,
    });
  }
  await eventLog.append({
    runId: input.runId,
    type: 'run.failed',
    payload: errorPayload,
  });
  await input.storage.updateRun(input.runId, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    error: input.error,
  });
  clearRunSecrets(input.runId);
  notifyRunTerminal(input.runId);
  // Fan out a user-visible notification so the bell + /inbox surface
  // the failure without polling. Best-effort — emit failures don't
  // affect the canonical run.failed event log entry. Pass the
  // **classified** userMessage (not raw error.message) so that
  // provider-side strings that occasionally echo BYOK keys never land
  // in the notification message field.
  void emitRunFailureNotification(input.storage, input.runId, {
    code: input.error.code,
    userMessage: classified.userMessage,
  });
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
  nodeRef: { nodeId: string; typeId: string; config?: Record<string, unknown>; inputs?: Record<string, unknown>; agent?: { agentId: string } };
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
    await eventLog.append({
      runId: run.runId,
      nodeId: nodeRef.nodeId,
      type: 'node.failed',
      payload: stripSecretsFromPersisted({ error }),
    });
    return { kind: 'failure', error };
  }

  // Capability gating per spec/v1/host-capabilities.md §"Refuse on missing".
  // Error code per `rest-endpoints.md §"Common error codes"` +
  // `capabilities.md §"Runtime capabilities"`: a node with unsatisfied
  // requires MUST terminate the run with `error.code: 'capability_not_provided'`
  // (the canonical code). Earlier this file used `host_capability_missing`;
  // that's the legacy alias still in OpenwopErrorCode for back-compat.
  if (module.requires) {
    for (const cap of module.requires) {
      if (!hasCapability(cap)) {
        const error = {
          code: 'capability_not_provided',
          message: `capability ${cap} not provided by host`,
        };
        await eventLog.append({
          runId: run.runId,
          nodeId: nodeRef.nodeId,
          type: 'node.failed',
          payload: stripSecretsFromPersisted({ error }),
        });
        return { kind: 'failure', error };
      }
    }
  }

  // RFC 0031 §B model-capability dispatch gate. Parallel surface to the
  // host-capability `requires` check above — `requires` gates on host
  // facilities (per `capabilities.runtimeCapabilities[]`); this gate gates
  // on MODEL capabilities (per `capabilities.modelCapabilities.advertised[]`).
  // Evaluated at execute-time against the host's configured default
  // provider; per-call provider mismatch (a node that calls
  // `ctx.callAI({provider: 'openai', ...})` from a host where the default
  // is 'anthropic') is a future refinement requiring `dispatchPlain()`
  // interception. The sample-grade gate is honest about its scope:
  // `substitutionSupported: false` by default, so the gate refuses on
  // any unmet capability rather than attempting fallback. Operators that
  // wire the interception flip OPENWOP_MODEL_CAPABILITY_SUBSTITUTION=true.
  // Empty `requiredModelCapabilities` (the common case for non-AI nodes)
  // makes the gate a no-op via the early-return inside evaluateModelCapabilityGate.
  if (module.requiredModelCapabilities && module.requiredModelCapabilities.length > 0) {
    const gateConfig = getModelCapabilityGateConfig();
    const gateInput: Parameters<typeof evaluateModelCapabilityGate>[0] = {
      module: {
        ...(module.requiredModelCapabilities !== undefined ? { requiredModelCapabilities: module.requiredModelCapabilities } : {}),
        ...(module.fallbackModel !== undefined ? { fallbackModel: module.fallbackModel } : {}),
      },
      activeProvider: gateConfig.defaultProvider,
      activeModel: gateConfig.defaultModel,
      substitutionSupported: gateConfig.substitutionSupported,
      supportedProviders: gateConfig.supportedProviders,
    };
    const outcome = evaluateModelCapabilityGate(gateInput);
    if (outcome.route === 'substitute') {
      // Emit the substitution event per RFC 0031 §D + §B step 3. The
      // sample's dispatch path does NOT yet honor the fallback at the
      // per-call boundary (operators set OPENWOP_MODEL_CAPABILITY_SUBSTITUTION
      // = true only when they've wired the interception). The event
      // emission is the wire-contract surface; downstream consumers
      // (conformance, replay, observability) read the durable event log
      // regardless of whether the dispatcher physically swapped models.
      await eventLog.append({
        runId: run.runId,
        nodeId: nodeRef.nodeId,
        type: 'model.capability.substituted',
        payload: stripSecretsFromPersisted(buildSubstitutedPayload(outcome, nodeRef.nodeId)),
      });
      // Dispatch proceeds — the node's execute() runs normally.
    } else if (outcome.route === 'refuse') {
      // Emit the insufficient event per RFC 0031 §D + §B step 4 BEFORE
      // failing the node so observability sees the cause-of-refusal
      // ahead of the node.failed event.
      await eventLog.append({
        runId: run.runId,
        nodeId: nodeRef.nodeId,
        type: 'model.capability.insufficient',
        payload: stripSecretsFromPersisted(
          buildInsufficientPayload(outcome, nodeRef.nodeId, gateConfig.defaultProvider, gateConfig.defaultModel),
        ),
      });
      const error = {
        code: 'capability_not_provided',
        message: `model capabilities not satisfied by active provider (${gateConfig.defaultProvider}): missing ${outcome.missingCapabilities.join(', ')}`,
      };
      await eventLog.append({
        runId: run.runId,
        nodeId: nodeRef.nodeId,
        type: 'node.failed',
        payload: stripSecretsFromPersisted({ error }),
      });
      return { kind: 'failure', error };
    }
    // outcome.route === 'dispatch' — gate satisfied; fall through.
  }

  await storage.updateRun(run.runId, { currentNodeId: nodeRef.nodeId });
  await eventLog.append({ runId: run.runId, nodeId: nodeRef.nodeId, type: 'node.started', payload: {} });

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
        // RFC 0026 — let the host emit `provider.usage` into the run
        // event log right after each upstream LLM dispatch. Keeps the
        // event correlated with the same nodeId / runId that brackets
        // it with `node.started` / `node.completed`.
        emit: async (type, payload) => {
          const record = await eventLog.append({
            runId: run.runId,
            nodeId: nodeRef.nodeId,
            type,
            payload: stripSecretsFromPersisted(payload),
          });
          return { eventId: record.eventId, sequence: record.sequence };
        },
      })
    : null;
  const surfaces = buildHostSurfaceBundle({
    tenantId: run.tenantId,
    ...(run.scopeId ? { scopeId: run.scopeId } : {}),
    runId: run.runId,
  });

  // Fixture-shape input resolution. When the workflow definition's
  // `nodes[i].inputs[port]` carries a reference shape (e.g.,
  // `{type: 'variable', variableName: 'X'}`), resolve against the
  // run's variable bag before merging into inputsByPort. Literal
  // values (non-objects, or objects without a `type` discriminator)
  // pass through unchanged. Resolved per-port values override edge-
  // supplied keys on conflict — the fixture-declared input wins.
  const variableBag = snapshotRunVariables(run.runId);
  const resolvedFixtureInputs: Record<string, unknown> = {};
  if (nodeRef.inputs && typeof nodeRef.inputs === 'object') {
    for (const [port, decl] of Object.entries(nodeRef.inputs)) {
      if (decl && typeof decl === 'object' && !Array.isArray(decl)) {
        const ref = decl as { type?: string; variableName?: string; value?: unknown };
        if (ref.type === 'variable' && typeof ref.variableName === 'string') {
          resolvedFixtureInputs[port] = variableBag?.[ref.variableName];
          continue;
        }
        // `'static'` is the canonical schema-compliant tag per
        // `workflow-definition.schema.json §PortValue`. `'literal'` is
        // a back-compat alias accepted by the executor since pre-schema
        // fixtures used it. Both unwrap the `value` field.
        if (ref.type === 'static' || ref.type === 'literal') {
          resolvedFixtureInputs[port] = ref.value;
          continue;
        }
      }
      // Unrecognized shape — treat as literal.
      resolvedFixtureInputs[port] = decl;
    }
  }
  const mergedInputsByPort = { ...inputsByPort, ...resolvedFixtureInputs };

  // Back-compat: many existing node implementations read ctx.inputs as a
  // single payload (e.g., `(ctx.inputs as Record<string,unknown>).prompt`).
  // The DAG scheduler passes a port-map. For source nodes (no incoming
  // edges) we unwrap `inputs.input` back to the original run inputs so
  // legacy nodes that ran in the linear executor continue to read the
  // same shape. For non-source nodes, port-keyed access is the supported
  // path going forward.
  const ctxInputs: unknown =
    Object.keys(mergedInputsByPort).length === 1 && 'input' in mergedInputsByPort
      ? mergedInputsByPort.input
      : mergedInputsByPort;

  const ctx: NodeContext = {
    runId: run.runId,
    nodeId: nodeRef.nodeId,
    tenantId: run.tenantId,
    scopeId: run.scopeId,
    inputs: ctxInputs,
    config: nodeRef.config ?? {},
    ...(nodeRef.agent ? { nodeAgent: nodeRef.agent } : {}),
    configurable: run.configurable ?? {},
    // RFC trigger pack (`core.openwop.triggers`) — run-scoped trigger payload.
    // Captured at run start and identical for every node (replay-safe). A
    // trigger-started run carries its payload in `run.metadata.triggerData`
    // (set by the scheduler / kanban / webhook-subscription paths); a manual or
    // builder-issued run falls back to the run's own `inputs`. Trigger entry
    // nodes read `ctx.triggerData`; all other nodes ignore it.
    triggerData:
      run.metadata && (run.metadata as Record<string, unknown>).triggerData !== undefined
        ? (run.metadata as Record<string, unknown>).triggerData
        : run.inputs,
    attempt: 1,
    // RFC 0020 §D: propagate the run-level trust boundary onto every
    // node ctx. The MCP server mount (routes/mcp.ts) sets
    // run.metadata.trustBoundary='untrusted' on inbound tools/call so
    // workflow nodes that forward content to LLM surfaces can apply
    // the prompt-injection UNTRUSTED-marker convention.
    trustBoundary:
      run.metadata && (run.metadata as Record<string, unknown>).trustBoundary === 'untrusted'
        ? 'untrusted'
        : 'trusted',
    secrets: secretsForCtx,
    async emit(type, payload) {
      const record = await eventLog.append({
        runId: run.runId,
        nodeId: nodeRef.nodeId,
        type,
        payload: stripSecretsFromPersisted(payload),
      });
      // Surface eventId + sequence so nodes can build causationId chains
      // (RFC 0002 §B). Pre-existing void-returning callers ignore.
      return { eventId: record.eventId, sequence: record.sequence };
    },
    ...(aiAdapter ? { callAI: aiAdapter.callAI, callAIWithTools: aiAdapter.callAIWithTools } : {}),
    storage: surfaces.storage,
    db: surfaces.db,
    fs: surfaces.fs,
    queueBus: surfaces.queueBus,
    observability: surfaces.observability,
    a2a: surfaces.a2a,
    kanban: surfaces.kanban,
    knowledge: surfaces.knowledge,
    chat: surfaces.chat,
    canvas: surfaces.canvas,
    webResearch: surfaces.webResearch,
    launchStudio: surfaces.launchStudio,
    // launch-studio keys context on a user + threads step state through a
    // run-scoped variable bag. The sample host maps the principal to the run
    // tenant; the bag is backed by the variables runtime (replay-safe snapshot).
    userId: run.tenantId,
    variables: {
      get: (name: string): unknown => snapshotRunVariables(run.runId)?.[name],
      set: (name: string, value: unknown): void => setRunVariable(run.runId, name, value),
    },
    // RFC 0020 — host-side MCP. The sample host builds its MCP registry
    // declaratively from workflow definitions (see host/mcpServerRegistry.ts),
    // so `expose` is a stable no-op that returns a synthetic handle. Pack
    // delegates from core.openwop.mcp.expose-* call this and chain on
    // outputs.handle; nothing depends on the handle's identity in v1.
    mcp: {
      expose: async (args) => ({
        handle: `mcp:${run.runId}:${nodeRef.nodeId}`,
        kind: typeof args.kind === 'string' ? args.kind : 'tool',
      }),
    },
    // `core.openwop.triggers` webhook-respond node. The sample executor runs
    // asynchronously (no synchronous request still held open), so the host
    // durably records the intended HTTP reply as a run event — retrievable from
    // the event log and consumable by a synchronous webhook ingress. (Without
    // this the pack falls back to surfacing the reply as node outputs.)
    async respondToWebhook(response) {
      await eventLog.append({
        runId: run.runId,
        nodeId: nodeRef.nodeId,
        type: 'host.webhook.response',
        payload: stripSecretsFromPersisted(response),
      });
    },
  };

  let outcome: NodeOutcome;
  // `observability.md §"Node-level attributes"`: `openwop.node_attempt`
  // is a zero-based retry counter. Sample tier doesn't track retries
  // yet (ctx.attempt is the 1-based one-shot stub at line 302); derive
  // the spec-correct zero-based value from it so the two surfaces stay
  // in sync once real retries land — bumping ctx.attempt will move the
  // span attribute up automatically.
  const span = tracer.startSpan(`openwop.node.${nodeRef.typeId}`, {
    attributes: {
      'openwop.run_id': run.runId,
      // `observability.md §"Run-level attributes"` — spans MUST carry
      // `openwop.workflow_id` for run-scoped roll-ups + filtering.
      'openwop.workflow_id': run.workflowId,
      'openwop.node_id': nodeRef.nodeId,
      'openwop.node_type': nodeRef.typeId,
      'openwop.node_attempt': Math.max(0, (ctx.attempt ?? 1) - 1),
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

  // RFC 0041 §B Phase 4 — replay-divergence-at-refusal detection.
  //
  // When the current run is a replay-mode fork AND this node's envelope
  // outcome (refusal vs valid) differs from the source run's outcome at
  // the same nodeId, emit `replay.divergedAtRefusal` and force the node
  // to fail with `error.code: 'replay_diverged_at_refusal'`. Silent
  // substitution of the new envelope for the original is non-conformant
  // per RFC 0041 §B + `spec/v1/multi-agent-execution.md` §"Envelope-
  // refusal recovery in replay".
  //
  // Gated on `OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4=true` — non-
  // Phase-4 hosts MUST NOT emit this event per the schema description on
  // `run-event-payloads.schema.json` §`replayDivergedAtRefusal`.
  const phase4Enabled = process.env.OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4 === 'true';
  const isReplayFork = run.forkMode === 'replay' && typeof run.parentRunId === 'string';

  // Discriminated union — when `diverged: true`, `originalKind` is
  // guaranteed defined. Lets the callers consume `div.originalKind`
  // without non-null assertions.
  type DivergenceResult =
    | { diverged: false }
    | {
        diverged: true;
        originalKind: 'valid' | 'refusal';
        atSequence?: number;
        originalEventId?: string;
      };

  // Per RFC 0041 §B, refusal-divergence applies to LLM-emitting nodes
  // (the only nodes that can carry an "envelope" in the protocol sense).
  // The check below gates on the current node's typeId matching one of
  // the canonical LLM families before treating its source-run completion
  // as evidence of an envelope = valid. Non-LLM nodes never produce an
  // envelope and their `node.completed` events say nothing about
  // envelope shape; including them would create false positives.
  function isLlmNodeTypeId(typeId: string): boolean {
    return /^core\.(ai|llm)\b/.test(typeId);
  }

  async function checkReplayDivergence(replayKind: 'valid' | 'refusal'): Promise<DivergenceResult> {
    if (!phase4Enabled || !isReplayFork || run.parentRunId === undefined) {
      return { diverged: false };
    }
    // Refusal-divergence only applies to LLM-emitting nodes. Non-LLM
    // node types (core.noop, core.script.*, core.subWorkflow, etc.) do
    // not produce envelopes; comparing their `node.completed` events
    // against an envelope-kind would create a false positive.
    if (!isLlmNodeTypeId(nodeRef.typeId)) {
      return { diverged: false };
    }
    // Look up the source run's events at the same nodeId. Two cases:
    //   - source has `envelope.refusal` for nodeId → originalKind = 'refusal'
    //   - source has `node.completed` for nodeId AND this node is an
    //     LLM-family node → originalKind = 'valid' (LLM nodes that
    //     terminate `completed` did so by accepting an envelope per
    //     `core.ai.*` / `core.llm.*` semantics; the `envelope.refusal`
    //     path throws AiProviderError and surfaces as `node.failed`).
    //   - neither → undefined (this LLM node didn't dispatch in the
    //     source run; nothing to compare against; conservative no-divergence).
    try {
      const sourceEvents = await storage.listEvents(run.parentRunId);
      const refusalForNode = sourceEvents.find(
        (e) => e.type === 'envelope.refusal' && e.nodeId === nodeRef.nodeId,
      );
      const completionForNode = sourceEvents.find(
        (e) => e.type === 'node.completed' && e.nodeId === nodeRef.nodeId,
      );
      const sourceKind: 'valid' | 'refusal' | undefined = refusalForNode
        ? 'refusal'
        : completionForNode
          ? 'valid'
          : undefined;
      if (sourceKind === undefined) return { diverged: false }; // can't tell — no envelope event in source
      if (sourceKind === replayKind) return { diverged: false }; // same kind — no divergence
      const sentinel = refusalForNode ?? completionForNode;
      const result: DivergenceResult = {
        diverged: true,
        originalKind: sourceKind,
        ...(sentinel?.sequence !== undefined ? { atSequence: sentinel.sequence } : {}),
        ...(sentinel?.eventId !== undefined ? { originalEventId: sentinel.eventId } : {}),
      };
      return result;
    } catch {
      // Source run not accessible — be conservative and don't emit a
      // divergence event we can't substantiate.
      return { diverged: false };
    }
  }

  if (outcome.status === 'success') {
    // Phase 4: check whether the original run had a refusal at this node.
    // If yes, the replay's success constitutes a divergence (silent
    // substitution direction: original=refusal → replay=valid).
    const div = await checkReplayDivergence('valid');
    if (div.diverged) {
      await eventLog.append({
        runId: run.runId,
        nodeId: nodeRef.nodeId,
        type: 'replay.divergedAtRefusal',
        payload: {
          sourceRunId: run.parentRunId,
          atSequence: div.atSequence ?? 0,
          ...(div.originalEventId ? { originalEventId: div.originalEventId } : {}),
          nodeId: nodeRef.nodeId,
          originalEnvelopeKind: div.originalKind,
          replayEnvelopeKind: 'valid' as const,
        },
      });
      await eventLog.append({
        runId: run.runId,
        nodeId: nodeRef.nodeId,
        type: 'node.failed',
        payload: stripSecretsFromPersisted({
          error: {
            code: 'replay_diverged_at_refusal',
            message: `replay diverged at refusal for node ${nodeRef.nodeId}: original=${div.originalKind}, replay=valid`,
          },
        }),
      });
      return {
        kind: 'failure',
        error: {
          code: 'replay_diverged_at_refusal',
          message: `replay diverged at refusal for node ${nodeRef.nodeId}: original=${div.originalKind}, replay=valid`,
        },
      };
    }
    await eventLog.append({
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
    // Phase 4: when this node failed with `envelope_refusal` AND the
    // original run got a valid envelope at the same nodeId, that's a
    // refusal-divergence. Emit `replay.divergedAtRefusal` + override the
    // error code from `envelope_refusal` to `replay_diverged_at_refusal`.
    if (outcome.error.code === 'envelope_refusal') {
      const div = await checkReplayDivergence('refusal');
      if (div.diverged) {
        await eventLog.append({
          runId: run.runId,
          nodeId: nodeRef.nodeId,
          type: 'replay.divergedAtRefusal',
          payload: {
            sourceRunId: run.parentRunId,
            atSequence: div.atSequence ?? 0,
            ...(div.originalEventId ? { originalEventId: div.originalEventId } : {}),
            nodeId: nodeRef.nodeId,
            originalEnvelopeKind: div.originalKind,
            replayEnvelopeKind: 'refusal' as const,
          },
        });
        const overriddenError = {
          code: 'replay_diverged_at_refusal',
          message: `replay diverged at refusal for node ${nodeRef.nodeId}: original=${div.originalKind}, replay=refusal`,
        };
        await eventLog.append({
          runId: run.runId,
          nodeId: nodeRef.nodeId,
          type: 'node.failed',
          payload: stripSecretsFromPersisted({ error: overriddenError }),
        });
        return { kind: 'failure', error: overriddenError };
      }
    }
    await eventLog.append({
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

export interface ExecuteRunOptions {
  resumeFromNodeIndex?: number;
  /** New-style resume: hydrate the snapshot from these completed nodes. */
  resumeSnapshot?: SerializedSnapshot;
  resumeValue?: unknown;
  /** When resuming, the nodeId whose suspension just resolved. */
  resumeNodeId?: string;
  policyResolver?: ProviderPolicyResolver;
}

export async function executeRun(
  storage: Storage,
  run: RunRecord,
  rawDefinition: WorkflowDefinition,
  options: ExecuteRunOptions = {},
): Promise<ExecuteRunResult> {
  const eventLog = getEventLog();
  const suspend = getSuspendManager();
  const definition = withImplicitEdges(rawDefinition);
  const isResume = options.resumeSnapshot !== undefined || options.resumeFromNodeIndex !== undefined;
  const tracer = trace.getTracer('openwop.workflow-engine-sample');

  if (!isResume) {
    // RFC 0040 / RFC 0083 §C-3: when the run was initiated by an inbound
    // trigger delivery, run.started carries the delivery id as causationId so
    // /ancestry resolves delivery → run. Absent for directly-created runs.
    await eventLog.append({ runId: run.runId, type: 'run.started', payload: { workflowId: run.workflowId }, causationId: run.causationId });
    await storage.updateRun(run.runId, { status: 'running' });
  } else {
    await eventLog.append({
      runId: run.runId,
      type: 'run.resumed',
      payload: { resumedAtNode: options.resumeNodeId ?? null },
    });
    await storage.updateRun(run.runId, { status: 'running' });
  }

  // Multi-instance dispatch lease: claim this run for this instance. The lease
  // outlives the maximum legal runtime (run-duration ceiling + buffer), so an
  // alive run is never re-dispatched; once it expires (the owning instance
  // crashed) the `runDispatchSweeper` re-claims and re-runs the run, which is
  // idempotent against the Layer-2 invocation log. Best-effort — a lease write
  // failure must not abort the run.
  try {
    await storage.setRunDispatchLease(run.runId, getInstanceId(), Date.now() + RUN_DISPATCH_LEASE_MS);
  } catch {
    /* lease is an availability optimization, not a correctness gate */
  }

  // Open the run-lifecycle span per `observability.md §"Span naming"`
  // (`openwop.run` or `openwop.run.<phase>`). Carries every required
  // run-level attribute (`observability.md §"Run-level attributes"`)
  // AND is kept active through `context.with` so node spans created
  // downstream (in `runOneNode`) nest under it — trace viewers see
  // the canonical run → node hierarchy without operator-side stitching.
  const runSpan = tracer.startSpan('openwop.run', {
    attributes: {
      'openwop.run_id': run.runId,
      'openwop.workflow_id': run.workflowId,
      'openwop.protocol_version': '1.1',
      ...(run.tenantId ? { 'openwop.tenant_id': run.tenantId } : {}),
      ...(run.scopeId ? { 'openwop.scope_id': run.scopeId } : {}),
    },
  });
  try {
    return await otelContext.with(
      trace.setSpan(otelContext.active(), runSpan),
      () => executeRunBody({ storage, run, definition, options, eventLog, suspend }),
    );
  } finally {
    runSpan.end();
  }
}

interface ExecuteRunBodyInput {
  storage: Storage;
  run: RunRecord;
  definition: WorkflowDefinition;
  options: ExecuteRunOptions;
  eventLog: ReturnType<typeof getEventLog>;
  suspend: ReturnType<typeof getSuspendManager>;
}

async function executeRunBody(input: ExecuteRunBodyInput): Promise<ExecuteRunResult> {
  const { storage, run, definition, options, eventLog, suspend } = input;
  const isResume = options.resumeSnapshot !== undefined || options.resumeFromNodeIndex !== undefined;
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
    await emitTerminalFailure({ storage, runId: run.runId, error: { code, message } });
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

  // Resume-by-snapshot: mark the resumed node as completed with the
  // resolve value. Emit `node.completed` so consumers tracking
  // per-node progress (FE step list, conformance assertions) see the
  // suspended node tick over from "suspended" → "completed" in the
  // event log. Without this, the FE renders the resumed approval /
  // clarification / refinement row as un-checked forever even after
  // the run completes, because `node.interrupt.resolved` doesn't
  // carry the same semantics (it tells the FE the interrupt is
  // closed, not that the node finished).
  if (options.resumeSnapshot && options.resumeNodeId) {
    // Two-layer redaction at the resume-time persistence boundary:
    //
    //   1. `stripSecretsFromPersisted` strips `__secret:*` reference
    //      tokens (BYOK ephemeral references the executor injects
    //      into node ctx). Structured-payload concern.
    //   2. `sanitizeFreeTextDeep` walks string leaves for
    //      accidentally-pasted upstream API keys. HITL approval
    //      cards carry a free-text `comment` field that users have
    //      pasted into in practice — without this, a paste of
    //      "approved, here's the key sk-... in case" lands the raw
    //      key in the event log.
    //
    // Order matters: `stripSecretsFromPersisted` first (removes
    // ephemeral-secret tokens entirely); `sanitizeFreeTextDeep` second
    // (replaces remaining free-text key shapes in-place).
    const outputs = { output: options.resumeValue };
    snapshot.nodeOutputs.set(options.resumeNodeId, outputs);
    snapshot.nodeState.set(options.resumeNodeId, 'completed');
    await eventLog.append({
      runId: run.runId,
      nodeId: options.resumeNodeId,
      type: 'node.completed',
      payload: sanitizeFreeTextDeep(stripSecretsFromPersisted({ outputs })),
    });
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
      await emitTerminalFailure({ storage, runId: run.runId, error: { code, message } });
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
  /** Per `run-options.md §recursionLimit` + `observability.md §cap.breached`:
   *  count node executions; emit `cap.breached {kind: 'node-executions'}`
   *  + transition the run to `failed` with `error.code:
   *  'recursion_limit_exceeded'` when configured cap is exceeded. The cap
   *  is `run.configurable.recursionLimit` (per spec) or `unset`/0/negative
   *  → no cap. */
  let nodeExecutionCount = 0;
  const recursionLimitRaw = (run.configurable as Record<string, unknown> | undefined)?.recursionLimit;
  const recursionLimit = typeof recursionLimitRaw === 'number' && recursionLimitRaw > 0
    ? recursionLimitRaw
    : Number.POSITIVE_INFINITY;

  /** Per RFC 0058 — wall-clock run bound. The effective deadline is
   *  `min(configurable.runTimeoutMs, host ceiling)`; the host ceiling always
   *  applies once advertised (`run-options.md §runTimeoutMs`: "Absent ⇒ only
   *  the host ceiling applies"). Measured from drain start ≈ `run.started`;
   *  time a run spends suspended for human input does not count against it
   *  (the clock is re-anchored when the executor re-enters on resume). On
   *  breach we emit `cap.breached {kind:'run-duration'}` then `run.failed`
   *  with `error.code:'run_timeout'`, mirroring the node-executions path. */
  const runTimeoutRaw = (run.configurable as Record<string, unknown> | undefined)?.runTimeoutMs;
  const requestedTimeoutMs = typeof runTimeoutRaw === 'number' && runTimeoutRaw > 0 ? runTimeoutRaw : undefined;
  const effectiveTimeoutMs = requestedTimeoutMs !== undefined
    ? Math.min(requestedTimeoutMs, RUN_DURATION_CEILING_MS)
    : RUN_DURATION_CEILING_MS;
  const runStartMs = Date.now();
  const runDeadlineAt = runStartMs + effectiveTimeoutMs;
  const breachRunDuration = async (): Promise<ExecuteRunResult> => {
    const observed = Date.now() - runStartMs;
    // Per RFC 0058 §C the breach event PRECEDES run.failed (same ordering the
    // node-executions breach relies on). `limit` = resolved ms, `observed` =
    // elapsed ms; both recorded so replay/:fork reuse them verbatim.
    await eventLog.append({
      runId: run.runId,
      type: 'cap.breached',
      payload: { kind: 'run-duration', limit: effectiveTimeoutMs, observed },
    });
    await emitTerminalFailure({
      storage,
      runId: run.runId,
      error: {
        code: 'run_timeout',
        message: `Run exceeded effective runTimeoutMs=${effectiveTimeoutMs}ms (elapsed ${observed}ms).`,
      },
    });
    return { status: 'failed' };
  };

  function launch(nodeId: string): void {
    const nodeRef = nodeById.get(nodeId);
    const task = (async () => {
      if (!nodeRef) {
        markFailed(nodeId, { code: 'internal_error', message: `node ${nodeId} not in definition` }, snapshot);
        return;
      }
      // Cap check BEFORE execution. The +1 is "this attempt would be
      // execution #N+1." Spec wants the breach event to PRECEDE
      // run.failed (per `cap-breach` conformance assertion).
      if (nodeExecutionCount + 1 > recursionLimit) {
        await eventLog.append({
          runId: run.runId,
          nodeId,
          type: 'cap.breached',
          payload: {
            kind: 'node-executions',
            // Per `run-event-payloads.schema.json §capBreached.nodeId`:
            // duplicate nodeId in the payload so consumers reading the
            // event log JSON don't have to cross-reference the
            // RunEventDoc envelope's nodeId field.
            nodeId,
            limit: recursionLimit,
            observed: nodeExecutionCount + 1,
          },
        });
        markFailed(nodeId, {
          code: 'recursion_limit_exceeded',
          message: `Run exceeded configurable.recursionLimit=${recursionLimit} at node '${nodeId}'.`,
        }, snapshot);
        return;
      }
      nodeExecutionCount++;
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
        const interrupt = await suspend.createInterrupt({
          runId: run.runId,
          nodeId,
          kind: out.interrupt.kind,
          data: out.interrupt.data,
          resumeSchema: out.interrupt.resumeSchema,
        });
        await eventLog.append({
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
    // RFC 0058 — trip the wall-clock bound before scheduling more work.
    if (Date.now() >= runDeadlineAt) return await breachRunDuration();

    const slots = Math.max(0, maxConcurrency - inflight.size);
    const batch = slots > 0 ? popReady(slots, snapshot) : [];

    if (batch.length === 0 && inflight.size === 0) {
      const disp = inspectDisposition(snapshot, graph, 0);
      if (disp.done) {
        return await finalizeRun({
          storage, run, snapshot, graph, definition, disposition: disp, suspendedKinds,
        });
      }
      await emitTerminalFailure({
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
      // set by the time we re-enter the loop). RFC 0058: race that wait
      // against the remaining deadline so a single long-running node can't
      // blow past the wall-clock bound unbounded.
      const remaining = Math.max(0, runDeadlineAt - Date.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadlineHit = new Promise<true>((resolve) => {
        timer = setTimeout(() => resolve(true), remaining);
      });
      const settled = Promise.race(inflight).then(() => false as const);
      const timedOut = await Promise.race([settled, deadlineHit]);
      if (timer) clearTimeout(timer);
      if (timedOut) return await breachRunDuration();
      continue;
    }

    for (const nodeId of batch) launch(nodeId);
  }
}

async function finalizeRun(input: {
  storage: Storage;
  run: RunRecord;
  snapshot: SchedulerSnapshot;
  graph: SchedulerGraph;
  definition: WorkflowDefinition;
  disposition: ReturnType<typeof inspectDisposition>;
  suspendedKinds: Map<string, string>;
}): Promise<ExecuteRunResult> {
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
    await eventLog.append({
      runId: run.runId,
      type: 'run.completed',
      payload: stripSecretsFromPersisted({ output }),
    });
    await storage.updateRun(run.runId, { status: 'completed', completedAt: new Date().toISOString() });
    // RFC 0004 demo: the host writes a run-summary to the tenant's memory on
    // completion (the "session-end write" the spec sanctions). Best-effort —
    // a memory write must never fail the run.
    //
    // RFC 0057 §D (replay determinism): skip this on a `replay`-mode fork.
    // Re-executing a recorded run MUST NOT mint a new `memoryId` or re-emit
    // `memory.written` — the original run's event is the canonical recorded
    // fact. `branch`-mode forks are genuinely new runs and legitimately write
    // (and attribute) their own memory.
    if (run.forkMode !== 'replay') {
    try {
      const preview = JSON.stringify(output ?? null);
      const summaryTags = ['run-summary', `run-id:${run.runId}`, `workflow:${run.workflowId}`];
      const summaryRow = writeMemoryEntry(run.tenantId, MEMORY_DEMO_REF, {
        content:
          `Run ${run.runId} of "${run.workflowId}" completed` +
          (preview && preview !== 'null' ? ` → ${preview.slice(0, 280)}` : '.'),
        tags: summaryTags,
      });
      // RFC 0057 — attribute the write on the event log (content-free:
      // identifiers + non-secret tags only; never the entry content). This is
      // a host session-end write, so `nodeId` is omitted per RFC 0057 §B. The
      // host advertises capabilities.memory.attribution.emitsWriteEvents.
      await eventLog.append({
        runId: run.runId,
        type: 'memory.written',
        payload: { memoryRef: MEMORY_DEMO_REF, memoryId: summaryRow.id, tags: summaryTags },
      });
    } catch {
      /* memory is a demo surface; never block run completion */
    }
    }
    clearRunSecrets(run.runId);
    notifyRunTerminal(run.runId);
    return { status: 'completed' };
  }
  if (disposition.status === 'failed') {
    const err = snapshot.nodeErrors.get(disposition.failedNodeId!) ?? {
      code: 'internal_error',
      message: 'unknown node failure',
    };
    await emitTerminalFailure({ storage, runId: run.runId, error: err });
    return { status: 'failed' };
  }
  // Waiting on suspended branch(es).
  const suspendedIds = [...snapshot.nodeState.entries()]
    .filter(([, s]) => s === 'suspended')
    .map(([id]) => id);
  const firstSuspended = disposition.suspendedNodeId ?? suspendedIds[0]!;
  const interruptKind = inferWaitingKind(firstSuspended, suspendedKinds);
  await storage.updateRun(run.runId, { status: interruptKind, currentNodeId: firstSuspended });
  // Persist scheduler snapshot for resume.
  await persistSnapshot(storage, run.runId, snapshot, suspendedKinds);
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
  if (kind === 'external-event') return 'waiting-external';
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

async function persistSnapshot(
  storage: Storage,
  runId: string,
  snapshot: SchedulerSnapshot,
  suspendedKinds: Map<string, string>,
): Promise<void> {
  const ser: SerializedSnapshot = {
    schemaVersion: 1,
    nodeState: [...snapshot.nodeState.entries()].map(([k, v]) => [k, v]),
    nodeOutputs: [...snapshot.nodeOutputs.entries()],
    nodeErrors: [...snapshot.nodeErrors.entries()],
    suspendedKinds: [...suspendedKinds.entries()],
  };
  await storage.updateRun(runId, { schedulerSnapshot: JSON.stringify(ser) as never });
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
  // In OPENWOP_BYOK_EPHEMERAL=true mode the resolver needs the run's
  // tenant so it can find the right per-session bucket. Anon runs get
  // a session-derived tenant id ('anon:<sid>'); bearer-authed runs
  // pass the bearer's body.tenantId (still global in non-ephemeral
  // mode).
  const scope = { tenantId: run.tenantId };
  const required = new Map<string, string>();
  for (const node of definition.nodes) {
    const cfgRefs = (node.config?.credentialRefs as string[] | undefined) ?? [];
    for (const ref of cfgRefs) {
      const value = await resolveSecret(ref, scope);
      if (value) required.set(ref, value);
    }
  }
  const cfgRefs = (run.configurable?.credentialRefs as string[] | undefined) ?? [];
  for (const ref of cfgRefs) {
    // Managed credential refs (`managed:*`) are sentinels for the
    // server-held-key path in providers/managedProvider.ts — the node
    // (chat-responder / aiProvidersHost) detects the prefix and routes
    // dispatch through a different pipeline that owns its own
    // credential lookup, sign-in gating, and daily cap enforcement.
    // The resolver doesn't know about these refs (they live in the
    // shared byok_secrets table, not the per-tenant byok_tenant_secrets),
    // so skip resolution entirely. Authority for "is this actually
    // usable?" stays with the managed-dispatch path, which surfaces
    // `managed_unavailable` / `sign_in_required` / `daily_limit_reached`
    // at call time.
    if (ref.startsWith('managed:')) continue;
    const value = await resolveSecret(ref, scope);
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
