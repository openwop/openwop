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
} from '../byok/ephemeralRunSecrets.js';
import { resolveSecret } from '../byok/secretResolver.js';
import { OpenwopError } from '../types.js';
import type { Storage } from '../storage/storage.js';
import type { NodeContext, NodeOutcome, WorkflowDefinition } from './types.js';
import type { RunRecord } from '../types.js';

export interface ExecuteRunResult {
  status: RunRecord['status'];
  /** Index of the node where execution paused, when suspended. */
  pausedAtIndex?: number;
}

export async function executeRun(
  storage: Storage,
  run: RunRecord,
  definition: WorkflowDefinition,
  options: { resumeFromNodeIndex?: number; resumeValue?: unknown } = {},
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
    const errorPayload = { error: { code, message } };
    eventLog.append({ runId: run.runId, type: 'run.failed', payload: errorPayload });
    storage.updateRun(run.runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: { code, message },
    });
    clearRunSecrets(run.runId);
    return { status: 'failed' };
  }

  for (let i = startIndex; i < definition.nodes.length; i++) {
    const node = definition.nodes[i]!;
    const module = await registry.resolve(node.typeId);
    if (!module) {
      const errCode = 'workflow_not_found';
      eventLog.append({
        runId: run.runId,
        nodeId: node.nodeId,
        type: 'run.failed',
        payload: { error: { code: errCode, message: `node module not registered: ${node.typeId}` } },
      });
      storage.updateRun(run.runId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: { code: errCode, message: `node module not registered: ${node.typeId}` },
      });
      clearRunSecrets(run.runId);
      return { status: 'failed' };
    }

    // Capability gating per spec/v1/host-capabilities.md §"Refuse on missing".
    if (module.requires) {
      for (const cap of module.requires) {
        if (!hasCapability(cap)) {
          eventLog.append({
            runId: run.runId,
            nodeId: node.nodeId,
            type: 'run.failed',
            payload: { error: { code: 'host_capability_missing', capability: cap } },
          });
          storage.updateRun(run.runId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            error: { code: 'host_capability_missing', message: `capability ${cap} not provided by host` },
          });
          clearRunSecrets(run.runId);
          return { status: 'failed' };
        }
      }
    }

    storage.updateRun(run.runId, { currentNodeId: node.nodeId });
    eventLog.append({ runId: run.runId, nodeId: node.nodeId, type: 'node.started', payload: {} });

    const ctx: NodeContext = {
      runId: run.runId,
      nodeId: node.nodeId,
      tenantId: run.tenantId,
      scopeId: run.scopeId,
      inputs: nodeInputs,
      config: node.config ?? {},
      configurable: run.configurable ?? {},
      attempt: 1,
      secrets: getRunSecrets(run.runId),
      async emit(type, payload) {
        eventLog.append({ runId: run.runId, nodeId: node.nodeId, type, payload: stripSecretsFromPersisted(payload) });
      },
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
      outcome = { status: 'failure', error: { code: 'internal_error', message } };
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
      const errorPayload = stripSecretsFromPersisted({ error: outcome.error });
      eventLog.append({
        runId: run.runId,
        nodeId: node.nodeId,
        type: 'node.failed',
        payload: errorPayload,
      });
      // Run-level terminal event — SSE consumers + the streams route's
      // TERMINAL_EVENT_TYPES set both gate on `run.failed`, so without
      // this the stream stays open until heartbeat timeout and any
      // chat-style UI sits on its loading state.
      eventLog.append({
        runId: run.runId,
        type: 'run.failed',
        payload: errorPayload,
      });
      storage.updateRun(run.runId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: outcome.error,
      });
      clearRunSecrets(run.runId);
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
    // callers fetch the token via GET /v1/runs/{id}/interrupts.
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
