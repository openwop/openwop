/**
 * NodeModule registration. One-shot at boot.
 *
 * Registers the minimal set of `core.*` node types the sample executor
 * dispatches inline + the demo pack's `local.sample.demo.uppercase`.
 *
 * Sample-grade — no MCP, no AI providers (those would require external
 * accounts). Real deployers wire `core.openwop.ai`, `core.openwop.mcp`,
 * `core.openwop.http` from the published packs.
 */

import { getNodeRegistry } from '../executor/nodeRegistry.js';
import type { NodeContext, NodeModule } from '../executor/types.js';
import { emitCost } from '../observability/costEmitter.js';
import { composePromptTemplate } from '../host/promptCompose.js';
import { resolvePromptRef, type PromptKind } from '../host/promptResolve.js';
import { getTemplate } from '../host/promptStore.js';
import { getPromptsHostConfig } from '../host/promptHostConfig.js';
import { dispatchChat, type ChatMessage, type DispatchResult, type ProviderId } from '../providers/dispatch.js';
import { dispatchAnthropicWithTools, type ToolDef } from '../providers/dispatchAnthropicTools.js';
import { dispatchMiniMaxWithTools } from '../providers/dispatchMiniMaxTools.js';
import { getDefaultModel } from '../providers/catalog.js';
import {
  dispatchManagedChat,
  isManagedCredentialRef,
  managedProviderIdFromRef,
  ManagedProviderError,
  type ManagedDispatchResult,
} from '../providers/managedProvider.js';
import {
  buildRefusalPayload,
  buildTruncatedPayload,
} from '../host/envelopeReliabilityEmit.js';
import { dispatchSubRun, type SubRunResult } from '../subruns/subRunDispatcher.js';
import { registerMockAgentNode } from './conformanceMockAgent.js';
import { storeMediaAsset, writeMemoryEntry, MEMORY_DEMO_REF } from '../host/inMemorySurfaces.js';

const noopNode: NodeModule = {
  typeId: 'core.noop',
  version: '1.0.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    return { status: 'success', outputs: { ...inputs } };
  },
};

/** Identity passthrough — copies every input port to a same-named
 *  output port. Used by `conformance-identity` to assert that
 *  `inputs.{var}` from POST /v1/runs round-trips to
 *  `RunSnapshot.variables.{var}`. The output→variable plumbing
 *  happens in the executor; this node's only job is to be present so
 *  the run reaches terminal `completed`. Behaviorally indistinguishable
 *  from `core.noop` today; preserved as a distinct typeId because the
 *  fixture catalog (and conformance/fixtures.md) names it explicitly. */
const identityNode: NodeModule = {
  typeId: 'core.identity',
  version: '1.0.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    return { status: 'success', outputs: { ...inputs } };
  },
};

/** RFC 0022 §A — `core.orchestrator.supervisor` (conformance-mock form).
 *  Reads `mockDispatchPlan` from config (an ordered list of
 *  OrchestratorDecision records) and emits the entire plan as
 *  `outputs.decisions[]`. The downstream `core.dispatch` node consumes
 *  the plan and drives the per-decision dispatch loop internally.
 *
 *  The fixture-catalog hosts this supervisor at the head of a 2-node
 *  supervisor → dispatch → supervisor cycle. The back-edge from
 *  dispatch back to supervisor is detected + dropped by
 *  scheduler.ts findBackEdges() — the cycle is documentation-only;
 *  dispatch loops over the decisions internally without re-firing
 *  the supervisor in the DAG. Real (non-mock) supervisors would emit
 *  one decision per invocation; future spec work (RFC 0022 §"Unresolved
 *  questions" #6) will normate that contract. */
const orchestratorSupervisorNode: NodeModule = {
  typeId: 'core.orchestrator.supervisor',
  version: '1.0.0',
  async execute(ctx) {
    const cfg = (ctx.config ?? {}) as { mockDispatchPlan?: unknown; agentId?: unknown };
    // Default plan when no mockDispatchPlan is configured: a single
    // pass through the dispatch loop (one no-op next-worker decision +
    // terminate). Lets the `conformance-dispatch-loop` fixture
    // exercise the supervisor→dispatch round-trip without a fixture-
    // declared plan. Fixtures that want richer behavior (specific
    // child workflow ids, multi-pass dispatching) carry the plan
    // explicitly in their config.
    const plan = Array.isArray(cfg.mockDispatchPlan) && cfg.mockDispatchPlan.length > 0
      ? cfg.mockDispatchPlan
      : [
          { kind: 'next-worker', nextWorkerIds: [] },
          { kind: 'terminate', reason: 'goal-reached' },
        ];
    // RFC 0006 §B + `runOrchestratorDecided` schema requires `agentId` on
    // every emission. The supervisor's agent identity is either declared
    // explicitly via `config.agentId` (fixtures may pin a specific identity
    // for cross-host parity tests) or synthesized deterministically from
    // the supervisor's nodeId so a single run's supervisor identity stays
    // stable across all decisions. Falls back to `'supervisor-<nodeId>'`
    // when no explicit identity is given.
    const agentIdRaw = typeof cfg.agentId === 'string' && cfg.agentId.length >= 3 ? cfg.agentId : undefined;
    const agentId = agentIdRaw ?? `supervisor-${ctx.nodeId}`;
    return { status: 'success', outputs: { decisions: plan, agentId } };
  },
};

/** RFC 0022 §A + RFC 0007 §D — `core.dispatch`.
 *  Consumes an OrchestratorDecision sequence (from the upstream
 *  supervisor's `decisions` output) and drives the dispatch loop
 *  internally: for each `next-worker` decision spawn the named
 *  child workflow via the subWorkflow dispatcher with inputMapping/
 *  outputMapping applied; for `terminate` break the loop. Each spawn
 *  emits a `node.dispatched` event carrying `childRunId` +
 *  `childWorkflowId` so the conformance suite can locate spawned
 *  children via the parent's event log.
 *
 *  Capability gating: `inputMapping` / `outputMapping` keys are only
 *  honored when `capabilities.agents.dispatchMapping` is advertised
 *  (validated at workflow registration via routes/workflows.ts
 *  §checkMappingCapability); the runtime side here trusts that the
 *  registration check already refused non-conformant workflows. */
const dispatchNode: NodeModule = {
  typeId: 'core.dispatch',
  version: '1.0.0',
  async execute(ctx) {
    const cfg = (ctx.config ?? {}) as {
      inputMapping?: unknown;
      outputMapping?: unknown;
      perWorkerInputMappings?: unknown;
      perWorkerOutputMappings?: unknown;
      fanOutPolicy?: unknown;
    };
    const defaultInputMapping = (cfg.inputMapping && typeof cfg.inputMapping === 'object' && !Array.isArray(cfg.inputMapping))
      ? (cfg.inputMapping as Record<string, string>)
      : undefined;
    const defaultOutputMapping = (cfg.outputMapping && typeof cfg.outputMapping === 'object' && !Array.isArray(cfg.outputMapping))
      ? (cfg.outputMapping as Record<string, string>)
      : undefined;
    // RFC 0022 §D — per-worker overrides (keyed by child workflowId).
    // Used by `dispatch-cross-worker-handoff` to direct different
    // mappings at child-a vs child-b in the same parent run.
    const perWorkerInputMappings = (cfg.perWorkerInputMappings && typeof cfg.perWorkerInputMappings === 'object' && !Array.isArray(cfg.perWorkerInputMappings))
      ? (cfg.perWorkerInputMappings as Record<string, Record<string, string>>)
      : undefined;
    const perWorkerOutputMappings = (cfg.perWorkerOutputMappings && typeof cfg.perWorkerOutputMappings === 'object' && !Array.isArray(cfg.perWorkerOutputMappings))
      ? (cfg.perWorkerOutputMappings as Record<string, Record<string, string>>)
      : undefined;

    // Pull the supervisor's decisions list off ctx.inputs. The executor
    // unwraps a single-port `{input: X}` to X for back-compat with the
    // legacy linear executor (executor.ts:271). Accept both shapes.
    const rawInputs = (ctx.inputs && typeof ctx.inputs === 'object' && !Array.isArray(ctx.inputs))
      ? (ctx.inputs as Record<string, unknown>)
      : {};
    const supervisorPayload = (rawInputs.input && typeof rawInputs.input === 'object')
      ? (rawInputs.input as Record<string, unknown>)
      : rawInputs;
    const decisions = Array.isArray(supervisorPayload.decisions) ? (supervisorPayload.decisions as Array<Record<string, unknown>>) : [];
    // RFC 0006 §B + `runOrchestratorDecided` schema — the supervisor's
    // agent identity threads into every emitted `runOrchestrator.decided`
    // event. Read from the supervisor's output (preferred); fall back to a
    // run-scoped synthetic id when the supervisor didn't emit one (back-
    // compat with pre-RFC-0006 supervisor fixtures).
    const supervisorAgentId = typeof supervisorPayload.agentId === 'string' && supervisorPayload.agentId.length >= 3
      ? supervisorPayload.agentId
      : `orchestrator-${ctx.runId}`;

    if (decisions.length === 0) {
      return { status: 'failure', error: { code: 'invalid_request', message: 'core.dispatch requires supervisor `decisions` input' } };
    }

    const { dispatchSubWorkflow, DispatchCreationError } = await import('../executor/subWorkflowDispatcher.js');
    const { getEventLog } = await import('../executor/eventLog.js');
    const eventLog = getEventLog();

    // RFC 0037 Phase 1 — emit `core.workflowChain.event` transition records
    // alongside the existing `node.dispatched` event when the host opts in
    // via `OPENWOP_MULTI_AGENT_EXECUTION_MODEL=true`. The flag must agree
    // with the discovery doc's advertisement (`routes/discovery.ts`); the
    // RFC's normative wire contract is "do not emit unless advertised."
    const multiAgentEnabled = process.env.OPENWOP_MULTI_AGENT_EXECUTION_MODEL === 'true';
    // RFC 0039 §A — Phase 2 confidence-floor escalation. When the host
    // advertises capabilities.multiAgent.executionModel.version >= 2 (signaled
    // here by the OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_2=true env-flag
    // alongside the version: 2 advertisement in routes/discovery.ts), every
    // decision with a stated `confidence` below the floor MUST escalate via
    // clarify-or-escalate interrupt before any dispatch.began event fires
    // for the named worker. The spec floor is 0.5 (max-entropy threshold);
    // operator-stricter policy comes from `confidenceEscalationFloor`.
    const multiAgentPhase2Enabled = process.env.OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_2 === 'true';
    const confidenceFloor = (() => {
      const raw = process.env.OPENWOP_MULTI_AGENT_CONFIDENCE_FLOOR;
      const parsed = raw === undefined ? 0.5 : Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 1.0) return 0.5;
      return parsed;
    })();
    const hasOutputMapping = (childWorkflowId: string): boolean => {
      const m = perWorkerOutputMappings?.[childWorkflowId] ?? defaultOutputMapping;
      return !!m && Object.keys(m).length > 0;
    };

    const dispatchedChildren: Array<{ childRunId: string; childWorkflowId: string; childStatus: string }> = [];
    let terminateReason: string | null = null;

    for (const decision of decisions) {
      const kind = decision.kind;
      // RFC 0007 §D / `run-orchestrator-decided-event.schema.json` —
      // surface each consumed decision on the event log so observers
      // (and the conformance dispatch-loop test) can see the loop's
      // decision sequence.
      const decidedRec = await eventLog.append({
        runId: ctx.runId,
        nodeId: ctx.nodeId,
        type: 'runOrchestrator.decided',
        payload: { agentId: supervisorAgentId, decision },
      });
      // RFC 0039 §A — confidence-floor escalation. Apply ONLY when Phase 2 is
      // advertised AND the decision carries an explicit confidence value. A
      // missing confidence means "no opinion stated" — NOT low confidence —
      // and MUST NOT trigger escalation. Decision kinds `next-worker` and
      // `terminate` are both eligible; `clarify` / `escalate` already are the
      // escalation themselves and don't double-escalate.
      const confidenceRaw = (decision as { confidence?: unknown }).confidence;
      const confidenceNumber = typeof confidenceRaw === 'number' ? confidenceRaw : undefined;
      const isEligibleKind = kind === 'next-worker' || kind === 'terminate';
      if (multiAgentPhase2Enabled && multiAgentEnabled && isEligibleKind &&
          confidenceNumber !== undefined && confidenceNumber < confidenceFloor) {
        // Per coreWorkflowChainConfidenceEscalated schema: workerId is OPTIONAL
        // and OMITTED for terminate-kind escalations (no worker to name).
        // Present + non-empty for next-worker-kind.
        const workerIdHint = kind === 'next-worker' && Array.isArray(decision.nextWorkerIds)
          ? String(decision.nextWorkerIds[0] ?? '')
          : '';
        await eventLog.append({
          runId: ctx.runId,
          nodeId: ctx.nodeId,
          type: 'core.workflowChain.confidence-escalated',
          causationId: decidedRec.eventId,
          payload: {
            confidence: confidenceNumber,
            floor: confidenceFloor,
            escalationKind: 'clarify',
            parentRunId: ctx.runId,
            ...(workerIdHint.length > 0 ? { workerId: workerIdHint } : {}),
            originalDecision: decision,
          },
        });
        // Suspend the parent with a clarification interrupt. The interrupt
        // surface carries the decision + floor so the operator can confirm,
        // adjust, or cancel.
        return {
          status: 'suspended',
          interrupt: {
            kind: 'clarification',
            data: {
              reason: 'confidence-floor-breached',
              confidence: confidenceNumber,
              floor: confidenceFloor,
              originalDecision: decision,
            },
          },
        };
      }
      if (kind === 'terminate') {
        terminateReason = typeof decision.reason === 'string' ? decision.reason : 'terminate';
        break;
      }
      if (kind !== 'next-worker') continue; // ignore unknown kinds for forward-compat
      const nextWorkerIds = Array.isArray(decision.nextWorkerIds) ? (decision.nextWorkerIds as string[]) : [];
      for (const childWorkflowId of nextWorkerIds) {
        if (typeof childWorkflowId !== 'string' || childWorkflowId.length === 0) continue;
        const inputMapping = perWorkerInputMappings?.[childWorkflowId] ?? defaultInputMapping;
        const outputMapping = perWorkerOutputMappings?.[childWorkflowId] ?? defaultOutputMapping;

        // RFC 0037 §"Handoff state machine" — transition 1/7: pending → dispatching.
        // Chains causationId back to the runOrchestrator.decided that named this worker.
        let dispatchBeganId: string | undefined;
        if (multiAgentEnabled) {
          const beganRec = await eventLog.append({
            runId: ctx.runId,
            nodeId: ctx.nodeId,
            type: 'core.workflowChain.event',
            causationId: decidedRec.eventId,
            payload: { phase: 'dispatch.began', workerId: childWorkflowId, parentRunId: ctx.runId },
          });
          dispatchBeganId = beganRec.eventId;
        }

        try {
          const result = await dispatchSubWorkflow({
            parentRunId: ctx.runId,
            parentTenantId: ctx.tenantId,
            ...(ctx.scopeId ? { parentScopeId: ctx.scopeId } : {}),
            parentNodeId: ctx.nodeId,
            childWorkflowId,
            ...(inputMapping ? { inputMapping } : {}),
            ...(outputMapping ? { outputMapping } : {}),
            onChildFailure: 'continue', // dispatch loop doesn't fail-parent on a single worker miss
          });
          // RFC 0007 §D — emit `node.dispatched` for each spawned child
          // so the parent event log carries the linkage. The conformance
          // suite reads this event to locate the child run id.
          await eventLog.append({
            runId: ctx.runId,
            nodeId: ctx.nodeId,
            type: 'node.dispatched',
            payload: { childRunId: result.childRunId, childWorkflowId, childStatus: result.childStatus },
          });
          dispatchedChildren.push({ childRunId: result.childRunId, childWorkflowId, childStatus: result.childStatus });

          // RFC 0037 — transitions 2..N: dispatching → running → terminal → (harvested?).
          if (multiAgentEnabled) {
            // Transition 2/7: dispatching → running. (Phase 1 collapses
            // "dispatching" and "running" — dispatchSubWorkflow blocks until
            // terminal — so dispatch.succeeded fires after the child has
            // already terminated. The state-machine semantics still hold:
            // a `dispatch.succeeded` event always precedes the child.*
            // event in the log.)
            const succeededRec = await eventLog.append({
              runId: ctx.runId,
              nodeId: ctx.nodeId,
              type: 'core.workflowChain.event',
              ...(dispatchBeganId ? { causationId: dispatchBeganId } : {}),
              payload: {
                phase: 'dispatch.succeeded',
                workerId: childWorkflowId,
                parentRunId: ctx.runId,
                childRunId: result.childRunId,
              },
            });

            // Transitions 3-5 (one fires): child.completed / child.failed / child.cancelled.
            // Per RFC 0037 §"Handoff state machine" the `running → failed` row covers
            // both terminal-failed and exception-during-run. dispatchSubWorkflow surfaces
            // the exception case via `result.childRuntimeError` (status: failed + error
            // envelope captured); we attach it to the child.failed event's payload.error.
            const terminalPhase =
              result.childStatus === 'completed' ? 'child.completed' :
              result.childStatus === 'failed'    ? 'child.failed'    :
              result.childStatus === 'cancelled' ? 'child.cancelled' :
              null;
            let terminalEventId: string | undefined;
            if (terminalPhase) {
              const termRec = await eventLog.append({
                runId: ctx.runId,
                nodeId: ctx.nodeId,
                type: 'core.workflowChain.event',
                causationId: succeededRec.eventId,
                payload: {
                  phase: terminalPhase,
                  workerId: childWorkflowId,
                  parentRunId: ctx.runId,
                  childRunId: result.childRunId,
                  ...(terminalPhase === 'child.failed' && result.childRuntimeError
                    ? { error: result.childRuntimeError }
                    : {}),
                },
              });
              terminalEventId = termRec.eventId;
            }

            // Transition 6/7 — output.harvested fires ONLY when child terminated
            // `completed` AND outputMapping is non-empty (per RFC 0022 §B + RFC 0037
            // §"Handoff state machine" terminal-row constraint).
            if (terminalPhase === 'child.completed' && hasOutputMapping(childWorkflowId) && terminalEventId) {
              const harvestedKeys = Object.keys(perWorkerOutputMappings?.[childWorkflowId] ?? defaultOutputMapping ?? {});
              await eventLog.append({
                runId: ctx.runId,
                nodeId: ctx.nodeId,
                type: 'core.workflowChain.event',
                causationId: terminalEventId,
                payload: {
                  phase: 'output.harvested',
                  workerId: childWorkflowId,
                  parentRunId: ctx.runId,
                  childRunId: result.childRunId,
                  harvestedKeys,
                },
              });
            }
          }
        } catch (err) {
          // Transition 7/7: dispatching → failed (creation failed BEFORE the
          // child ran any node) — per RFC 0037 §"Handoff state machine" this
          // path is reserved for pre-creation failures. dispatchSubWorkflow
          // surfaces those as DispatchCreationError; any OTHER exception class
          // here would be a bug (the dispatcher catches runtime errors
          // internally and converts them to childStatus: 'failed' + result.
          // childRuntimeError). Defensive: if a non-DispatchCreationError
          // reaches us we still emit dispatch.failed but flag the code as
          // unexpected so the failure surfaces in logs.
          if (multiAgentEnabled) {
            const isCreationFailure = err instanceof DispatchCreationError;
            const errorCode = isCreationFailure
              ? (err as InstanceType<typeof DispatchCreationError>).code
              : 'dispatch_unexpected_error';
            await eventLog.append({
              runId: ctx.runId,
              nodeId: ctx.nodeId,
              type: 'core.workflowChain.event',
              ...(dispatchBeganId ? { causationId: dispatchBeganId } : {}),
              payload: {
                phase: 'dispatch.failed',
                workerId: childWorkflowId,
                parentRunId: ctx.runId,
                error: { code: errorCode, message: err instanceof Error ? err.message : String(err) },
              },
            });
          }
          return {
            status: 'failure',
            error: { code: 'internal_error', message: err instanceof Error ? err.message : String(err) },
          };
        }
      }
    }

    return {
      status: 'success',
      outputs: {
        dispatched: dispatchedChildren,
        terminated: terminateReason !== null,
        ...(terminateReason !== null ? { reason: terminateReason } : {}),
      },
    };
  },
};

/** RFC 0022 §A+§B — sub-workflow dispatch primitive. Spawns a child
 *  run, applies inputMapping at dispatch + outputMapping on terminal,
 *  returns childRunId + childStatus. The actual spawn-and-wait logic
 *  lives in `executor/subWorkflowDispatcher.ts` so the node module
 *  doesn't need direct access to RunRecord storage. */
const subWorkflowNode: NodeModule = {
  typeId: 'core.subWorkflow',
  version: '1.0.0',
  async execute(ctx) {
    const cfg = (ctx.config ?? {}) as {
      workflowId?: unknown;
      inputMapping?: unknown;
      outputMapping?: unknown;
      waitForCompletion?: unknown;
      onChildFailure?: unknown;
    };
    const childWorkflowId = typeof cfg.workflowId === 'string' ? cfg.workflowId : '';
    if (!childWorkflowId) {
      return { status: 'failure', error: { code: 'invalid_request', message: 'core.subWorkflow requires config.workflowId' } };
    }
    const inputMapping = (cfg.inputMapping && typeof cfg.inputMapping === 'object' && !Array.isArray(cfg.inputMapping))
      ? (cfg.inputMapping as Record<string, string>)
      : undefined;
    const outputMapping = (cfg.outputMapping && typeof cfg.outputMapping === 'object' && !Array.isArray(cfg.outputMapping))
      ? (cfg.outputMapping as Record<string, string>)
      : undefined;
    const onChildFailure = cfg.onChildFailure === 'continue' ? 'continue' : 'fail-parent';

    const { dispatchSubWorkflow } = await import('../executor/subWorkflowDispatcher.js');
    try {
      const result = await dispatchSubWorkflow({
        parentRunId: ctx.runId,
        parentTenantId: ctx.tenantId,
        ...(ctx.scopeId ? { parentScopeId: ctx.scopeId } : {}),
        parentNodeId: ctx.nodeId,
        childWorkflowId,
        ...(inputMapping ? { inputMapping } : {}),
        ...(outputMapping ? { outputMapping } : {}),
        onChildFailure,
      });
      // Non-terminal child status → parent suspends with the matching
      // kind. The cancel cascade (routes/runs.ts) walks parentRunId
      // links to invalidate the child interrupt when the parent is
      // cancelled, satisfying the `openwop-interrupt-parent-child`
      // profile in interrupt-profiles.md.
      const TERMINAL: readonly string[] = ['completed', 'failed', 'cancelled'];
      if (!TERMINAL.includes(result.childStatus)) {
        return {
          status: 'suspended',
          interrupt: {
            kind: result.childInterruptKind ?? 'approval',
            data: {
              childRunId: result.childRunId,
              childInterruptNodeId: result.childInterruptNodeId,
              childStatus: result.childStatus,
            },
          },
        };
      }
      if (result.childStatus !== 'completed' && onChildFailure === 'fail-parent') {
        return {
          status: 'failure',
          error: {
            code: 'subworkflow_child_failed',
            message: `child run ${result.childRunId} terminated ${result.childStatus}`,
          },
        };
      }
      return {
        status: 'success',
        outputs: {
          childRunId: result.childRunId,
          childStatus: result.childStatus,
          outputMappingSkipped: result.outputMappingSkipped,
        },
      };
    } catch (err) {
      return {
        status: 'failure',
        error: {
          code: 'internal_error',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  },
};

/** Per `channels-and-reducers.md §append + §TTL`: append a
 *  `{value, _ts}` entry to the named channel (modeled as a workflow
 *  variable storing an array). When `ttlMs > 0`, drop existing
 *  entries whose `_ts < now - ttlMs` BEFORE appending — the TTL is
 *  a write-time filter, not a read-time one. */
const channelWriteNode: NodeModule = {
  typeId: 'core.channelWrite',
  version: '1.0.0',
  async execute(ctx) {
    const cfg = (ctx.config ?? {}) as { channelName?: unknown; reducer?: unknown; ttlMs?: unknown; value?: unknown };
    const channelName = typeof cfg.channelName === 'string' ? cfg.channelName : '';
    if (!channelName) {
      return { status: 'failure', error: { code: 'invalid_request', message: 'core.channelWrite requires config.channelName' } };
    }
    const reducer = typeof cfg.reducer === 'string' ? cfg.reducer : 'append';
    const ttlMs = typeof cfg.ttlMs === 'number' && cfg.ttlMs > 0 ? cfg.ttlMs : 0;
    const now = Date.now();
    // Dynamic import to avoid bootstrap import cycle.
    const { snapshotRunVariables, setRunVariable } = await import('../host/variablesRuntime.js');
    const bag = snapshotRunVariables(ctx.runId) ?? {};
    const existing = Array.isArray(bag[channelName]) ? (bag[channelName] as Array<{ value: unknown; _ts: number }>) : [];
    let kept = existing;
    if (ttlMs > 0) {
      const cutoff = now - ttlMs;
      kept = existing.filter((e) => typeof e?._ts === 'number' && e._ts >= cutoff);
    }
    if (reducer === 'append') {
      kept = [...kept, { value: cfg.value, _ts: now }];
    } else if (reducer === 'replace') {
      kept = [{ value: cfg.value, _ts: now }];
    }
    setRunVariable(ctx.runId, channelName, kept);
    return { status: 'success', outputs: { channelName, size: kept.length } };
  },
};

const delayNode: NodeModule = {
  typeId: 'core.delay',
  version: '1.0.0',
  async execute(ctx) {
    // Support three input sources, in precedence order:
    //   1. ctx.inputs.delayMs — fixture-shape input port resolved by
    //      the executor from a variable reference (e.g.,
    //      conformance-cancellable seeds delayMs=30000 via its
    //      variable bag, which the executor resolves into the input
    //      port).
    //   2. ctx.config.durationMs — legacy direct config (sample
    //      workflows that hard-code the delay).
    //   3. 0 — safe default.
    // The 60s cap stays — the sample isn't a long-running daemon.
    const inputs = (ctx.inputs ?? {}) as Record<string, unknown>;
    const fromInput = typeof inputs.delayMs === 'number' ? inputs.delayMs : Number(inputs.delayMs);
    const fromConfig = Number(ctx.config?.durationMs);
    const fromConfigShort = Number((ctx.config as { ms?: unknown } | undefined)?.ms);
    const raw = Number.isFinite(fromInput) ? fromInput
      : (Number.isFinite(fromConfig) ? fromConfig
      : (Number.isFinite(fromConfigShort) ? fromConfigShort : 0));
    const ms = Math.max(0, Math.min(60_000, raw));
    await new Promise((r) => setTimeout(r, ms));
    return { status: 'success', outputs: { waitedMs: ms } };
  },
};

/** Deterministic-failure node — terminates with `status: 'failed'`
 *  every time. Inverse of `core.noop`. Conformance fixtures use this
 *  to exercise downstream paths (e.g., RFC 0022 §B "outputMapping is
 *  SKIPPED when child terminates failed/cancelled" — HVMAP-1b-failed). */
const failNode: NodeModule = {
  typeId: 'core.fail',
  version: '1.0.0',
  async execute(ctx) {
    const code = String(ctx.config?.code ?? 'deterministic_fail');
    const message = String(ctx.config?.message ?? 'core.fail node terminated deterministically');
    return { status: 'failure', error: { code, message } };
  },
};

const approvalGateNode: NodeModule = {
  typeId: 'core.approvalGate',
  version: '1.0.0',
  async execute(ctx) {
    const cfg = (ctx.config ?? {}) as {
      prompt?: unknown;
      title?: unknown;
      description?: unknown;
      actions?: unknown;
      requiredApprovals?: unknown;
      rejectionPolicy?: unknown;
      approversList?: unknown;
      optionLabels?: unknown;
    };
    // Surface upstream node outputs to the approver. When two or more
    // input ports carry string content (the Triple-AI fan-in shape:
    // three critic summaries reaching the arbiter on distinct ports),
    // bundle them as `options` so the FE card can render a per-option
    // expand + pick button.
    //
    // **Producer↔consumer coupling.** This is the PRODUCER side. The
    // consumer is `ApprovalCard` in
    // `apps/workflow-engine/frontend/react/src/chat/registry/defaultCards.tsx`,
    // which renders `data.options` as a picker and sends back
    // `{action: 'approve', content: <picked>, selectedKey, comment?}`
    // as the resume value. `content` is the key the executor's
    // `findFirstStringValue()` walks last (`['prompt', 'text',
    // 'message', 'content', 'completion']`), so downstream nodes pull
    // the picked text out via the standard input-fallback path with
    // no further plumbing. Both sides MUST move together when the
    // shape changes — there's no spec/v1 schema for `data.options`
    // yet (sample-app contract; spec promotion is a follow-up).
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object' && !Array.isArray(ctx.inputs))
      ? (ctx.inputs as Record<string, unknown>)
      : {};
    const optionLabels = (cfg.optionLabels && typeof cfg.optionLabels === 'object')
      ? (cfg.optionLabels as Record<string, string>)
      : {};
    const options: Array<{ key: string; label: string; content: string }> = [];
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value !== 'string' || value.length === 0) continue;
      const label = optionLabels[key] ?? humanizePortName(key);
      options.push({ key, label, content: value });
    }
    return {
      status: 'suspended',
      interrupt: {
        kind: 'approval',
        // Forward quorum config into interrupt.data so the resolve
        // handler can read requiredApprovals + rejectionPolicy per
        // `interrupt-profiles.md §openwop-interrupt-quorum`. The
        // resolver's `recordQuorumVote` only activates when
        // requiredApprovals > 1; single-approver gates stay on the
        // immediate-resume path.
        data: {
          prompt: typeof cfg.prompt === 'string' ? cfg.prompt : (typeof cfg.title === 'string' ? cfg.title : 'Please approve to continue.'),
          actions: Array.isArray(cfg.actions) ? cfg.actions : ['approve', 'reject'],
          ...(options.length >= 2 ? { options } : {}),
          ...(typeof cfg.requiredApprovals === 'number' ? { requiredApprovals: cfg.requiredApprovals } : {}),
          ...(typeof cfg.rejectionPolicy === 'string' ? { rejectionPolicy: cfg.rejectionPolicy } : {}),
          ...(Array.isArray(cfg.approversList) ? { approversList: cfg.approversList } : {}),
        },
      },
    };
  },
};

/** Port names like `_gate_2` / `option_clarity` get turned into human-
 *  readable labels for the approval card. Strips leading underscores,
 *  splits on `_`/`-`, and Title Cases each segment. */
function humanizePortName(key: string): string {
  const stripped = key.replace(/^_+/, '');
  const parts = stripped.split(/[-_]+/).filter(Boolean);
  if (parts.length === 0) return key;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

const clarificationGateNode: NodeModule = {
  typeId: 'core.clarificationGate',
  version: '1.0.0',
  async execute(ctx) {
    return {
      status: 'suspended',
      interrupt: {
        kind: 'clarification',
        data: {
          question: ctx.config?.question ?? 'Please clarify.',
          schema: ctx.config?.schema ?? { type: 'string' },
        },
      },
    };
  },
};

const VALID_KINDS = ['approval', 'clarification', 'refinement', 'cancellation', 'external-event'] as const;
type InterruptKind = (typeof VALID_KINDS)[number];
function coerceKind(raw: unknown): InterruptKind {
  return VALID_KINDS.includes(raw as InterruptKind) ? (raw as InterruptKind) : 'approval';
}

const interruptNode: NodeModule = {
  typeId: 'core.interrupt',
  version: '1.0.0',
  async execute(ctx) {
    return {
      status: 'suspended',
      interrupt: { kind: coerceKind(ctx.config?.kind), data: ctx.config?.data ?? {} },
    };
  },
};

// Mock AI node — demonstrates the cost-attribution pattern. Real
// deployers wire core.openwop.ai (published pack) which calls actual
// providers and records real token counts + USD via emitCost().
//
// RFC 0027 + RFC 0029 integration: when any of the four PromptRef
// kinds is set on `config` (`systemPromptRef`, `userPromptRef`,
// `schemaHintPromptRef`, `fewShotPromptRefs[]`), the node walks the
// four-layer resolution chain (per `spec/v1/prompts.md` §"Resolution
// chain (normative)"), emits one `agent.promptResolved` event per
// kind+slot resolved, then composes the body via the host's
// composition pipeline and emits one `prompt.composed` event per
// composition. The composed bodies are concatenated into the prompt
// the mock LLM responds to.
const sampleMockAiNode: NodeModule = {
  typeId: 'local.sample.demo.mock-ai',
  version: '0.1.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    const cfg = (ctx.config ?? {}) as {
      systemPromptRef?: unknown;
      userPromptRef?: unknown;
      schemaHintPromptRef?: unknown;
      fewShotPromptRefs?: unknown[];
      agentId?: string;
    };

    // ── Prompt-library integration ────────────────────────────────
    // For each kind whose ref(s) is/are set, walk the resolution
    // chain, emit `agent.promptResolved`, then (if resolved) compose
    // + emit `prompt.composed`. The discovery-advertised capability
    // values (observability + agentBindings) are read from the
    // shared `getPromptsHostConfig()` so a deployer who tightens the
    // advertisement can't end up with a dispatch path that emits
    // looser data than the host claims to expose.
    //
    // All four kinds defined in `schemas/prompt-kind.schema.json` are
    // wired (RFC 0027 §A):
    //   - `system` / `user` / `schema-hint` — singular ref fields.
    //   - `few-shot` — plural `fewShotPromptRefs[]` (each entry
    //     resolves + composes independently; one event pair per
    //     entry).
    //
    // The mock LLM "prompt" is the concatenation of composed bodies
    // in the conventional dispatch order (per myndhyve precedent +
    // RFC 0027 prose): system → schema-hint → few-shot exemplars →
    // user. Real provider dispatchers (e.g., `core.openwop.ai`)
    // route each kind to its provider-specific slot (system message,
    // response_format hint, assistant/user exemplar pairs, user
    // message) rather than concatenating; the mock LLM here only
    // needs to verify the dispatch reaches each composed body.
    const promptsConfig = getPromptsHostConfig();

    /** Compose one template by ref, emit the chain + composed events,
     *  and return the composed body (or null on miss). The kind is
     *  passed through to the resolver + composer so observability
     *  events carry accurate per-kind attribution. The slotIndex
     *  argument disambiguates few-shot entries when multiple refs
     *  share the same kind — for kind: "few-shot", the resolver
     *  reads `fewShotPromptRefs[slotIndex]`; ignored for the
     *  singular-ref kinds. */
    const composeRef = async (
      kind: PromptKind,
      refValue: unknown,
      slotIndex: number = 0,
    ): Promise<string | null> => {
      if (refValue === undefined || refValue === null || refValue === '') return null;

      const resolution = resolvePromptRef({
        kind,
        node: { nodeId: ctx.nodeId, config: cfg },
        agentBindingsSupported: promptsConfig.agentBindings,
        fewShotIndex: slotIndex,
      });
      // agent.promptResolved emits before any composition so cross-
      // host debuggers see the chain trace whether or not composition
      // succeeds. The event carries refs (not bodies), so emission
      // is safe regardless of observability mode.
      await ctx.emit('agent.promptResolved', resolution);

      if (resolution.resolved === null) return null;

      // Parse the winning ref to look up the template. Stringy form
      // `prompt:templateId[@version]` is canonical for the resolver's
      // output.
      const refMatch = /^prompt:([a-z0-9][a-z0-9._-]{0,127})(?:@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?))?$/.exec(resolution.resolved);
      if (!refMatch) return null;
      const templateId = refMatch[1]!;
      const version = refMatch[2];
      const found = getTemplate(templateId, version !== undefined ? { version } : {});
      if (!found || found === 'ambiguous') return null;

      // Compose with ctx.inputs as the variable-binding source. The
      // composer respects PromptVariable.source declarations on the
      // template (secret-source → BYOK lookup, etc.) and emits the
      // composed body with redaction + trust-marker preservation.
      // observability is read from the shared host config so the
      // emitted payload matches what the host advertised — a
      // deployer who tightens to "hashed" or "off" gets the strict
      // emission without further dispatch-path changes.
      const composed = await composePromptTemplate({
        templateId,
        bindings: inputs,
        observability: promptsConfig.observability,
        nodeId: ctx.nodeId,
      });
      await ctx.emit('prompt.composed', composed);
      return composed.composed ?? null;
    };

    const systemBody = await composeRef('system', cfg.systemPromptRef);
    const schemaHintBody = await composeRef('schema-hint', cfg.schemaHintPromptRef);
    const fewShotBodies: string[] = [];
    if (Array.isArray(cfg.fewShotPromptRefs)) {
      for (let i = 0; i < cfg.fewShotPromptRefs.length; i++) {
        const body = await composeRef('few-shot', cfg.fewShotPromptRefs[i], i);
        if (body !== null) fewShotBodies.push(body);
      }
    }
    const userBody = await composeRef('user', cfg.userPromptRef);

    // Concatenate composed bodies in the conventional dispatch order.
    // Fallback chain expanded so multi-step workflows always produce
    // a non-empty mock output even when (a) prompt composition returns
    // null bodies despite the ref resolving, or (b) an upstream edge
    // delivered the text under a different input field (`inputs.text`
    // from an `uppercase` node, `inputs.message`, etc.) than the
    // canonical `inputs.prompt`. Previously these cases produced the
    // literal stub "Mock response to:" with nothing after, which read
    // as broken to demo users.
    const parts: string[] = [];
    if (systemBody !== null) parts.push(systemBody);
    if (schemaHintBody !== null) parts.push(schemaHintBody);
    for (const f of fewShotBodies) parts.push(f);
    if (userBody !== null) parts.push(userBody);
    function firstStringInput(): string {
      // Walk the most-common upstream port names in order of likelihood,
      // then fall back to any string-valued input field. Keeps the demo
      // from rendering empty cards when an edge maps to a non-canonical
      // input port. `text` is what `uppercase` emits; `prompt` is the
      // canonical mock-ai input; `message` covers chat-style upstreams.
      for (const k of ['prompt', 'text', 'message', 'content', 'input']) {
        const v = inputs[k];
        if (typeof v === 'string' && v.length > 0) return v;
      }
      for (const v of Object.values(inputs)) {
        if (typeof v === 'string' && v.length > 0) return v;
      }
      return '';
    }
    const prompt = parts.length > 0
      ? parts.join('\n\n')
      : firstStringInput();

    // Simulated token accounting — real impls read from the provider response.
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = Math.max(8, Math.floor(promptTokens / 2));
    emitCost({
      provider: 'mock',
      model: 'mock-mini',
      promptTokens,
      completionTokens,
      // Mock pricing: $0.001/1k prompt, $0.002/1k completion.
      usdCost: (promptTokens * 0.001 + completionTokens * 0.002) / 1000,
    });
    return {
      status: 'success',
      outputs: { completion: `Mock response to: ${prompt.slice(0, 80)}` },
    };
  },
};

// Chat responder — dispatches to a real AI provider via raw fetch.
// Reads BYOK credentialRef from ctx.secrets, model/provider from inputs,
// and streams tokens via node.message events.
//
// Tool calling: when inputs.tools is a non-empty array of
// {workflowId, name, description}, the node routes anthropic dispatch
// through `dispatchAnthropicWithTools` and lets the model invoke saved
// workflows as tools. Each tool_use dispatches a sub-run via
// `dispatchSubRun` with a 30s budget; the result (or a "pending" stub
// if it hits an interrupt) feeds back as tool_result.
/**
 * Resolve `agent.reasoned` verbosity per `capabilities.md` precedence:
 *   per-run `RunOptions.configurable.reasoningVerbosity`
 *   > host capability default (advertised in /.well-known/openwop)
 *   > suite default (default arg)
 * Returns the resolved verbosity along with `agent.reasoning.delta` +
 * `agent.reasoned` emission callbacks bound to `ctx` and `agentId`.
 *
 * The callbacks are `undefined` when resolved verbosity is `'off'` —
 * the dispatcher's optional spread (`...(cb ? { cb } : {})`) skips
 * registration entirely in that case, so the provider's server-side
 * thinking surface stays disabled too.
 *
 * SR-1 redaction: `ctx.emit` routes every payload through
 * `stripSecretsFromPersisted` (executor.ts:emit). Any host-resolved
 * credential the model echoes into reasoning is redacted before the
 * event lands in the log. See `SECURITY/threat-model-secret-leakage.md`.
 */
function buildReasoningCallbacks(
  ctx: NodeContext,
  agentId: string,
  defaultVerbosity: 'summary' | 'full' | 'off',
): {
  verbosity: 'summary' | 'full' | 'off';
  onReasoningDelta?: (delta: string) => Promise<void>;
  onReasoningBlock?: (block: string) => Promise<void>;
} {
  const reqVerbosity = ctx.configurable?.reasoningVerbosity;
  const verbosity: 'summary' | 'full' | 'off' =
    reqVerbosity === 'off' || reqVerbosity === 'full' || reqVerbosity === 'summary'
      ? reqVerbosity
      : defaultVerbosity;
  if (verbosity === 'off') return { verbosity };
  // RFC 0024: per-block sequence counter. Resets to 0 on each closed
  // block so consumers can detect dropped deltas within a block without
  // global cross-block bookkeeping.
  let seq = 0;
  return {
    verbosity,
    onReasoningDelta: async (delta: string): Promise<void> => {
      await ctx.emit('agent.reasoning.delta', { agentId, delta, sequence: seq, verbosity });
      seq++;
    },
    onReasoningBlock: async (block: string): Promise<void> => {
      // Closing event carries the full content (truncated under
      // 'summary'). Per RFC 0024, this event is authoritative even
      // if it disagrees with the delta concatenation.
      const reasoning = verbosity === 'summary' ? block.slice(0, 2048) : block;
      await ctx.emit('agent.reasoned', { agentId, reasoning, verbosity });
      seq = 0;
    },
  };
}

/**
 * RFC 0032 §B.3 + §B.4 — emit `envelope.refusal` / `envelope.truncated` from
 * the chat-responder dispatch path so the live AI chat surfaces these signals
 * the same way `aiProvidersHost.dispatchStructured()` does for structured-
 * output paths. The chat-responder doesn't have retry, NL→format coercion,
 * or recovery loops (those are structured-output features), so only refusal
 * and truncation apply here.
 *
 * Refusal detection: each provider returns a vendor-native finishReason on
 * safety stop:
 *   - Anthropic: 'refusal' (2025 stop_reason) | 'end_turn' with empty body
 *   - OpenAI:    'content_filter'
 *   - Gemini:    'SAFETY' | 'RECITATION' OR a non-empty `blockReason`
 * Truncation detection: vendor-native `length` / `max_tokens` / `MAX_TOKENS`.
 *
 * Refusal text is intentionally NOT included on the wire to honor the
 * SECURITY invariant `envelope-refusal-no-prompt-leak` — the partial
 * completion would echo prompt content.
 */
async function emitChatEnvelopeSignals(
  ctx: NodeContext,
  result: DispatchResult | ManagedDispatchResult,
): Promise<void> {
  const fr = (result.finishReason ?? '').toLowerCase();
  // RFC 0032 §B.3 — refusal detection lifted to @openwop/openwop's parseRefusal()
  // helper, called by each dispatcher in providers/dispatch.ts and surfaced
  // here as a typed RefusalSignal. ManagedDispatchResult doesn't carry the
  // signal (managed-provider path goes through a different pipeline), so the
  // narrowing `'refusal' in result` keeps the union safe under
  // exactOptionalPropertyTypes.
  const refusal = 'refusal' in result ? result.refusal : undefined;
  if (refusal) {
    try {
      await ctx.emit(
        'envelope.refusal',
        buildRefusalPayload(
          ctx.nodeId,
          result.provider,
          result.model,
          // refusalText omitted from the wire per SECURITY/invariants.yaml
          // §envelope-refusal-no-prompt-leak — provider refusal messages CAN
          // echo prompt content, and the chat-responder has no redaction
          // harness wired yet. The signal's presence is enough to fire the chip;
          // the FE doesn't need the text.
          undefined,
          refusal.safetyCategory,
        ),
      );
    } catch { /* best-effort emission — never block the response */ }
  }

  const isTruncated = fr === 'max_tokens' || fr === 'length';
  if (isTruncated) {
    try {
      // Preserve OpenAI's `length` distinction per RFC 0032 §B.4 schema description
      // (`length preserved as a separate value for hosts that distinguish provider-
      // side length cap from host-side budget cap`). The chat-responder sees the
      // raw provider string, so we can keep the fidelity the reference
      // classifyTruncationStopReason() helper has to collapse upstream.
      const stopReason = fr === 'length' ? 'length' : 'max_tokens';
      await ctx.emit(
        'envelope.truncated',
        buildTruncatedPayload(
          ctx.nodeId,
          result.provider,
          result.model,
          stopReason,
          result.completion.length > 0,
          // outputTokens: pass `undefined` on absence so the helper omits the field
          // (`!== undefined` guard). The wire shape accepts both null and absent,
          // but absent matches the structured-output emission convention.
          result.usage?.outputTokens,
        ),
      );
    } catch { /* best-effort */ }
  }
}

/**
 * Sample chat-responder. Sits in the `vendor.openwop-sample.*` namespace
 * per `spec/v1/node-packs.md` §"Reserved-typeIds" (the unrestricted
 * carve-out), which puts it inside RFC 0023 §A's authorized-emitter
 * scope for `agent.reasoned` events.
 */
/** Resolve a PromptRef declared in node config (per RFC 0027), compose
 *  the template body against the run inputs, and return the composed
 *  string. Returns null when the ref is unset, unresolvable, points at
 *  an ambiguous/missing template, or the composer emits an empty body.
 *  Emits `agent.promptResolved` + `prompt.composed` events identically
 *  to the mock-ai path so observability is uniform across executors. */
async function resolveAndComposePromptRef(
  ctx: NodeContext,
  kind: PromptKind,
  refValue: unknown,
  inputs: Record<string, unknown>,
): Promise<string | null> {
  if (refValue === undefined || refValue === null || refValue === '') return null;
  const cfg = (ctx.config ?? {}) as Record<string, unknown>;
  const promptsConfig = getPromptsHostConfig();
  const resolution = resolvePromptRef({
    kind,
    node: { nodeId: ctx.nodeId, config: cfg },
    agentBindingsSupported: promptsConfig.agentBindings,
  });
  await ctx.emit('agent.promptResolved', resolution);
  if (resolution.resolved === null) return null;
  const refMatch = /^prompt:([a-z0-9][a-z0-9._-]{0,127})(?:@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?))?$/.exec(resolution.resolved);
  if (!refMatch) return null;
  const templateId = refMatch[1]!;
  const version = refMatch[2];
  const found = getTemplate(templateId, version !== undefined ? { version } : {});
  if (!found || found === 'ambiguous') return null;
  const composed = await composePromptTemplate({
    templateId,
    bindings: inputs,
    observability: promptsConfig.observability,
    nodeId: ctx.nodeId,
  });
  await ctx.emit('prompt.composed', composed);
  return composed.composed ?? null;
}

/** Walk the inputs map looking for a usable string. Tries the canonical
 *  port names first, then any string-valued field, then one level into
 *  nested objects (covers cases where an upstream node delivered a
 *  whole outputs map under a single port — e.g., `{ in: { text: '...' }}`
 *  from a noop fan-in). Returns the first non-empty string found. */
function findFirstStringValue(inputs: Record<string, unknown>): string | undefined {
  for (const k of ['prompt', 'text', 'message', 'content', 'input', 'in']) {
    const v = inputs[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const v of Object.values(inputs)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const v of Object.values(inputs)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>;
      for (const k of ['prompt', 'text', 'message', 'content', 'completion']) {
        const inner = nested[k];
        if (typeof inner === 'string' && inner.length > 0) return inner;
      }
    }
  }
  return undefined;
}

function lastIndexOfRole(messages: readonly ChatMessage[], role: ChatMessage['role']): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === role) return i;
  }
  return -1;
}

/** Upper bound on managed-chat (openwop-free / MiniMax) dispatch wall
 *  time. Without a timeout, an unresponsive upstream parks the worker
 *  forever and the run goes `running` with no further events.
 *  Override per-deploy via `OPENWOP_MANAGED_CHAT_TIMEOUT_MS`. Read
 *  once at module load — restart Cloud Run revision to pick up a
 *  changed value (matches the convention for `maxConcurrentNodes`).
 *  Use `let` (not `const`) so the `_setManagedChatTimeoutMs` test
 *  affordance below can swing the value at runtime without dynamic
 *  re-import gymnastics. */
let MANAGED_CHAT_TIMEOUT_MS =
  Number(process.env.OPENWOP_MANAGED_CHAT_TIMEOUT_MS) || 60_000;

/** Test affordance — override the managed-chat timeout for a single
 *  test run. Mirrors the `_resetOidcVerifier` convention used by the
 *  auth middleware tests. NOT for production callers; the env var is
 *  the supported configuration surface. */
export function _setManagedChatTimeoutMs(ms: number): void {
  MANAGED_CHAT_TIMEOUT_MS = ms;
}

// Exported for test access; production callers wire via the registry
// in `registerSampleNodes` below.
export const sampleChatResponderNode: NodeModule = {
  typeId: 'vendor.openwop-sample.chat-responder',
  version: '0.2.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    const config = (ctx.config && typeof ctx.config === 'object') ? (ctx.config as Record<string, unknown>) : {};
    // Per-node provider/model/credentialRef precedence: workflow node
    // config FIRST (set via the builder Inspector), inputs SECOND (the
    // chat-tab path supplies these through the run's inputs). Keeps
    // chat-tab semantics unchanged while letting builder-authored
    // workflows pin each chat node to a specific provider+model+key.
    const provider =
      (config.provider as ProviderId | undefined) ??
      (inputs.provider as ProviderId | undefined) ??
      'anthropic';
    const model =
      (config.model as string | undefined) ??
      (inputs.model as string | undefined) ??
      getDefaultModel(provider);
    // Default to the managed `openwop-free` tile when no credential is
    // pinned at the workflow-graph or run-input layer. Lets builder
    // templates (and freshly-dragged chat nodes) call a real LLM out of
    // the box — the user only has to swap the credential when they want
    // a different model or their own key.
    const credentialRef =
      (config.credentialRef as string | undefined) ??
      (inputs.credentialRef as string | undefined) ??
      'managed:openwop-free';
    // Accept either a multi-turn `messages` array (chat-tab shape) OR a
    // single `prompt` string (workflow-graph shape, what `uppercase` /
    // `etl-extractor` / other text-emitting upstream nodes deliver under
    // the `prompt` port). When only `prompt` is present, wrap it into a
    // one-shot user turn. Common upstream port names are walked in the
    // same order as the mock-ai fallback so the swap from `mock-ai` →
    // `chat` is wire-shape-compatible.
    let messages = inputs.messages as ChatMessage[] | undefined;
    if (!Array.isArray(messages) || messages.length === 0) {
      const promptText = findFirstStringValue(inputs);
      if (promptText !== undefined) {
        messages = [{ role: 'user', content: promptText }];
      }
    }
    const maxTokens = typeof inputs.maxTokens === 'number' ? inputs.maxTokens : 1024;
    const webSearch = inputs.webSearch === true;
    const rawTools = Array.isArray(inputs.tools) ? (inputs.tools as ToolBinding[]) : [];

    if (!Array.isArray(messages) || messages.length === 0) {
      // Diagnostic — surfaces which input ports actually arrived so a
      // misconfigured fan-out / port-name mismatch can be traced from
      // the run event log without a separate logging round-trip.
      const inputKeys = Object.keys(inputs);
      return {
        status: 'failure',
        error: {
          code: 'invalid_request',
          message:
            inputKeys.length === 0
              ? 'No upstream inputs reached this chat node. Check the workflow edges.'
              : `Chat node received inputs on ports [${inputKeys.join(', ')}] but none carried a string. Edges should map to a port named one of: prompt, text, message, content, input.`,
        },
      };
    }

    // Resolve a system message from one of three sources, in precedence
    // order: (1) `config.systemPrompt` — a literal string the template
    // or Inspector wires directly (no host-side template registry
    // needed); (2) `config.systemPromptRef` — an RFC 0027 PromptRef
    // pointing at a template in the host prompt store; (3) nothing, in
    // which case the LLM sees only the user turn. The composed body is
    // prepended as a `role: 'system'` message so the LLM has its role
    // before reading the user's content.
    let systemBody: string | null = null;
    const literalSystem = config['systemPrompt'];
    if (typeof literalSystem === 'string' && literalSystem.length > 0) {
      systemBody = literalSystem;
    } else {
      systemBody = await resolveAndComposePromptRef(ctx, 'system', config['systemPromptRef'], inputs);
    }
    if (systemBody !== null) {
      messages = [{ role: 'system', content: systemBody }, ...messages];
    }
    const userBody = await resolveAndComposePromptRef(ctx, 'user', config['userPromptRef'], inputs);
    if (userBody !== null) {
      // Replace only the trailing user turn so multi-turn chat histories
      // (chat-tab path) keep their earlier turns intact.
      const lastUserIdx = lastIndexOfRole(messages, 'user');
      if (lastUserIdx >= 0) {
        messages = messages.map((m, i) =>
          i === lastUserIdx ? { ...m, content: userBody } : m,
        );
      } else {
        messages = [...messages, { role: 'user', content: userBody }];
      }
    }

    // Managed-provider path: server-held key, per-tenant daily cap,
    // underlying provider hidden. The chat-responder short-circuits
    // BEFORE the standard ctx.secrets lookup so users never need a
    // BYOK row for managed providers.
    if (isManagedCredentialRef(credentialRef)) {
      const userFacingProvider = managedProviderIdFromRef(credentialRef);
      // Managed-tile agentId hides the underlying model (e.g.
      // 'openwop-free-assistant', NOT 'minimax-assistant'). Matches the
      // dispatchManagedChat result-rewriting boundary.
      const agentId = `${userFacingProvider}-assistant`;
      const { onReasoningDelta, onReasoningBlock } = buildReasoningCallbacks(ctx, agentId, 'full');

      try {
        const onDelta = async (delta: string) => {
          await ctx.emit('node.message', { delta });
        };
        // Bound the upstream LLM call. Without this, an unresponsive
        // managed-provider request (slow network, stuck connection,
        // upstream rate-limit hold) parks the worker forever — the
        // executor sets `currentNodeId` but `node.started` never fires
        // because the dispatch is still awaiting a response, and the
        // run stalls indefinitely with no observable failure. 60s is
        // generous for chat completions; surface as `timeout` so a
        // future retry/route-error policy can act on it.
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), MANAGED_CHAT_TIMEOUT_MS);
        let managed: ManagedDispatchResult;
        try {
          managed = await dispatchManagedChat({
            userFacingProvider,
            tenantId: ctx.tenantId,
            messages: messages as ChatMessage[],
            maxTokens,
            onDelta,
            signal: abort.signal,
            ...(onReasoningDelta ? { onReasoningDelta } : {}),
            ...(onReasoningBlock ? { onReasoningBlock } : {}),
          });
        } finally {
          clearTimeout(timer);
        }
        await emitChatEnvelopeSignals(ctx, managed);
        emitCost({
          provider: managed.provider,
          model: managed.model,
          promptTokens: managed.usage?.inputTokens,
          completionTokens: managed.usage?.outputTokens,
        });
        if (managed.completion.length === 0) {
          return {
            status: 'failure',
            error: {
              code: 'empty_completion',
              message: 'Free tier returned no content. Try again or pick a different provider.',
            },
          };
        }
        return {
          status: 'success',
          outputs: {
            completion: managed.completion,
            provider: managed.provider,
            model: managed.model,
            usage: managed.usage,
          },
        };
      } catch (err) {
        if (err instanceof ManagedProviderError) {
          return { status: 'failure', error: { code: err.code, message: err.message } };
        }
        // AbortError from the timeout above. Surfaces as a clean
        // `timeout` so a future retry/route-error policy can act on
        // it; the run won't park indefinitely waiting on a stuck
        // upstream.
        if (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))) {
          return {
            status: 'failure',
            error: {
              code: 'timeout',
              message: `Managed chat dispatch exceeded ${MANAGED_CHAT_TIMEOUT_MS}ms — upstream provider unresponsive.`,
            },
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { status: 'failure', error: { code: 'internal_error', message } };
      }
    }

    const apiKey = ctx.secrets[credentialRef];
    if (!apiKey) {
      return { status: 'failure', error: { code: 'credential_unavailable', message: `Secret ${credentialRef} not resolved by host.` } };
    }

    // Tool mode is wired for Anthropic + MiniMax. Each has its own
    // dispatcher (Anthropic's native tools API vs OpenAI-compatible
    // tool_calls for MiniMax); OpenAI + Google are deferred since
    // their tool-call wire shapes diverge further. The provider gate
    // here short-circuits before we resolve tool bindings.
    const toolsCapableProvider = provider === 'anthropic' || provider === 'minimax';
    const useTools = rawTools.length > 0 && toolsCapableProvider;
    const toolBindings = useTools ? validateToolBindings(rawTools) : [];
    // Tools requested but the resolved provider has no dispatcher for
    // them — emit a structured warning so the FE can show it inline
    // ("tools were silently dropped"). The dispatch still runs without
    // tools rather than failing the run; the warning gives the user
    // visibility into why their tool-bound chat node didn't tool-call.
    if (rawTools.length > 0 && !toolsCapableProvider) {
      await ctx.emit('node.warning', {
        code: 'tools_unsupported_provider',
        message: `Tools were requested but provider '${provider}' has no tools dispatcher wired. Tools dropped; chat will dispatch text-only.`,
        provider,
        requestedToolCount: rawTools.length,
      });
    }

    // BYOK agentId reveals the actual provider+model — by design.
    // Managed-tile hides the underlying model (`openwop-free-assistant`);
    // BYOK users picked their own model so honesty wins over uniformity.
    const byokAgentId = `${provider}-${model}-assistant`.slice(0, 256);
    const { verbosity: byokVerbosity, onReasoningDelta: byokOnReasoningDelta, onReasoningBlock: byokOnReasoningBlock } =
      buildReasoningCallbacks(ctx, byokAgentId, 'full');

    try {
      const onDelta = async (delta: string) => {
        await ctx.emit('node.message', { delta });
      };
      let result: DispatchResult;
      if (useTools) {
        const toolDefs: ToolDef[] = toolBindings.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: { type: 'object', additionalProperties: true },
        }));
        const bindingByName = new Map(toolBindings.map((t) => [t.name, t]));
        // Shared tool-execution callback — same surface for both
        // dispatchers. Each round, the model requests a tool, this
        // looks up the bound workflow, executes it via dispatchSubRun,
        // and emits structured node.tool_use / node.tool_result events
        // so the UI can render its own breadcrumb cards instead of the
        // dispatcher's inline Markdown.
        const onToolUse = async (use: { id: string; name: string; input: Record<string, unknown> }) => {
          const binding = bindingByName.get(use.name);
          if (!binding) {
            return {
              toolUseId: use.id,
              content: `tool_not_found: ${use.name}`,
              isError: true,
            };
          }
          await ctx.emit('node.tool_use', {
            toolUseId: use.id,
            name: use.name,
            workflowId: binding.workflowId,
            input: use.input,
          });
          const subResult = await dispatchSubRun({
            workflowId: binding.workflowId,
            inputs: use.input,
            budgetMs: 30_000,
            tenantId: ctx.tenantId,
            ...(ctx.scopeId ? { scopeId: ctx.scopeId } : {}),
          });
          await ctx.emit('node.tool_result', {
            toolUseId: use.id,
            name: use.name,
            status: subResult.status,
            ...(subResult.status === 'completed' ? { output: subResult.output } : {}),
            ...(subResult.status === 'failed' ? { error: subResult.error } : {}),
            ...(subResult.status !== 'completed' && 'runId' in subResult ? { runId: subResult.runId } : {}),
          });
          return {
            toolUseId: use.id,
            content: formatSubRunResult(subResult),
            isError: subResult.status === 'failed',
          };
        };
        const toolsReq = {
          provider,
          model,
          apiKey,
          messages,
          maxTokens,
          onDelta,
          tools: toolDefs,
          onToolUse,
        };
        result = provider === 'minimax'
          ? await dispatchMiniMaxWithTools(toolsReq)
          : await dispatchAnthropicWithTools(toolsReq);
      } else {
        result = await dispatchChat({
          provider,
          model,
          apiKey,
          messages,
          maxTokens,
          webSearch,
          onDelta,
          reasoningVerbosity: byokVerbosity,
          ...(byokOnReasoningDelta ? { onReasoningDelta: byokOnReasoningDelta } : {}),
          ...(byokOnReasoningBlock ? { onReasoningBlock: byokOnReasoningBlock } : {}),
        });
      }
      await emitChatEnvelopeSignals(ctx, result);
      emitCost({
        provider: result.provider,
        model: result.model,
        promptTokens: result.usage?.inputTokens,
        completionTokens: result.usage?.outputTokens,
      });
      if (result.completion.length === 0) {
        // Provider returned 200 but no text. Use the real provider-
        // reported diagnostic (finishReason, blockReason, safetyCategory)
        // when present; fall back to provider-specific heuristics.
        return {
          status: 'failure',
          error: {
            code: 'empty_completion',
            message: diagnoseEmptyCompletion(result),
          },
        };
      }
      return {
        status: 'success',
        outputs: {
          completion: result.completion,
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          ...(result.citations && result.citations.length > 0 ? { citations: result.citations } : {}),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'failure', error: { code: 'internal_error', message } };
    }
  },
};

interface ToolBinding {
  workflowId: string;
  name: string;
  description: string;
}

function validateToolBindings(raw: unknown[]): ToolBinding[] {
  const out: ToolBinding[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    if (typeof rec.workflowId !== 'string') continue;
    if (typeof rec.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(rec.name)) continue;
    if (typeof rec.description !== 'string') continue;
    out.push({ workflowId: rec.workflowId, name: rec.name, description: rec.description });
  }
  return out;
}

function formatSubRunResult(r: SubRunResult): string {
  if (r.status === 'completed') {
    try {
      return typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
    } catch {
      return String(r.output);
    }
  }
  if (r.status === 'pending') {
    return JSON.stringify({
      status: 'pending',
      runId: r.runId,
      message: `Workflow is still running or waiting on an interrupt after the ${r.budgetMs}ms tool budget. Tell the user they can resume it at /runs/${r.runId}.`,
    });
  }
  return JSON.stringify({
    status: 'failed',
    runId: r.runId,
    error: r.error,
  });
}

// A 1×1 transparent PNG — the default asset the media-emit demo node serves
// when the caller supplies no image of its own.
const DEMO_PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * RFC 0055 §C demo producer. Stores an image asset in the host's media
 * store (tenant-scoped capability-token URL) and emits a `media.image`
 * event referencing it BY URL — never inlining the binary. This is the
 * "producer" the §C serving + §B rendering rails were built to carry: a
 * run now has a `media.image` in its event log + debug bundle, served
 * from `GET /v1/host/sample/assets/{token}`.
 *
 * Inputs (all optional): `contentBase64` + `mimeType` to emit a
 * caller-supplied image; otherwise a 1×1 PNG. The emitted payload conforms
 * to `schemas/envelopes/media.image.schema.json` (`{ url, bytes, mimeType,
 * alt }`) — `alt` carries the accessibility text a consumer renders.
 */
const sampleImageEmitNode: NodeModule = {
  typeId: 'local.sample.demo.image-emit',
  version: '0.1.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    const contentBase64 = typeof inputs.contentBase64 === 'string' && inputs.contentBase64.length > 0
      ? inputs.contentBase64
      : DEMO_PNG_1x1_BASE64;
    const mimeType = typeof inputs.mimeType === 'string' && inputs.mimeType.length > 0
      ? inputs.mimeType
      : 'image/png';
    const alt = typeof inputs.alt === 'string' ? inputs.alt : 'Demo image (RFC 0055 media.image)';

    const stored = storeMediaAsset(ctx.tenantId, { contentBase64, contentType: mimeType });

    // RFC 0055 §C rule 1 + 3: reference the asset by its tenant-scoped URL,
    // never inline the binary. Payload conforms to the media.image schema
    // (url/bytes/mimeType/alt). The event lands in the run event log + debug
    // bundle (flipping the §C debug-bundle conformance assertion live).
    const payload = { url: stored.url, bytes: stored.bytes, mimeType, alt };
    await ctx.emit('media.image', payload);

    return { status: 'success', outputs: { image: payload } };
  },
};

/**
 * Demo node: write a memory entry mid-run and attribute it (RFC 0057).
 *
 * The host's only other memory write is the session-end run-summary
 * (executor.ts), which is a host write and carries no `nodeId`. This node
 * is the *node-attributed* counterpart: executing it writes a tenant memory
 * entry and emits a `memory.written` RunEvent carrying the node that caused
 * the write — turning the flat memory ledger (app-ux §A3) into a per-node
 * memory trail. It gives the RunTimeline memory-write markers (#192, which
 * read `memory.written`) a node-attributed event to render, and mirrors
 * `local.sample.demo.image-emit` (the RFC 0055 §C "close the loop" node).
 *
 * `ctx.emit` stamps the envelope `nodeId`; we ALSO put `nodeId` in the
 * payload per RFC 0057 §B (SHOULD) so a consumer reading the canonical
 * payload shape (`run-event-payloads.schema.json#/$defs/memoryWritten`)
 * gets the attribution without inspecting the envelope. The event is
 * content-free (identifiers + non-secret tags only — never the entry
 * content; the read-side serves that, SR-1-redacted). The host advertises
 * `capabilities.memory.attribution.emitsWriteEvents` (discovery.ts).
 *
 * Input (optional): `note` — the text to store. Defaults to a demo string.
 */
const sampleMemoryWriteNode: NodeModule = {
  typeId: 'local.sample.demo.memory-write',
  version: '0.1.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    const note = typeof inputs.note === 'string' && inputs.note.length > 0
      ? inputs.note
      : `Demo memory entry written by node ${ctx.nodeId}`;
    const tags = ['demo-write', `node:${ctx.nodeId}`, `run-id:${ctx.runId}`];
    const row = writeMemoryEntry(ctx.tenantId, MEMORY_DEMO_REF, { content: note, tags });
    // RFC 0057 §B — attribute the write on the event log, content-free
    // (identifiers + non-secret tags; never the entry content). `nodeId` is
    // included in the payload per the SHOULD; `ctx.emit` also stamps it on
    // the event envelope.
    await ctx.emit('memory.written', {
      memoryRef: MEMORY_DEMO_REF,
      memoryId: row.id,
      nodeId: ctx.nodeId,
      tags,
    });
    return { status: 'success', outputs: { memoryId: row.id, memoryRef: MEMORY_DEMO_REF } };
  },
};

const sampleUppercaseNode: NodeModule = {
  typeId: 'local.sample.demo.uppercase',
  version: '0.1.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    // Prefer the canonical `text` port, but fall back to any string-
    // valued input (and one level into nested objects). Templates that
    // wire `uppercase` downstream of a `chat` node with a sourcePort
    // mismatch — or that pass a whole outputs map under a single port
    // — would otherwise see undefined and produce an empty string.
    let text: string | undefined;
    if (typeof inputs.text === 'string') text = inputs.text;
    else text = findFirstStringValue(inputs);
    return { status: 'success', outputs: { text: (text ?? '').toUpperCase() } };
  },
};

/**
 * Provider-specific diagnostic for the 200 OK + no text case.
 * Prefers REAL provider-reported reasons (finishReason / blockReason
 * / safetyCategory) over heuristic guesses.
 */
function diagnoseEmptyCompletion(result: DispatchResult): string {
  const { provider, model, finishReason, blockReason, safetyCategory, usage } = result;
  const tail = ` [provider=${provider} model=${model}` +
    (finishReason ? ` finishReason=${finishReason}` : '') +
    (blockReason ? ` blockReason=${blockReason}` : '') +
    (safetyCategory ? ` safety=${safetyCategory}` : '') +
    (usage?.outputTokens != null ? ` outputTokens=${usage.outputTokens}` : '') +
    ']';

  // Authoritative reasons first.
  if (blockReason) {
    return `Prompt blocked by ${provider} (${blockReason}). Rephrase the prompt or check for sensitive content.${tail}`;
  }
  if (safetyCategory) {
    return `Output blocked by ${provider} safety filter (${safetyCategory}). Try rephrasing.${tail}`;
  }
  if (finishReason === 'MAX_TOKENS' || finishReason === 'length' || finishReason === 'max_tokens') {
    return `Model hit max-tokens before emitting visible text. Raise maxTokens (currently 4096) or switch to a model with a larger output cap.${tail}`;
  }
  if (finishReason === 'SAFETY' || finishReason === 'content_filter') {
    return `Output blocked by safety/content filter. Try rephrasing the prompt.${tail}`;
  }
  if (finishReason === 'RECITATION') {
    return `Output blocked because it matched training-data recitation. Rephrase to encourage paraphrasing.${tail}`;
  }
  if (finishReason === 'STOP' || finishReason === 'stop' || finishReason === 'end_turn') {
    // STOP + zero output is an oddity — most likely an internal-reasoning model
    // exhausted its budget before the visible-output phase started.
    if (provider === 'google' && model.includes('2.5-') && !model.includes('-lite')) {
      return `Gemini ${model} stopped cleanly with zero visible text. Most likely cause: internal reasoning consumed the maxOutputTokens budget before the visible-output phase began. Try \`gemini-2.5-flash-lite\` (no reasoning) or raise maxTokens >= 8192.${tail}`;
    }
    return `Provider stopped cleanly with zero visible text. Could be a model-side filter, an empty system-prompt edge case, or a tool-only response without text.${tail}`;
  }

  // No finishReason at all — likely a stream that terminated early (network
  // failure, server-side timeout) or a parsing bug.
  return `Provider returned 200 OK with no text and no finishReason. The stream may have terminated early, or the response shape didn't match what the dispatcher parses.${tail}`;
}

let registered = false;

export function ensureNodesRegistered(): void {
  if (registered) return;
  const registry = getNodeRegistry();
  registry.register(noopNode);
  registry.register(identityNode);
  registry.register(subWorkflowNode);
  registry.register(orchestratorSupervisorNode);
  registry.register(dispatchNode);
  // RFC: conformance-only typeId for runtime-capability refusal test.
  // Declares `requires` pointing at a capability the host never
  // provides. The executor's pre-execute capability check refuses
  // with `capability_not_provided`. Production deployments SHOULD
  // skip this registration (same posture as core.conformance.mock-agent).
  registry.register({
    typeId: 'conformance.requiresMissing',
    version: '1.0.0',
    requires: ['conformance.never-provided'],
    async execute() {
      // Unreachable: the host's capability check fails before this runs.
      return { status: 'success', outputs: {} };
    },
  });
  registry.register(channelWriteNode);
  // Conformance-only typeId for BYOK end-to-end. Resolves the
  // host-provisioned canary secret via the SecretResolver, emits
  // SHA-256 hex + byte length to variables. NEVER emits the raw
  // value. Production deployments SHOULD skip this registration.
  registry.register({
    typeId: 'conformance.secret.echo',
    version: '1.0.0',
    async execute(ctx) {
      const cfg = (ctx.config ?? {}) as { secretId?: unknown };
      const secretId = typeof cfg.secretId === 'string' ? cfg.secretId : '';
      if (!secretId) {
        return { status: 'failure', error: { code: 'invalid_request', message: 'conformance.secret.echo requires config.secretId' } };
      }
      const { resolveSecret } = await import('../byok/secretResolver.js');
      const value = await resolveSecret(secretId, { tenantId: ctx.tenantId });
      if (!value) {
        return {
          status: 'failure',
          error: { code: 'credential_unavailable', message: `Canary secret '${secretId}' not provisioned by host` },
        };
      }
      const { createHash } = await import('node:crypto');
      const sha256 = createHash('sha256').update(value).digest('hex');
      const { setRunVariable } = await import('../host/variablesRuntime.js');
      setRunVariable(ctx.runId, 'sha256', sha256);
      setRunVariable(ctx.runId, 'byteLength', value.length);
      return {
        status: 'success',
        outputs: { sha256, byteLength: value.length },
      };
    },
  });
  // Conformance-only typeId for cost-attribution allowlist enforcement
  // (`spec/v1/observability.md §"Cost attribution attributes"`). Fixture
  // configs ship arbitrary `attrs` (including non-allowlisted keys + a
  // credential-shaped canary). The node hands the raw map to
  // `emitRawCostAttrs`, which routes through `sanitizeCostForOtel` to
  // drop everything outside `OPENWOP_COST_ATTRIBUTE_NAMES`. The
  // conformance suite then reads the live OTel span and asserts the
  // span attrs ⊆ the allowlist (and that no credential canary leaked).
  // Production deployments SHOULD skip this registration.
  registry.register({
    typeId: 'conformance.cost.emit',
    version: '1.0.0',
    async execute(ctx) {
      const cfg = (ctx.config ?? {}) as { attrs?: unknown };
      const attrs = (cfg.attrs && typeof cfg.attrs === 'object' && !Array.isArray(cfg.attrs))
        ? (cfg.attrs as Record<string, unknown>)
        : {};
      const { emitRawCostAttrs, sanitizeCostForOtel, applyCostRollup } = await import('../observability/costEmitter.js');
      // Write sanitized attrs to the active OTel span AND fold the
      // numeric pieces into the per-run rollup so the snapshot's
      // metrics.openwopCost reflects them per
      // `run-snapshot.schema.json §metrics.openwopCost`.
      emitRawCostAttrs(attrs);
      applyCostRollup(ctx.runId, sanitizeCostForOtel(attrs));
      return { status: 'success', outputs: { emittedKeyCount: Object.keys(attrs).length } };
    },
  });
  // Conformance-only typeId for the RFC 0031 §B step 4 refusal path
  // (`model-capability-insufficient.test.ts` end-to-end branch). Declares
  // `requiredModelCapabilities: ['nonexistent-capability-9b3f']` —
  // intentionally outside the spec-reserved set so the executor's gate
  // check at executor.ts:230-289 ALWAYS refuses, emitting
  // `model.capability.insufficient` before `node.failed` per §D.
  // Production deployments SHOULD skip this registration.
  registry.register({
    typeId: 'conformance.modelCapability.insufficient',
    version: '1.0.0',
    requiredModelCapabilities: ['nonexistent-capability-9b3f'],
    async execute() {
      // Unreachable — gate refuses before this runs.
      return { status: 'success', outputs: {} };
    },
  });
  registry.register(delayNode);
  registry.register(failNode);
  registry.register(approvalGateNode);
  registry.register(clarificationGateNode);
  registry.register(interruptNode);
  registry.register(sampleUppercaseNode);
  registry.register(sampleImageEmitNode);
  registry.register(sampleMemoryWriteNode);
  registry.register(sampleMockAiNode);
  registry.register(sampleChatResponderNode);
  // RFC 0023 — conformance-only typeId for agent-event emission hooks.
  // Reference host always registers it; production deployments of this
  // codebase SHOULD remove this call + drop the
  // capabilities.conformance.mockAgent advertisement.
  registerMockAgentNode();
  registered = true;
}
