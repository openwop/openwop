# RFC 0037: Multi-agent execution model + replay determinism under nondeterministic models

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0037                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Title**         | Multi-agent execution model + replay determinism under nondeterministic models                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Created**       | 2026-05-21                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Updated**       | 2026-05-22 (Active → Accepted: first vendor-neutral validation tripwire fires. MyndHyve workflow-runtime advertises `capabilities.multiAgent.executionModel.{supported: true, version: 1}` on Cloud Run revision `workflow-runtime-00352-geh` (tagged preview `rfc0037` per MyndHyve's parallel-session-safety hygiene; production stays pinned at `00187-k2z`). `multi-agent-handoff-state-machine.test.ts` against `@openwop/openwop-conformance@1.4.0` reports 1 passed (RFC 0037 §C advertisement-shape probe) / 1 skipped (behavioral 4-event causation-chain leg, gated on `isFixtureAdvertised('conformance-multi-agent-handoff') AND isFixtureAdvertised('conformance-multi-agent-handoff-child')` — MyndHyve hasn't seeded the fixtures yet; separate follow-up) / 0 failed (exit 0). Per bootstrap-phase rules, advertisement-and-pass-modulo-honest-skip is sufficient — same precedent as the RFC 0030–0033 envelope LLM-contract-hardening track (2026-05-21, where 4-of-87 assertions stayed on the honest-skip path). Behavioral 4-event verification will follow when MyndHyve seeds the fixtures (~half day per their adoption note). See `INTEROP-MATRIX.md` §"Third-party host adoption — RFC 0037 Phase 1 ... external-validation gate (2026-05-22)". 2026-05-21 prior: Draft → Active same-day, Phase 1 spec + reference-host wiring + behavioral fixtures + advertisement-shape scenario all landed.) |
| **Affects**       | NEW `spec/v1/multi-agent-execution.md` (normative) · `schemas/capabilities.schema.json` (adds `capabilities.multiAgent.executionModel`) · `schemas/run-event-payloads.schema.json` (tightens existing `agent.*` payload shapes; may add cross-host causation fields) · multiple new conformance scenarios · all 3 reference hosts · `INTEROP-MATRIX.md` · CHANGELOG                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

> **Amended (additive) 2026-05-25:** RFC 0061 adds `multiAgent.executionModel.version: 5` (stateful agent-loop lifecycle) + an optional `iteration` field on `runOrchestrator.decided`; RFC 0063 adds an optional `attestation` field on `core.workflowChain.event` (`output.harvested` phase). Both events are `additionalProperties: false`, so the new fields are declared in `properties`; `required` arrays are unchanged and there is **no `eventLogSchemaVersion` bump**. Non-breaking per `COMPATIBILITY.md` §2.1.

## Summary

Specify the **formal interoperable execution model** for multi-agent workflows: planner→worker handoff state machine, confidence-threshold semantics, agent memory lifecycle across sub-runs, cross-host causation linking, and replay determinism under nondeterministic model emissions. Today these surfaces are partially covered by RFCs 0002 (identities/reasoning events), 0006 (orchestrator/supervisor), 0007 (dispatch), 0022 (input/output mapping), 0024 (reasoning streaming), and 0026 (provider usage) — but no single doc gives the **execution model** as a portable contract. This is the largest single open RFC at standardization scale.

## Motivation

Per external standards-readiness review 2026-05-21 finding (3): "OpenWOP defines identities, dispatch, memory, reasoning events, envelopes, prompts, MCP/A2A composition, and host capabilities, but it does not yet give a sufficiently formal interoperable execution model for planner/worker handoff, confidence semantics, agent memory lifecycle, cross-host causality, and replay under nondeterministic model behavior."

The reviewer is correct that the existing RFCs cover slices but no doc states the full execution semantics in one normative place. This RFC is the integration layer.

## Proposal — Phased

This RFC is intentionally phased because the full execution model is too large for a single 7-day comment window. Each phase lands as a follow-up RFC that depends on this one.

### Phase 1 (this RFC) — Execution model framework + planner→worker handoff

#### §A — Execution model framework (normative)

Define the canonical execution loop a multi-agent host MUST follow:

```text
1. Orchestrator/Supervisor (RFC 0006) emits a Decision (next-worker | terminate | clarify | escalate).
2. Dispatcher (RFC 0007) materializes the Decision: creates a child run (`core.dispatch`) or a sub-workflow (`core.subWorkflow`).
3. Child run executes; on terminal status, the input/output mapping (RFC 0022) projects results back into the parent run's variables.
4. Parent run's next supervisor turn observes the new state and emits the next Decision.
```

A host that advertises `capabilities.multiAgent.executionModel.version >= 1` MUST implement this loop. Existing primitives (RFCs 0006/0007/0022) are the implementation; this RFC formalizes their composition.

#### §B — Planner→worker handoff state machine (normative)

Define the handoff state machine with 4 states + 6 transitions:

| State         | Description                                                               | Allowed exits                                     |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| `pending`     | Planner has decided on the worker but dispatch hasn't fired               | → `dispatching`                                   |
| `dispatching` | Child run is being created                                                | → `running` (success), `failed` (creation failed) |
| `running`     | Child run is in progress                                                  | → `completed`, `failed`, `cancelled`              |
| `harvested`   | outputMapping has run (RFC 0022 §A) — parent has observed child's outputs | (terminal)                                        |

The transition `running → harvested` MUST happen exactly when the child reaches a terminal `completed` AND outputMapping is non-empty. Failed/cancelled children skip the harvest per RFC 0022 §B.

Each transition MUST emit a `core.workflowChain.event` with `causationId` linking to the prior transition's `eventId` (per the existing event-log identity chain in `replay.md`).

#### §C — Capability advertisement

```diff
+  "multiAgent": {
+    "type": "object",
+    "properties": {
+      "executionModel": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": ["supported", "version"],
+        "properties": {
+          "supported": { "type": "boolean" },
+          "version": { "type": "integer", "minimum": 1, "description": "Profile version. 1 = Phase 1 (this RFC: framework + planner→worker handoff). Future phases bump." }
+        }
+      }
+    }
+  }
```

### Phase 2 (follow-up RFC) — Confidence-threshold semantics + agent memory lifecycle

Deferred — needs MyndHyve adoption feedback on `mockConfidence` + `MemoryAdapter` cross-run lifecycle. Open spec gaps:

- Confidence threshold below which the supervisor MUST escalate vs MAY escalate (today: host policy).
- `MemoryEntry.ttl` semantics across sub-run boundaries (today: implicit; needs normative MUST).
- Memory carry-forward when a sub-run is replayed from past event-log index.

### Phase 3 (follow-up RFC) — Cross-host causation linking

Deferred — needs at least 2 cross-host implementations to validate. Open spec gaps:

- Extending `causationId` to span hosts (currently single-host scope).
- W3C tracecontext propagation across MCP/A2A composition boundaries (already partially specced in `RFCS/0023-conformance-agent-event-emitters.md` for OTel; this would normate the cross-host case).
- Cross-host run ID resolution: when host A's run dispatches to host B, what's the discoverable identifier chain?

### Phase 4 (follow-up RFC) — Replay determinism under nondeterministic models

Deferred — substantively the hardest piece. Per `replay.md` §"Determinism with non-deterministic agents," replay is determined by the event-log identity chain (causationId → eventId). RFC 0024 streams reasoning deltas with monotone sequence numbers. The open question: when a replay re-issues an LLM call and the model emits a _different_ envelope, is replay still "deterministic" in the user-observable sense?

Open spec gaps:

- LLM cache-key recipe (per `replay.md` §"LLM cache-key recipe" — already exists but `replay-llm-cache-key.test.ts` is shape-only per `docs/KNOWN-LIMITS.md:18`).
- Recovery from envelope refusal in replay context (the original run got envelope, replay gets refusal).
- Determinism vs idempotency: replay produces the same observable output sequence, even if underlying tool calls differ.

## Compatibility

**Additive (Phase 1).** No existing wire shapes change; the `multiAgent.executionModel` capability is opt-in. Hosts that don't advertise continue using RFCs 0006/0007/0022 as today, with implementation flexibility on the integration semantics.

Phases 2-4 will each be additive within v1.x by the same logic.

## Conformance (Phase 1)

NEW `conformance/src/scenarios/multi-agent-handoff-state-machine.test.ts` — gated on `capabilities.multiAgent.executionModel.supported: true`. Asserts:

1. The 4 handoff states emit a `core.workflowChain.event` per transition.
2. The `causationId` on each transition chains back to the prior transition's `eventId`.
3. The `dispatching → running` failure path emits a single `core.dispatch.failed` (not chained transitions).
4. The `running → harvested` transition fires only on terminal `completed` with non-empty outputMapping.

## Alternatives considered

1. **Skip the framework doc; cite RFCs 0002+0006+0007+0022+0024+0026 as the implicit execution model.** Rejected — that's the current posture and it's what the reviewer flagged as insufficient. A standards-grade execution model needs a single normative doc that integrates the slices.
2. **Mandate a specific orchestrator implementation pattern (e.g., n8n-style supervisor root).** Rejected — `positioning.md` is clear that OpenWOP does not standardize orchestration topology; this RFC stays at the protocol contract level.
3. **Land all 4 phases in one mega-RFC.** Rejected — would take months and would never converge. Phased delivery with clear deferrals is the credible move.

## Unresolved questions

1. **Where does `core.workflowChain.event` live?** Likely a new event type in `schemas/run-event-payloads.schema.json`; defer to the schema-design pass.
2. **Should the executionModel profile gate replay across handoff boundaries?** Probably yes — but the gate needs Phase 4's LLM cache-key work to be coherent.
3. **MCP/A2A interaction.** The state machine assumes intra-host handoff; cross-host (via MCP/A2A composition) likely needs a sibling state machine. Defer to Phase 3.

## Acceptance criteria (Phase 1 only)

- [x] Spec text merged (this file).
- [x] NEW `spec/v1/multi-agent-execution.md` with §A + §B + reference to Phases 2-4 as open spec gaps.
- [x] `schemas/capabilities.schema.json` extended per §C.
- [x] NEW `conformance/src/scenarios/multi-agent-handoff-state-machine.test.ts` per §Conformance — shipped in `@openwop/openwop-conformance@1.4.0` (2026-05-22).
- [x] At least 1 reference host advertises + passes the new scenario — MyndHyve workflow-runtime advertises `capabilities.multiAgent.executionModel.{supported: true, version: 1}` on revision `workflow-runtime-00352-geh`; `multi-agent-handoff-state-machine.test.ts` reports 1 passed (advertisement-shape) / 1 skipped (behavioral leg, gated on fixture availability) / 0 failed (exit 0) against `@openwop/openwop-conformance@1.4.0`. Reference workflow-engine ALSO advertises under `OPENWOP_MULTI_AGENT_EXECUTION_MODEL=true`. (Behavioral 4-event verification is a follow-up on the host's roadmap when fixtures are seeded.)
- [x] `INTEROP-MATRIX.md` updated — see §"Third-party host adoption — RFC 0037 Phase 1 ... (2026-05-22)".
- [x] CHANGELOG entry under `[Unreleased]`.
- [x] Follow-up RFCs filed for Phases 2-4: RFC 0039 (Phase 2, confidence + memory lifecycle), RFC 0040 (Phase 3, cross-host causation), RFC 0041 (Phase 4, replay determinism under nondeterministic models). Plus RFC 0044 (interrupt-kind advertisement clarification to RFC 0039 §A).

Path to `Active → Accepted`: cross-host advertisement evidence per RFCs/0001 §"Promotion to Accepted." **CLOSED 2026-05-22** — first vendor-neutral validation tripwire firing.

## References

- `RFCS/0002-agent-identity-and-reasoning-events.md`
- `RFCS/0006-orchestrator.md`
- `RFCS/0007-dispatch.md`
- `RFCS/0022-dispatch-input-output-mapping.md`
- `RFCS/0024-agent-reasoning-streaming.md`
- `RFCS/0026-provider-usage-event.md`
- `spec/v1/replay.md` §"Determinism with non-deterministic agents"
- `spec/v1/positioning.md` (the "we don't standardize orchestration topology" claim this RFC must respect)
- `docs/KNOWN-LIMITS.md:18` (LLM cache-key shape-only — Phase 4 input)
- External standards-readiness review 2026-05-21 — finding (3)
