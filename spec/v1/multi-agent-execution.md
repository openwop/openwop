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

This document **integrates** those slices into a single normative execution loop + a 4-state handoff state machine. Two non-steward hosts implementing this Phase 1 should produce bit-equivalent state transitions for the same supervisor-driven workflow input.

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

The loop MUST be re-entrant per `spec/v1/replay.md` §"Determinism with non-deterministic agents" — replaying from `forkAtEventLogIdx` after the Nth iteration MUST produce identical state at that index regardless of cross-region engine handoff (when `capabilities.eventLog.crossEngineOrdering.supported: true` per RFC 0036) or worker dispatch timing (when `capabilities.agents.dispatchMapping: true` per RFC 0022).

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
