# RFC 0039: Multi-agent Phase 2 — confidence-threshold escalation + agent memory lifecycle

| Field | Value |
|---|---|
| **RFC** | 0039 |
| **Title** | Multi-agent execution model Phase 2: confidence-threshold escalation + agent memory lifecycle across sub-runs and replay |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-21 |
| **Updated** | 2026-05-22 (Draft → Active: confidence-floor escalation half landed atomically. `schemas/capabilities.schema.json` extends `multiAgent.executionModel` with optional `confidenceEscalationFloor` (range [0.5, 1.0]) + `crossChildMemoryConcurrency` (enum strict|advisory) fields; `schemas/run-event.schema.json` adds `core.workflowChain.confidence-escalated` to the RunEventType enum (63 variants total); `schemas/run-event-payloads.schema.json` adds `coreWorkflowChainConfidenceEscalated` payload schema with required `{confidence, floor, escalationKind, workerId, parentRunId}`. `spec/v1/multi-agent-execution.md` gains §"Confidence escalation (RFC 0039 Phase 2, normative)" inlining the §A MUSTs. Reference workflow-engine: `core.dispatch` gates on the floor BEFORE entering the per-worker loop; emits the escalation event with `causationId` chained back to `runOrchestrator.decided`; suspends with `interrupt.kind: 'clarification'`. Discovery advertises `version: 2` + `confidenceEscalationFloor: 0.5` (default) under `OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_2=true`. Behavioral conformance `multi-agent-confidence-escalation.test.ts` + fixture `conformance-multi-agent-confidence-escalation.json` land alongside; assert exactly one `confidence-escalated` event, zero `core.workflowChain.event` records (no dispatch), parent suspends with clarification, payload shape per `coreWorkflowChainConfidenceEscalated` schema. Memory-lifecycle half (MAE-2/3) — `crossChildMemoryConcurrency` field is schema-landed but not yet wired in the host's MemoryAdapter; replay snapshot mechanism + `replay_memory_snapshot_unavailable` error code remain explicit follow-up. Path to `Accepted`: a non-steward host advertises `version: 2` + the behavioral conformance passes against it.) |
| **Affects** | `spec/v1/multi-agent-execution.md` (extends with §"Confidence escalation" + §"Agent memory lifecycle") · `spec/v1/agent-memory.md` (adds §"Sub-run lifecycle + replay carry-forward") · `schemas/capabilities.schema.json` (bumps `multiAgent.executionModel.version` ceiling for v2 from 1 to 2; no required-field changes) · `schemas/run-event-payloads.schema.json` (additive shape clarifications on `runOrchestrator.decided` + `memory.compacted`) · 3 new conformance scenarios · `INTEROP-MATRIX.md` · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Closes 3 open spec gaps from [RFC 0037](./0037-multi-agent-execution-model.md) §"Open spec gaps":

- **MAE-1** (`confidence-threshold escalation`): when does a supervisor's `OrchestratorDecision.confidence < N` MUST escalate to clarification or approval, versus MAY escalate per host policy?
- **MAE-2** (`MemoryEntry.ttl across sub-runs`): when a parent run dispatches a child whose memory operations the parent inherits, what happens to `MemoryEntry.ttl`?
- **MAE-3** (`memory carry-forward in replay`): when a sub-run is replayed from a past event-log index, does the replay re-read the original memory snapshot at the fork point, or the current memory state?

All three resolutions are additive to the v1.x wire surface. Bumps the executionModel profile from `version: 1` (Phase 1) to `version: 2` (Phase 2). Phase 1 hosts continue to advertise `version: 1` unchanged; hosts that implement Phase 2 advertise `version: 2` and conform to additional MUSTs.

## Motivation

RFC 0037 Phase 1 normated the execution loop + handoff state machine but explicitly deferred three contracts that hosts handle ad-hoc today. Cross-host implementations can't interoperate on multi-agent workflows that touch confidence escalation OR cross-run memory unless these contracts are nailed down.

The standards-readiness review of 2026-05-21 finding (3) explicitly called out these three areas as part of the broader "multi-agent semantics not fully portable" gap. RFC 0037 closed the dispatch-and-handoff part; this RFC closes the confidence + memory part. Phases 3 (cross-host causation) and 4 (replay-under-nondeterminism) remain explicit follow-ups for future RFCs.

## Proposal

### §A — Confidence-threshold escalation (normative)

Add a new §"Confidence escalation" to `spec/v1/multi-agent-execution.md` after §"Handoff state machine":

> An `OrchestratorDecision` MAY carry an optional `confidence: number` field in `[0, 1]` where `0` is uncertain and `1` is fully confident. Hosts that advertise `capabilities.multiAgent.executionModel.version >= 2` MUST honor the following floor: when `confidence < 0.5` AND the decision kind is `next-worker` or `terminate`, the host SHALL **either** (a) escalate the decision via a `clarify` interrupt (preferred — gives the user an in-the-loop chance to confirm or adjust) **OR** (b) escalate via an `escalate` interrupt requesting approval per `spec/v1/interrupt-profiles.md` §"Approval profile" (sufficient when the host doesn't expose a clarification UI). Hosts MUST NOT silently execute a `confidence < 0.5` decision without recording the escalation event.
>
> **Why 0.5 (normative rationale).** 0.5 is the maximum-entropy threshold: the value where a Bayesian observer with no prior has no preference between accept and clarify. Below it, the supervisor's stated confidence is strictly worse than a coin flip — silently executing the decision would commit the workflow to an outcome the supervisor itself rates as less-than-arbitrary. Lower fixed floors (e.g., 0.3) let marginally-confident decisions proceed with no audit trail; higher fixed floors (e.g., 0.7) would force escalation on partial-information decisions that are still net-positive. 0.5 is the only floor that admits a single defensible justification ("escalate when the supervisor's stated confidence does not exceed entropy") and is therefore the cross-host-portable lower bound. Operator policy stricter than 0.5 advertises via `confidenceEscalationFloor` so downstream clients can route accordingly; the spec floor stays at 0.5 to preserve a portable interop guarantee.
>
> Hosts MAY apply stricter floors (e.g., escalate at `< 0.7`) per operator policy. The 0.5 value is the FLOOR — below it escalation is REQUIRED. The floor is fixed at 0.5 (not configurable in the wire surface) so cross-host workflows have a portable lower bound; operator-side stricter policy is a host-extension concern and SHOULD be advertised under `capabilities.multiAgent.executionModel.confidenceEscalationFloor` for transparency:
>
> ```jsonc
> {
>   "capabilities": {
>     "multiAgent": {
>       "executionModel": {
>         "supported": true,
>         "version": 2,
>         "confidenceEscalationFloor": 0.7  // host policy stricter than the 0.5 spec floor
>       }
>     }
>   }
> }
> ```
>
> When `confidenceEscalationFloor` is absent, the spec-floor of 0.5 applies. The field MUST satisfy `0.5 <= confidenceEscalationFloor <= 1.0` — values below the spec floor are non-conformant.
>
> The escalation MUST emit a new event `core.workflowChain.confidence-escalated` (additive RunEventType per §D below) before the interrupt fires, so the run event log carries the decision point even if the user later confirms the original decision.

### §B — Agent memory lifecycle across sub-runs (normative)

Add a new §"Sub-run lifecycle + replay carry-forward" to `spec/v1/agent-memory.md` after §"SR-1 secret-redaction invariant":

> **Cross-run inheritance (MAE-2 closure).** When a parent run dispatches a child run via `core.dispatch` or `core.subWorkflow`, the child's `MemoryAdapter` MUST be scoped per-(tenantId, scopeId) per CTI-1; CHILD runs MAY share the parent's scopeId (default — inherit) or declare a fresh scopeId (opt-in via the dispatch config's `memoryScopeIsolation: "isolated"` field, additive). When the child shares the parent's scopeId:
> 1. `MemoryEntry` records the child writes are visible to the parent on the child's terminal `completed` AND any subsequent parent supervisor turn — the same single-host visibility contract as intra-run memory operations.
> 2. `MemoryEntry.ttl` is computed from the child's wall-clock write time, NOT the parent's start time. A child writing `MemoryEntry { ttl: 3600 }` at parent-clock T+10s expires at T+3610s (child write time + ttl), NOT T+3600s.
>
>     **Why child-write-time wins (normative rationale).** TTL is an absolute freshness contract on the datum ("this value is valid for N seconds after I wrote it"), not a budget against an enclosing run lifetime. A long-running parent that dispatches many short-lived children would otherwise see all child writes share a single TTL anchor at parent-start, causing batch expiry instead of staggered expiry — surprising for any cache-like workload. Parent runs that need longer-lived shared memory write directly to the shared scope under their own clock; child runs inherit visibility but not lifetime ownership. This matches the SR-1 "secret-redaction at write time" invariant pattern (`agent-memory.md` §SR-1): the writer's clock is the contract, not the enclosing context's.
>
> 3. The parent's subsequent supervisor turn observing the child's MemoryEntry MUST NOT race a still-running sibling dispatch's writes — host MUST serialize cross-child writes per parent-run, OR advertise `capabilities.multiAgent.executionModel.crossChildMemoryConcurrency: "advisory"` to opt out of the serialization MUST (advisory hosts SHOULD still document last-write-wins semantics).
>
> **Replay carry-forward (MAE-3 closure).** When a `POST /v1/runs/{runId}:fork` invocation forks from a past event-log index N, the forked run's `MemoryAdapter.get(key)` calls before reaching index N MUST return the value that was in memory AT THE ORIGINAL RUN'S TIME OF INDEX N — NOT the current memory state. Hosts MUST persist memory snapshots tied to event-log indices when `capabilities.multiAgent.executionModel.version >= 2` is advertised; the snapshot mechanism is host-internal (e.g., periodic copy-on-write checkpoints, append-only journal with reverse-projection, etc.). A host that cannot satisfy the snapshot MUST refuse forks from indices where the snapshot is unavailable with `error.code: "replay_memory_snapshot_unavailable"` per `spec/v1/rest-endpoints.md` §"Common error codes" (NEW code in §C below).

### §C — Error code: `replay_memory_snapshot_unavailable` (additive to `rest-endpoints.md`)

Add to `spec/v1/rest-endpoints.md` §"Common error codes":

- `replay_memory_snapshot_unavailable` — RFC 0039 §B. The host advertises `capabilities.multiAgent.executionModel.version >= 2` but cannot serve the memory snapshot for the requested `forkAtEventLogIdx`. `details.forkAtEventLogIdx` SHOULD identify the requested index; `details.oldestAvailableIdx` MAY identify the oldest index for which a snapshot exists (lets clients pick a valid fork point).

### §D — New RunEventType: `core.workflowChain.confidence-escalated`

Extend `schemas/run-event.schema.json` `RunEventType` enum:

```diff
   "memory.compacted",
-  "core.workflowChain.event"
+  "core.workflowChain.event",
+  "core.workflowChain.confidence-escalated"
```

Add to `schemas/run-event-payloads.schema.json`:

```jsonc
{
  "coreWorkflowChainConfidenceEscalated": {
    "type": "object",
    "additionalProperties": false,
    "required": ["confidence", "floor", "escalationKind"],
    "properties": {
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
      "floor": { "type": "number", "minimum": 0.5, "maximum": 1 },
      "escalationKind": { "type": "string", "enum": ["clarify", "escalate"] },
      "originalDecision": { "type": "object", "description": "The OrchestratorDecision that triggered escalation." }
    }
  }
}
```

Hosts MUST NOT emit this event unless they advertise `capabilities.multiAgent.executionModel.version >= 2`.

## Compatibility

**Additive.** Hosts advertising `version: 1` continue exactly as today. Hosts upgrading to `version: 2` opt into the additional MUSTs (confidence floor, memory cross-run + replay contracts, the new error code, the new event type). The new `confidenceEscalationFloor` field is optional; the new `crossChildMemoryConcurrency: "advisory"` field is optional and unlocks an opt-out from the serialization MUST.

The new RunEventType is additive per the existing forward-compat rule (`run-event.schema.json` consumers MUST tolerate unknown types). The new error code is additive per the existing forward-compat rule on `rest-endpoints.md` §"Common error codes."

## Conformance

3 new conformance scenarios:

- `multi-agent-confidence-floor.test.ts` — capability-gated on `multiAgent.executionModel.version >= 2`. Drives a fixture with a supervisor configured to emit `OrchestratorDecision { confidence: 0.3, kind: 'next-worker' }`; asserts the host emits `core.workflowChain.confidence-escalated` AND fires an interrupt (kind: `clarify` OR `approval`) BEFORE the worker dispatches.
- `agent-memory-cross-run-ttl.test.ts` — capability-gated. Drives a fixture where a child writes `MemoryEntry { ttl: 5 }`; asserts the parent's subsequent read sees the value and `expiresAt` reflects child-write-time + 5s (not parent-start-time + 5s).
- `replay-memory-snapshot.test.ts` — capability-gated. Forks a run from a past event-log index AND asserts `MemoryAdapter.get` returns the value at index-N snapshot (not current state). Soft-skip on hosts that haven't wired the snapshot mechanism.

## Alternatives considered

1. **Make the 0.5 confidence floor configurable in the wire spec rather than fixed.** Rejected — portability requires a single agreed floor; per-host floors make cross-host workflows non-portable. Operators wanting stricter policy advertise the stricter floor explicitly via `confidenceEscalationFloor` so clients can route accordingly.
2. **Make cross-run memory isolation the default + opt-in to inheritance.** Rejected — inheritance is the empirically more common pattern (multi-agent workflows typically share knowledge); making isolation opt-in via `memoryScopeIsolation: "isolated"` matches the pre-RFC-0039 implicit posture and avoids breaking existing parent/child workflows.
3. **Defer MAE-3 (replay snapshot) to Phase 4 (replay-under-nondeterminism).** Rejected — MAE-3 is about deterministic *memory state* across replay, which is well-defined and doesn't require the broader nondeterminism work. Folding the easier piece in Phase 2 lets Phase 4 focus on the harder LLM-determinism contracts.

## Unresolved questions

1. **Memory snapshot retention policy.** Hosts MUST persist snapshots when `version >= 2` but the spec doesn't normate retention duration. Recommend: align with `replay.md` §"Retention and garbage collection" — snapshots persist as long as the event log they index against persists. Defer to Acceptance criteria.
2. **`crossChildMemoryConcurrency: "advisory"` opt-out semantics.** Spec says hosts SHOULD document last-write-wins; does "document" mean wire-advertised or out-of-band? Recommend: wire-advertise via `multiAgent.executionModel.crossChildMemoryConcurrencyResolution: "last-writer-wins" | "first-writer-wins"` in a follow-up clarification if adoption surfaces the need.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [ ] `spec/v1/multi-agent-execution.md` extended with §"Confidence escalation" per §A.
- [ ] `spec/v1/agent-memory.md` extended with §"Sub-run lifecycle + replay carry-forward" per §B.
- [ ] `spec/v1/rest-endpoints.md` §"Common error codes" gains `replay_memory_snapshot_unavailable` per §C.
- [ ] `schemas/run-event.schema.json` RunEventType enum gains `core.workflowChain.confidence-escalated`.
- [ ] `schemas/run-event-payloads.schema.json` gains the matching payload schema.
- [ ] `schemas/capabilities.schema.json` extends `multiAgent.executionModel` with optional `confidenceEscalationFloor` + `crossChildMemoryConcurrency` fields; bumps the `version` upper bound from 4 to 4 (unchanged — Phases 2/3/4 share the [1,4] range).
- [ ] 3 new conformance scenarios per §Conformance.
- [ ] At least one reference host advertises `version: 2` + passes the 3 scenarios.
- [ ] `INTEROP-MATRIX.md` updated.
- [ ] CHANGELOG entry under `[Unreleased]`.

Path to `Active → Accepted`: cross-host advertisement evidence per `RFCs/0001-rfc-process.md` §"Promotion to Accepted."

## References

- [`RFCS/0037-multi-agent-execution-model.md`](./0037-multi-agent-execution-model.md) §"Open spec gaps" MAE-1, MAE-2, MAE-3 (the gaps this RFC closes).
- [`spec/v1/multi-agent-execution.md`](../spec/v1/multi-agent-execution.md) (the doc this RFC extends).
- [`spec/v1/agent-memory.md`](../spec/v1/agent-memory.md) §"SR-1 secret-redaction invariant" + §"MemoryAdapter contract" (the doc this RFC extends for §B).
- [`spec/v1/replay.md`](../spec/v1/replay.md) §"Retention and garbage collection" (the contract MAE-3's snapshot retention aligns with).
- [`spec/v1/interrupt-profiles.md`](../spec/v1/interrupt-profiles.md) §"Approval profile" (the interrupt kind §A's escalation MAY use).
- External standards-readiness review 2026-05-21 — finding (3) (the broader gap RFC 0037 + this RFC together close).
