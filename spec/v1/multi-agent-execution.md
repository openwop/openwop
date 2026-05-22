# openwop Spec v1 — Multi-Agent Execution Model

> **Status: DRAFT v1.x (filed via [RFC 0037](../../RFCS/0037-multi-agent-execution-model.md), 2026-05-21).** Phase 1 of a four-phase execution-model formalization. Phase 1 (this document) lands the **execution-loop framework + planner→worker handoff state machine**. Phases 2 (confidence + agent-memory lifecycle), 3 (cross-host causation), and 4 (replay determinism under nondeterministic models) are explicit follow-ups tracked in `## Open spec gaps`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

Per the external standards-readiness review of 2026-05-21, finding (3): *"OpenWOP defines identities, dispatch, memory, reasoning events, envelopes, prompts, MCP/A2A composition, and host capabilities, but it does not yet give a sufficiently formal interoperable execution model for planner/worker handoff, confidence semantics, agent memory lifecycle, cross-host causality, and replay under nondeterministic model behavior."*

The existing RFCs cover slices but no single doc states the **execution model** as a portable contract:

- **RFC 0002** (`AgentRef` + reasoning events) — the identity vocabulary.
- **RFC 0006** (`core.orchestrator.supervisor`) — the supervisor primitive that emits `OrchestratorDecision`.
- **RFC 0007** (`core.dispatch`) — the dispatcher primitive that materializes the decision as a child run.
- **RFC 0022** (`inputMapping` / `outputMapping`) — the variable-projection contract across the parent/child boundary.
- **RFC 0024** (reasoning streaming) — the wire shape for `agent.reasoning.delta` events.
- **RFC 0026** (provider usage events) — the cost-attribution surface.

This document **integrates** those slices into a single normative execution loop + a 4-state handoff state machine. The design goal is portability: two non-steward hosts implementing this Phase 1 against the same supervisor-driven workflow input produce identical transition-event sequences (same phases, same causation chain) — the §"Cross-region replay" claim in `replay.md` extends this guarantee across regions on hosts that also advertise the RFC 0036 capabilities.

## Execution loop (normative)

A host that advertises `capabilities.multiAgent.executionModel.version >= 1` MUST implement the following loop on any workflow whose graph contains a `core.orchestrator.supervisor` node feeding into a `core.dispatch` node:

```
LOOP:
  1. Orchestrator turn:
     - Run the supervisor node per its config (`mockDispatchPlan` in conformance,
       `prompt` + `model` in production).
     - The supervisor emits exactly one `OrchestratorDecision` per turn:
         next-worker  | terminate | clarify | escalate
     - Engine appends `runOrchestrator.decided` event with the decision payload.

  2. Decision routing:
     - `terminate` → exit LOOP; engine emits `run.completed` per spec/v1/replay.md.
     - `clarify` → emit `interrupt` per spec/v1/interrupt.md `kind: "clarification"`;
       LOOP suspends until resume.
     - `escalate` → emit `interrupt` per spec/v1/interrupt.md `kind: "approval"`;
       LOOP suspends until resume.
     - `next-worker` → enter HANDOFF STATE MACHINE below for each worker
       in `decision.nextWorkerIds[]`.

  3. After all dispatched workers reach `harvested` (or `failed` / `cancelled`),
     return to step 1.
```

The loop MUST be re-entrant per `spec/v1/replay.md` §"Determinism with non-deterministic agents" — replaying from `fromSeq` after the Nth iteration MUST produce identical state at that index regardless of cross-region engine handoff (when `capabilities.eventLog.crossEngineOrdering.supported: true` per RFC 0036) or worker dispatch timing (when `capabilities.agents.dispatchMapping: true` per RFC 0022).

## Handoff state machine (normative)

When a supervisor's decision is `next-worker` and the engine begins dispatching, each dispatched worker MUST traverse the following 4-state machine:

| State | Trigger | Allowed exits |
|---|---|---|
| `pending` | Supervisor's `OrchestratorDecision` named the worker; dispatch hasn't yet fired the child-run create | → `dispatching` (engine begins child-run creation) |
| `dispatching` | Engine called `POST /v1/runs` (or sub-workflow equivalent) for the child | → `running` (`201 Created` returned + `inputMapping` projection emitted) <br> → `failed` (creation failed before child ran any node) |
| `running` | Child run is in progress | → `completed` (terminal status) <br> → `failed` (terminal status) <br> → `cancelled` (terminal status) |
| `harvested` | Child reached terminal `completed` AND non-empty `outputMapping` projection completed back into parent variables | (terminal — parent's next supervisor turn observes the new state) |

### Transition events (normative)

Each transition MUST emit a `core.workflowChain.event` (NEW event type — see §"Event-payload addition" below) with `causationId` linking to the prior transition's `eventId`. The chain is REQUIRED so replay-determinism gates per `spec/v1/replay.md` §"Determinism with non-deterministic agents" can walk the causation chain backward through handoff sequences.

| Transition | Event payload `phase` | `causationId` |
|---|---|---|
| `pending → dispatching` | `"dispatch.began"` | The `runOrchestrator.decided` event's `eventId` |
| `dispatching → running` | `"dispatch.succeeded"` | The `dispatch.began` `eventId` |
| `dispatching → failed` | `"dispatch.failed"` | The `dispatch.began` `eventId` |
| `running → completed` | `"child.completed"` | The `dispatch.succeeded` `eventId` |
| `running → failed` | `"child.failed"` | The `dispatch.succeeded` `eventId` |
| `running → cancelled` | `"child.cancelled"` | The `dispatch.succeeded` `eventId` |
| `completed → harvested` | `"output.harvested"` | The `child.completed` `eventId`; payload SHOULD include the `outputMapping` keys harvested |

The transition `running → harvested` MUST happen exactly when the child reaches a terminal `completed` AND the dispatch config's `outputMapping` is non-empty. Failed/cancelled children MUST skip the harvest per RFC 0022 §B (the `output.harvested` event MUST NOT fire for those terminal states).

## Confidence escalation (RFC 0039 Phase 2, normative)

Per [RFC 0039](../../RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md) §A. Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 2`.

An `OrchestratorDecision` MAY carry an optional `confidence: number` field in `[0, 1]` where `0` is uncertain and `1` is fully confident. When `confidence < floor` (where `floor = capabilities.multiAgent.executionModel.confidenceEscalationFloor` if advertised; otherwise the spec floor `0.5`) AND the decision kind is `next-worker` or `terminate`, the host SHALL **either**:

- (a) escalate the decision via a `clarify` interrupt per `spec/v1/interrupt.md` `kind: "clarification"` (preferred — gives the user an in-the-loop chance to confirm or adjust); **OR**
- (b) escalate via an `escalate` interrupt requesting approval per `spec/v1/interrupt-profiles.md` §"Approval profile" (sufficient when the host doesn't expose a clarification UI).

Hosts MUST NOT silently execute a `confidence < floor` decision without first recording the escalation event AND firing the matching interrupt. The escalation event is `core.workflowChain.confidence-escalated` (see §"Event-payload addition" below) and MUST appear in the run event log BEFORE the interrupt fires AND BEFORE any `core.workflowChain.event` with `phase: "dispatch.began"` for the escalated decision's intended next-worker.

**Floor rationale (normative).** 0.5 is the maximum-entropy threshold — the value where a Bayesian observer with no prior has no preference between accept and clarify. Below it, silent execution would commit the workflow to an outcome the supervisor itself rates as less-than-arbitrary. Operator policy stricter than 0.5 advertises via `confidenceEscalationFloor`; the spec floor of 0.5 is non-configurable across hosts so cross-host workflows have a portable lower bound. See `RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md` §A "Why 0.5" for the full rationale.

**`confidence` field absence.** When the decision's `confidence` is absent (`undefined` / not emitted), the host MUST NOT escalate on this rule alone — `confidence === undefined` means "no opinion stated," not "low confidence." Operators wanting opt-in always-escalate behavior advertise a separate host-extension flag; this is not normated here.

## Agent memory lifecycle across sub-runs (RFC 0039 Phase 2, normative)

Per [RFC 0039](../../RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md) §B. Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 2` AND `capabilities.memory.supported: true`.

### Cross-run memory inheritance (MAE-2)

When a parent run dispatches a child run via `core.dispatch` or `core.subWorkflow`, the child's `MemoryAdapter` MUST be scoped per-(tenantId, scopeId) per `agent-memory.md` §CTI-1 (cross-tenant invariant). Child runs MAY share the parent's `scopeId` (default — inherit) or declare a fresh `scopeId` (opt-in via the dispatch config's `memoryScopeIsolation: "isolated"` field, additive). When the child shares the parent's `scopeId`:

1. `MemoryEntry` records the child writes are visible to the parent on the child's terminal `completed` AND any subsequent parent supervisor turn — the same single-host visibility contract as intra-run memory operations.
2. `MemoryEntry.ttl` MUST be anchored at the child's wall-clock write time, NOT the parent's start time. A child writing `MemoryEntry { ttl: 3600 }` at parent-clock T+10s expires at T+3610s (child write time + ttl), NOT T+3600s. **Why child-write-time wins:** TTL is an absolute freshness contract on the datum ("this value is valid for N seconds after I wrote it"), not a budget against an enclosing run lifetime. Parent runs that need longer-lived shared memory write directly to the shared scope under their own clock.
3. The parent's subsequent supervisor turn observing the child's MemoryEntry MUST NOT race a still-running sibling dispatch's writes — host MUST serialize cross-child writes per parent-run, OR advertise `capabilities.multiAgent.executionModel.crossChildMemoryConcurrency: "advisory"` to opt out of the serialization MUST (advisory hosts SHOULD document last-write-wins semantics out-of-band).

### Replay carry-forward (MAE-3)

When a `POST /v1/runs/{runId}:fork` invocation forks from a past event-log index N, the forked run's `MemoryAdapter.get(key)` calls before reaching index N MUST return the value that was in memory **AT THE ORIGINAL RUN'S TIME OF INDEX N** — NOT the current memory state.

Hosts MUST persist memory snapshots tied to event-log indices when `capabilities.multiAgent.executionModel.version >= 2` AND `capabilities.memory.supported: true` are both advertised. The snapshot mechanism is host-internal (e.g., periodic copy-on-write checkpoints, append-only journal with reverse-projection on memory-write operations, per-write snapshot rows). Hosts that cannot satisfy the snapshot at the requested `fromSeq` MUST refuse the fork with `error.code: "replay_memory_snapshot_unavailable"` per `spec/v1/rest-endpoints.md` §"Common error codes". `error.details.fromSeq` SHOULD identify the requested index; `error.details.oldestAvailableIdx` MAY identify the oldest index for which a snapshot exists (lets clients pick a valid fork point).

### Conformance gating

Scenarios verifying §"Cross-run memory inheritance" + §"Replay carry-forward" gate on the conjunction `capabilities.multiAgent.executionModel.version >= 2 && capabilities.memory.supported: true`. Hosts that advertise either alone skip cleanly.

## Cross-host causation (RFC 0040 Phase 3, normative)

Per [RFC 0040](../../RFCS/0040-multi-agent-cross-host-causation.md). Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 3` AND `capabilities.multiAgent.executionModel.crossHostCausation.supported: true`.

### `causationHostId` payload field (normative)

Hosts MUST emit an optional `causationHostId: string` field on event payloads whose top-level `causationId` points at an event on a DIFFERENT host than the emitting host. The field's value MUST equal the originating host's `capabilities.multiAgent.executionModel.crossHostCausation.hostId` advertisement.

When the `causationId` points at an event on the SAME host, `causationHostId` MUST be absent (preserves existing single-host semantics; pre-Phase-3 consumers ignore unknown fields).

Affected payload types (additive): `coreWorkflowChainEvent`, `coreWorkflowChainConfidenceEscalated`, `agentReasoned`, `agentToolCalled`, `agentToolReturned`, `agentHandoff`, `agentDecided`, `runOrchestratorDecided`, `promptComposed`, `agentPromptResolved`. The field is OPTIONAL on every shape.

### W3C tracecontext across MCP + A2A composition (normative)

Hosts that dispatch MCP tool calls AND advertise `multiAgent.executionModel.version >= 3` MUST inject the parent run's W3C `traceparent` header into the outbound MCP request envelope. The MCP tool's host MUST honor the inbound `traceparent` as the parent trace for any spans it emits.

The same rule applies symmetrically to A2A composition (`spec/v1/a2a-integration.md`): outbound A2A messages MUST carry the parent run's `traceparent`; inbound A2A handlers MUST adopt it as the trace parent.

This extends the per-host trace propagation already covered by RFC 0023 (`otel-trace-propagation-subworkflow.test.ts`) to cross-host composition.

### `GET /v1/runs/{runId}/ancestry` endpoint (normative)

Hosts advertising `crossHostCausation.ancestryEndpointSupported: true` MUST serve `GET /v1/runs/{runId}/ancestry` returning `RunAncestryResponse` per `schemas/run-ancestry-response.schema.json`. The endpoint surfaces the run's immediate parent (NOT the full chain — clients walk the chain by following `parent.wellKnownUrl` per response, one hop at a time). Top-level runs return `parent: null`.

Hosts that advertise `crossHostCausation.supported: true` but NOT the ancestry endpoint return `404 not_found` from the endpoint; clients reconstruct chains by walking `causationHostId` fields on individual events instead.

## Phase 4 replay determinism (RFC 0041, normative)

Per [RFC 0041](../../RFCS/0041-multi-agent-replay-under-nondeterminism.md). Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 4` AND `capabilities.multiAgent.executionModel.replayDeterminism.supported: true`. Closes RFC 0037 §"Open spec gaps" MAE-7 + MAE-8 + MAE-9.

The normative contracts live in [`replay.md`](./replay.md) §"Replay determinism under nondeterministic models (RFC 0041 Phase 4, normative)":

- §A — LLM cache-key recipe promotion (informative → normative when version >= 4). Hosts MUST compute the LLM cache key per the recipe in `replay.md` §"LLM cache-key recipe" §A + §B + §C exactly.
- §B — Envelope-refusal recovery: replay-time refusal-divergence MUST emit `replay.divergedAtRefusal` and fail with `error.code: "replay_diverged_at_refusal"`. Silent substitution is non-conformant.
- §C — Observable-output-sequence determinism: the contract is byte-equivalence at the event-log + RunSnapshot boundary, NOT bit-equivalent execution of underlying tool calls. Hosts cache the observable result, not just the tool-call bytes.

## Capability advertisement (normative)

```jsonc
{
  "capabilities": {
    "multiAgent": {
      "executionModel": {
        "supported": true,
        "version": 1
      }
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `supported` | `boolean` | When `true`, the host implements the execution loop + handoff state machine above. Conformance scenarios gating on this flag run unconditionally on advertising hosts. |
| `version` | `integer ≥ 1` | Profile version. `1` = Phase 1 (this document — execution-loop framework + planner→worker handoff). Future phases bump (2 = confidence + agent-memory lifecycle; 3 = cross-host causation; 4 = replay-under-nondeterminism). A host advertising `version: N` MUST implement all phases 1..N. |

Hosts that do NOT advertise this capability MAY implement RFCs 0006/0007/0022 individually with implementation flexibility on the integration semantics; conformance scenarios gating on this flag soft-skip on absence per the existing capability-gating convention.

## Event-payload addition

`schemas/run-event-payloads.schema.json` gains a new event type entry `core.workflowChain.event` with payload shape:

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["phase", "workerId", "parentRunId"],
  "properties": {
    "phase": {
      "type": "string",
      "enum": [
        "dispatch.began",
        "dispatch.succeeded",
        "dispatch.failed",
        "child.completed",
        "child.failed",
        "child.cancelled",
        "output.harvested"
      ],
      "description": "Which handoff-state-machine transition this event records. See spec/v1/multi-agent-execution.md §'Handoff state machine'."
    },
    "workerId": {
      "type": "string",
      "minLength": 1,
      "description": "The dispatched worker's workflowId — matches the entry in the supervisor's OrchestratorDecision.nextWorkerIds[]."
    },
    "parentRunId": {
      "type": "string",
      "minLength": 1,
      "description": "The orchestrator-driven parent run's runId."
    },
    "childRunId": {
      "type": "string",
      "minLength": 1,
      "description": "The dispatched child run's runId. REQUIRED on phases `dispatch.succeeded` and beyond; absent on `dispatch.began` and `dispatch.failed` (child wasn't created)."
    },
    "harvestedKeys": {
      "type": "array",
      "items": { "type": "string" },
      "description": "On phase `output.harvested`: which parent-variable keys were populated by the dispatch config's outputMapping per RFC 0022 §A. SHOULD be present; conformance asserts presence when outputMapping is non-empty."
    },
    "error": {
      "type": "object",
      "description": "On phases `dispatch.failed` / `child.failed` / `child.cancelled`: the canonical error envelope per spec/v1/auth.md §'Canonical error envelope'.",
      "additionalProperties": true
    }
  }
}
```

Hosts that do NOT advertise `capabilities.multiAgent.executionModel.supported: true` MUST NOT emit this event (the event is the wire signature of the contract being advertised).

## Open spec gaps

| # | Gap | Phase | Owner |
|---|---|---|---|
| MAE-1 | **Phase 2:** Confidence-threshold semantics — at what `OrchestratorDecision.confidence` value MUST the supervisor escalate to clarification or approval, versus MAY escalate? Today: host policy. | Phase 2 follow-up | OpenWOP WG |
| MAE-2 | **Phase 2:** Agent memory lifecycle across sub-runs — `MemoryEntry.ttl` semantics when a parent run dispatches a child whose memory operations the parent inherits. Today: implicit; needs normative MUST. | Phase 2 follow-up | OpenWOP WG |
| MAE-3 | **Phase 2:** Memory carry-forward when a sub-run is replayed from past event-log index — does the replay re-read the original memory snapshot, or the current memory state? | Phase 2 follow-up | OpenWOP WG |
| MAE-4 | **Phase 3:** Extending `causationId` to span hosts (currently single-host scope per `spec/v1/replay.md` §"Determinism with non-deterministic agents"). | Phase 3 follow-up | OpenWOP WG |
| MAE-5 | **Phase 3:** W3C tracecontext propagation across MCP/A2A composition boundaries — partial coverage in `RFC 0023` for OTel; needs normative cross-host case. | Phase 3 follow-up | OpenWOP WG |
| MAE-6 | **Phase 3:** Cross-host run-ID resolution — when host A's run dispatches to host B, what's the discoverable identifier chain? | Phase 3 follow-up | OpenWOP WG |
| MAE-7 | **Phase 4:** LLM cache-key recipe — `replay.md` §"LLM cache-key recipe" already exists but `replay-llm-cache-key.test.ts` is shape-only per `docs/KNOWN-LIMITS.md:18`. | Phase 4 follow-up | OpenWOP WG |
| MAE-8 | **Phase 4:** Recovery from envelope refusal in replay context — original run got envelope, replay gets refusal. | Phase 4 follow-up | OpenWOP WG |
| MAE-9 | **Phase 4:** Determinism vs idempotency — replay produces the same observable output sequence even when underlying tool calls differ. | Phase 4 follow-up | OpenWOP WG |

## References

- [`RFCS/0037-multi-agent-execution-model.md`](../../RFCS/0037-multi-agent-execution-model.md) — the source RFC.
- [`RFCS/0002-agent-identity-and-reasoning-events.md`](../../RFCS/0002-agent-identity-and-reasoning-events.md) — `AgentRef` + reasoning event vocabulary.
- [`RFCS/0006-orchestrator.md`](../../RFCS/0006-orchestrator.md) — `core.orchestrator.supervisor` primitive.
- [`RFCS/0007-dispatch.md`](../../RFCS/0007-dispatch.md) — `core.dispatch` primitive.
- [`RFCS/0022-dispatch-input-output-mapping.md`](../../RFCS/0022-dispatch-input-output-mapping.md) — `inputMapping` / `outputMapping` contract.
- [`RFCS/0024-agent-reasoning-streaming.md`](../../RFCS/0024-agent-reasoning-streaming.md) — `agent.reasoning.delta` event vocabulary.
- [`RFCS/0026-provider-usage-event.md`](../../RFCS/0026-provider-usage-event.md) — cost-attribution surface.
- [`spec/v1/replay.md`](./replay.md) §"Determinism with non-deterministic agents" — the replay contract this execution model preserves.
- [`spec/v1/positioning.md`](./positioning.md) — "we don't standardize orchestration topology" — the principle this RFC's `executionModel.version` flag respects (the framework is opt-in; non-advertising hosts retain full implementation flexibility).
- External standards-readiness review 2026-05-21 — finding (3).
