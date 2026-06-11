# RFC 0006: Run Orchestrator

| Field             | Value                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0006                                                                                                                                                                                                                   |
| **Title**         | Run Orchestrator                                                                                                                                                                                                       |
| **Status**        | `Accepted`                                                                                                                                                                                                             |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                         |
| **Created**       | 2026-05-01                                                                                                                                                                                                             |
| **Updated**       | 2026-05-11 (Active → Accepted: integration-seams audit closed via `docs/MULTI-AGENT-INTEGRATION-GAPS.md` archive; conformance scenarios pass against SQLite reference host)                                            |
| **Affects**       | `schemas/orchestrator-decision.schema.json`, `schemas/run-orchestrator-decided-event.schema.json`, `schemas/run-snapshot.schema.json`, `schemas/run-event.schema.json`, `spec/v1/replay.md`, `spec/v1/capabilities.md` |
| **Compatibility** | `additive`                                                                                                                                                                                                             |
| **Supersedes**    | —                                                                                                                                                                                                                      |
| **Superseded by** | —                                                                                                                                                                                                                      |

## Summary

Introduce `runOrchestrator` — an optional supervisor agent that owns workflow routing decisions and dynamically constructs the node stack based on user intent. The orchestrator emits typed decisions (`next-worker`, `ask-user`, `terminate`) via a single new event type, `runOrchestrator.decided`. A `runOrchestrator` field on `RunSnapshot` and three ordering invariants make the surface replay-deterministic.

## Motivation

The v1 baseline executes a static DAG: workflow definitions list nodes and edges, and the engine traverses them. This is the right model for deterministic pipelines (data ETL, build pipelines, fixed approval flows). It does _not_ fit orchestrator-driven agent workflows where:

- The next worker depends on what the supervisor decides after reasoning.
- Termination is a goal-judgement, not a graph-edge.
- "Ask the user a clarifying question" is a routing decision, not a node type.

Rather than re-encoding these as edge conditions in a static DAG (which forces every possible branch into the workflow definition), RFC 0006 introduces a supervisor agent that emits typed decisions at runtime. The static DAG still exists — workers are nodes — but routing between workers is driven by the orchestrator.

This is observable via a single event type (no implicit branching), replay-deterministic (decisions are cached), and bounded (terminate-vs-fail-vs-cancel are distinct states).

## Proposal

### §A `runOrchestrator` field on `RunSnapshot`

Add an optional object to the run snapshot:

```diff
   "properties": {
     "runId": { ... },
     "workflowId": { ... },
+    "runOrchestrator": {
+      "type": "object",
+      "required": ["agentId"],
+      "properties": {
+        "agentId": { "type": "string", "minLength": 3, "maxLength": 256 },
+        "iterationCap": { "type": "integer", "minimum": 1 },
+        "decisionsTaken": { "type": "integer", "minimum": 0, "default": 0 }
+      },
+      "additionalProperties": false
+    }
   }
```

When `runOrchestrator` is present:

- `agentId` MUST be set at first decision and MUST NOT change for the run's lifetime.
- `iterationCap` MAY cap total orchestrator decisions per run (independent of `recursionLimit`).
- `decisionsTaken` is host-incremented; clients MAY treat as read-only.

When `runOrchestrator` is absent, the run executes as a v1 static-DAG run; no orchestrator events fire.

### §B `OrchestratorDecision` shape

Defined in `orchestrator-decision.schema.json`. Three canonical kinds; the enum is closed at the protocol layer. Vendor extensions MAY ship under `vendor.<host>.<kind>` per `host-extensions.md` but conformance validates against the closed set.

#### `next-worker`

```json
{ "kind": "next-worker", "nextWorkerIds": ["string", ...] }
```

Dispatches one or more workers. Phase-5 hosts MAY treat `nextWorkerIds` as length-1 and ignore the tail; Phase-6 hosts (with `core.dispatch` per RFC 0007) SHOULD honor full fan-out.

`nextWorkerIds` entries are either node IDs (resolve directly to nodes in the run's static DAG) or agent IDs (resolve via the workflow's agent-to-node binding). Host capability advertisement (`capabilities.orchestrator.workerIdInterpretation: "node" | "agent" | "either"`) tells clients which form to send.

#### `ask-user`

```json
{ "kind": "ask-user", "prompt": "string" }
```

Routes a human-targeted question. Hosts that advertise `capabilities.conversationPrimitive: true` (RFC 0005) SHOULD route through `conversation.exchange`; hosts that don't MAY surface as a `'clarification'` interrupt. The dispatch layer (RFC 0007 §B) makes the routing choice.

#### `terminate`

```json
{ "kind": "terminate", "reason": "string (optional)" }
```

Clean run termination driven by orchestrator judgement. Distinct from:

- `run.failed` — uncaught executor error (involuntary).
- `run.cancelled` — operator cancellation via REST (external).
- `terminate` — orchestrator-emitted goal-reached signal (voluntary, in-band).

Common reasons (not normated): `'goal-reached'`, `'max-iterations'`, `'unrecoverable-error'`.

### §C `runOrchestrator.decided` event

Emitted exactly once per decision. Payload defined in `run-orchestrator-decided-event.schema.json`:

```json
{
  "agentId": "string (matches runOrchestrator.agentId)",
  "decision": "<OrchestratorDecision>"
}
```

The event envelope's top-level `nodeId` carries the supervisor node ID; the payload does not duplicate it.

### §E Ordering invariants (CO-1 / CO-2 / CO-3)

Named for cross-host conformance:

**CO-1: Decision-then-effect.** `runOrchestrator.decided` MUST be persisted _before_ any event reflecting its effect:

- For `next-worker`: before the `node.started` of the dispatched worker.
- For `ask-user`: before the `conversation.opened` or `clarification.requested`.
- For `terminate`: before the `run.completed`.

CO-1 lets replay reconstruct the decision causation chain from the event log alone.

**CO-2: Identity stability.** `RunSnapshot.runOrchestrator.agentId` MUST equal the `agentId` on every `runOrchestrator.decided` event for the run's lifetime. Hosts MUST reject decisions from any other agent with `validation_error`.

**CO-3: Iteration cap.** When `iterationCap` is set, the `(iterationCap + 1)`th decision MUST fire `cap.breached` with `kind: 'orchestrator-iterations'` and transition the run to `failed`. The capped run does NOT terminate cleanly — it fails so operators investigate.

### §F Replay determinism (cache-only)

Replay re-folds `runOrchestrator.decided` events from the event log; the orchestrator agent is NOT re-invoked during replay. This is the "cache-only" determinism rule: orchestrator logic MAY be non-deterministic (LLM-driven), but the cached decision is replayed verbatim.

Replay divergence: if the underlying workflow definition has changed such that the cached `nextWorkerIds[i]` no longer resolves, the host MUST emit `replay.diverged` and either abort or continue per `replay.md` §Divergence handling.

### §G Capability advertisement

```json
{
  "capabilities": {
    "orchestrator": {
      "supported": true,
      "workerIdInterpretation": "node" | "agent" | "either",
      "fanOutSupported": false
    }
  }
}
```

Hosts that do not advertise `capabilities.orchestrator.supported: true` MUST reject workflow definitions that reference `core.orchestrator.supervisor` node types with `validation_error` at registration time.

### §H Termination state matrix

| Outcome              | Run state                                                           | Trigger                        |
| -------------------- | ------------------------------------------------------------------- | ------------------------------ |
| Clean goal-reached   | `run.completed`                                                     | `terminate` decision           |
| Iteration cap        | `run.failed` (`cap.breached`)                                       | CO-3                           |
| Uncaught error       | `run.failed`                                                        | executor exception             |
| Operator cancel      | `run.cancelled`                                                     | `POST /v1/runs/{runId}:cancel` |
| Conversation timeout | `run.failed` (or `run.completed` with `null` outcome — host policy) | RFC 0005 §I                    |

`terminate` is the only orchestrator-emitted _clean_ outcome.

## Compatibility

**Additive.**

- `runOrchestrator` is optional on `RunSnapshot`; pre-RFC runs omit it.
- The `runOrchestrator.decided` event type extends `RunEventType`; consumers fold unknowns best-effort.
- Capability is opt-in; hosts that don't advertise are still v1-conformant.
- No changes to existing required fields.

## Conformance

Existing scenarios touching the area:

- `conformance/src/scenarios/multi-node-ordering.test.ts` — verifies general event ordering. CO-1 ordering is a stricter sub-property.

New scenarios required for `Accepted`:

- `orchestrator-ordering.test.ts` — exercises CO-1 across all three decision kinds.
- `orchestrator-identity-stability.test.ts` — exercises CO-2 (rejects mismatched agentId).
- `orchestrator-iteration-cap.test.ts` — exercises CO-3 (cap breach fires `cap.breached` + failure).
- `orchestrator-replay.test.ts` — exercises §F (replay re-folds without re-invocation).
- `orchestrator-termination-distinct.test.ts` — exercises §H (terminate is distinct from failed/cancelled).

All gated on `capabilities.orchestrator.supported: true`.

## Alternatives considered

1. **Encode routing as edge predicates in `WorkflowDefinition`.** Rejected: forces every possible branch into the static workflow, defeats the orchestrator pattern. Works for narrow rule engines, not for LLM-driven supervisors.
2. **Make orchestrator a tool exposed to LLM nodes.** Rejected: routing decisions are graph-level operations, not data-level. A tool returning "next-worker: X" still needs the engine to dispatch X; the orchestrator IS the dispatcher.
3. **Use Temporal-style child workflow per decision.** Considered for RFC 0007's `core.dispatch`. The decision shape itself stays in the protocol; how to dispatch is RFC 0007's concern.
4. **Closed enum vs open for decision kinds.** Closed. Vendor extensions allowed under `vendor.*` namespace per `host-extensions.md`, but conformance validates against the closed canonical set.

## Unresolved questions

1. Should `nextWorkerIds` entries be node-ids or agent-ids? Hosts advertise via `workerIdInterpretation`; the protocol accepts either. This is intentionally late-bound. (Tracked from `orchestrator-decision.schema.json` description.)
2. Should the orchestrator agent be allowed to read the full event log (audit-trail access)? Probably yes, gated on host policy. Spec stays silent.
3. Should `terminate.reason` be a closed enum for cross-host catalog purposes? Currently open per the schema. Defer to v1.2 if there's appetite.

## Implementation notes (non-normative)

- The reference TypeScript host implements orchestrator as a special node type (`core.orchestrator.supervisor`) that wraps an LLM call. The LLM returns a `OrchestratorDecision`; the wrapper persists the `runOrchestrator.decided` event and yields back to the engine.
- Hosts MAY pre-validate decisions client-side (in the SDK) before submitting to the engine; the engine MUST re-validate server-side because the SDK is untrusted.

## Acceptance criteria

- [ ] Spec text merged.
- [x] `orchestrator-decision.schema.json` published.
- [x] `run-orchestrator-decided-event.schema.json` published.
- [x] `run-event.schema.json` includes `runOrchestrator.decided`.
- [ ] `run-snapshot.schema.json` adds `runOrchestrator` field.
- [ ] `capabilities.md` adds `capabilities.orchestrator.*`.
- [ ] Five conformance scenarios.
- [ ] CHANGELOG entry.
- [ ] Reference host implements an orchestrator and passes scenarios.

## References

- `schemas/orchestrator-decision.schema.json`
- `schemas/run-orchestrator-decided-event.schema.json`
- `spec/v1/replay.md` (cache-only replay rule for non-deterministic orchestrators)
- RFC 0002 (Agent Identity), RFC 0005 (Conversation — `ask-user` routing), RFC 0007 (Dispatch — translates decisions into runtime actions)
