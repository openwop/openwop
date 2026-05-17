/**
 * Linear node-by-node executor.
 *
 * For each node in the workflow definition, dispatches to the
 * NodeRegistry, threads inputs from the previous node, emits standard
 * lifecycle events to the event log, and pauses on `suspended` outcomes
 * by creating a durable interrupt record.
 *
 * Resume is symmetric: on resolve, the run is dispatched again from
 * the suspended node with the resolved value as input.
 *
 * Sample-grade: linear sequence only (no branching). Real openwop
 * engines model DAGs with channels & reducers. Branching belongs in
 * core.subWorkflow / core.dispatch + an orchestrator pattern.
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
import type { NodeContext, NodeOutcome, WorkflowDefinition } from './types.js';
import type { RunRecord } from '../types.js';
import type { ProviderPolicyResolver } from '../host/index.js';
import { createAiProvidersAdapter, AiProviderError } from '../aiProviders/aiProvidersHost.js';
import { buildHostSurfaceBundle } from '../host/inMemorySurfaces.js';

export interface ExecuteRunResult {
  status: RunRecord['status'];
  /** Index of the node where execution paused, when suspended. */
  pausedAtIndex?: number;
}

/**
 * Emit the canonical terminal-failure event sequence: `node.failed`
 * (when a node was active) → `run.failed` → update run record. Called
 * from every failure path in executeRun so SSE consumers + the streams
 * route's TERMINAL_EVENT_TYPES gate see a consistent event trail.
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

export async function executeRun(
  storage: Storage,
  run: RunRecord,
  definition: WorkflowDefinition,
  options: {
    resumeFromNodeIndex?: number;
    resumeValue?: unknown;
    /** Optional host policy resolver. When absent (legacy callers in
     *  tests / forks), the per-node ctx omits `callAI` and packs that
     *  rely on `aiProviders` fail with `host_capability_missing`. */
    policyResolver?: ProviderPolicyResolver;
  } = {},
): Promise<ExecuteRunResult> {
  const tracer = trace.getTracer('openwop.workflow-engine-sample');
  const registry = getNodeRegistry();
  const eventLog = getEventLog();
  const suspend = getSuspendManager();

  const startIndex = options.resumeFromNodeIndex ?? 0;
  let nodeInputs: unknown = options.resumeValue ?? run.inputs;

  // Emit run.started FIRST so a secret-prep failure produces a
  // visible event trail. Otherwise a missing-ref run sits in
  // `pending` forever with zero events, because the prepareRunSecrets
  // throw is swallowed by the route's `.catch(log.error)`.
  if (startIndex === 0) {
    eventLog.append({ runId: run.runId, type: 'run.started', payload: { workflowId: run.workflowId } });
    storage.updateRun(run.runId, { status: 'running' });
  } else {
    eventLog.append({ runId: run.runId, type: 'run.resumed', payload: { resumedAtNode: definition.nodes[startIndex]?.nodeId } });
    storage.updateRun(run.runId, { status: 'running', currentNodeId: definition.nodes[startIndex]?.nodeId });
  }

  // Resolve all required secrets up-front. Run-level secrets stay in
  // the ephemeral per-run context until clearRunSecrets() at terminal.
  // A failure here is terminal — emit run.failed instead of letting
  // the throw propagate silently.
  try {
    await prepareRunSecrets(run, definition);
  } catch (err) {
    const code = err instanceof OpenwopError ? err.code : 'internal_error';
    const message = err instanceof Error ? err.message : String(err);
    // No active node yet — pass undefined nodeId so we emit run.failed
    // only (skip node.failed). The helper handles this.
    emitTerminalFailure({ storage, runId: run.runId, error: { code, message } });
    return { status: 'failed' };
  }

  for (let i = startIndex; i < definition.nodes.length; i++) {
    const node = definition.nodes[i]!;
    const module = await registry.resolve(node.typeId);
    if (!module) {
      emitTerminalFailure({
        storage,
        runId: run.runId,
        nodeId: node.nodeId,
        error: { code: 'workflow_not_found', message: `node module not registered: ${node.typeId}` },
      });
      return { status: 'failed' };
    }

    // Capability gating per spec/v1/host-capabilities.md §"Refuse on missing".
    if (module.requires) {
      for (const cap of module.requires) {
        if (!hasCapability(cap)) {
          emitTerminalFailure({
            storage,
            runId: run.runId,
            nodeId: node.nodeId,
            error: { code: 'host_capability_missing', message: `capability ${cap} not provided by host` },
          });
          return { status: 'failed' };
        }
      }
    }

    storage.updateRun(run.runId, { currentNodeId: node.nodeId });
    eventLog.append({ runId: run.runId, nodeId: node.nodeId, type: 'node.started', payload: {} });

    // Two views of the secrets map:
    //   - `rawSecrets` (host-side): adapter uses this to look up
    //     credentials by convention (`secrets[provider]`, etc.).
    //   - `secretsForCtx` (pack-side): a Proxy that allows direct
    //     `secrets[ref]` lookup but throws on enumeration, so a
    //     pack can't `JSON.stringify(ctx.secrets)` and exfiltrate
    //     the whole keyring through an output field. Real hosts'
    //     pack sandboxes (RFC 0008) would enforce this at the
    //     module-loader level; the sample uses a Proxy as a
    //     defense-in-depth layer.
    const rawSecrets = getRunSecrets(run.runId);
    const secretsForCtx = nonEnumerableSecretsView(rawSecrets);
    const aiAdapter = options.policyResolver
      ? createAiProvidersAdapter({
          runId: run.runId,
          nodeId: node.nodeId,
          tenantId: run.tenantId,
          ...(run.scopeId ? { scopeId: run.scopeId } : {}),
          attempt: 1,
          secrets: rawSecrets,
          policyResolver: options.policyResolver,
        })
      : null;
    // Host capability bundle — built per-run with the tenant baked in.
    // Demo-grade in-memory adapters (storage/db/fs/queueBus/observability)
    // live in `host/inMemorySurfaces.ts`. Each `ctx.<surface>` here is
    // the same shape Phase-6 real-backend hosts will satisfy.
    const surfaces = buildHostSurfaceBundle({
      tenantId: run.tenantId,
      ...(run.scopeId ? { scopeId: run.scopeId } : {}),
    });

    const ctx: NodeContext = {
      runId: run.runId,
      nodeId: node.nodeId,
      tenantId: run.tenantId,
      scopeId: run.scopeId,
      inputs: nodeInputs,
      config: node.config ?? {},
      configurable: run.configurable ?? {},
      attempt: 1,
      secrets: secretsForCtx,
      async emit(type, payload) {
        eventLog.append({ runId: run.runId, nodeId: node.nodeId, type, payload: stripSecretsFromPersisted(payload) });
      },
      ...(aiAdapter ? { callAI: aiAdapter.callAI, callAIWithTools: aiAdapter.callAIWithTools } : {}),
      storage: surfaces.storage,
      db: surfaces.db,
      fs: surfaces.fs,
      queueBus: surfaces.queueBus,
      observability: surfaces.observability,
    };

    let outcome: NodeOutcome;
    const span = tracer.startSpan(`openwop.node.${node.typeId}`, {
      attributes: {
        'openwop.run_id': run.runId,
        'openwop.node_id': node.nodeId,
        'openwop.node_type': node.typeId,
      },
    });
    try {
      outcome = await module.execute(ctx);
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      // AI-provider failures carry a normalized code from
      // `aiProvidersHost.AiProviderError` per spec §host.aiProviders;
      // preserve that code so callers can react ('provider_policy_denied',
      // 'model_not_supported', 'safety_filter', …) instead of seeing a
      // flattened 'internal_error'.
      const code = err instanceof AiProviderError ? err.code : 'internal_error';
      outcome = { status: 'failure', error: { code, message } };
    } finally {
      span.end();
    }

    if (outcome.status === 'success') {
      eventLog.append({
        runId: run.runId,
        nodeId: node.nodeId,
        type: 'node.completed',
        payload: stripSecretsFromPersisted({ outputs: outcome.outputs }),
      });
      nodeInputs = outcome.outputs;
      continue;
    }

    if (outcome.status === 'failure') {
      emitTerminalFailure({
        storage,
        runId: run.runId,
        nodeId: node.nodeId,
        error: outcome.error,
      });
      return { status: 'failed' };
    }

    // Suspended → create durable interrupt + pause the run.
    const interrupt = suspend.createInterrupt({
      runId: run.runId,
      nodeId: node.nodeId,
      kind: outcome.interrupt.kind,
      data: outcome.interrupt.data,
      resumeSchema: outcome.interrupt.resumeSchema,
    });
    // The interrupt `token` is unauth-resolvable via POST /v1/interrupts/{token}
    // by design — that's how external systems (email links, Slack callbacks)
    // resume runs without an API key. So the token MUST NOT appear in the
    // public event log: SSE consumers, webhook subscribers, and the events
    // poll endpoint would otherwise leak a resolution capability. Authenticated
    // callers fetch the token via GET /v1/host/sample/runs/{id}/interrupts.
    eventLog.append({
      runId: run.runId,
      nodeId: node.nodeId,
      type: 'node.suspended',
      payload: {
        interruptId: interrupt.interruptId,
        kind: interrupt.kind,
      },
    });
    const waitingStatus =
      outcome.interrupt.kind === 'approval'
        ? 'waiting-approval'
        : outcome.interrupt.kind === 'cancellation'
          ? 'paused'
          : 'waiting-input';
    storage.updateRun(run.runId, { status: waitingStatus, currentNodeId: node.nodeId });
    return { status: waitingStatus, pausedAtIndex: i };
  }

  eventLog.append({ runId: run.runId, type: 'run.completed', payload: stripSecretsFromPersisted({ output: nodeInputs }) });
  storage.updateRun(run.runId, { status: 'completed', completedAt: new Date().toISOString() });
  clearRunSecrets(run.runId);
  return { status: 'completed' };
}

async function prepareRunSecrets(run: RunRecord, definition: WorkflowDefinition): Promise<void> {
  const required = new Map<string, string>();
  for (const node of definition.nodes) {
    const cfgRefs = (node.config?.credentialRefs as string[] | undefined) ?? [];
    for (const ref of cfgRefs) {
      const value = resolveSecret(ref);
      if (value) required.set(ref, value);
    }
  }
  // Plus any credentialRefs in run.configurable.
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
