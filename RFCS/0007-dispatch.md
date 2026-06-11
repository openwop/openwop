# RFC 0007: Dispatch (`core.dispatch` Node Pattern)

| Field             | Value                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0007                                                                                                                                                                        |
| **Title**         | Dispatch (`core.dispatch` Node Pattern)                                                                                                                                     |
| **Status**        | `Accepted`                                                                                                                                                                  |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                              |
| **Created**       | 2026-05-01                                                                                                                                                                  |
| **Updated**       | 2026-05-11 (Active → Accepted: integration-seams audit closed via `docs/MULTI-AGENT-INTEGRATION-GAPS.md` archive; conformance scenarios pass against SQLite reference host) |
| **Affects**       | `schemas/dispatch-config.schema.json`, `schemas/workflow-definition.schema.json`, `spec/v1/node-packs.md` (reserved typeIds), `spec/v1/capabilities.md`                     |
| **Compatibility** | `additive`                                                                                                                                                                  |
| **Supersedes**    | —                                                                                                                                                                           |
| **Superseded by** | —                                                                                                                                                                           |

## Summary

Introduce a new reserved node `typeId`, `core.dispatch`, that translates the latest `OrchestratorDecision` (RFC 0006) into a concrete runtime action — dispatching a worker via `core.subWorkflow`, asking the user via `conversation.exchange` or `clarification.requested`, or terminating the run. Configuration is pinned at workflow definition time via `DispatchConfig` (`dispatch-config.schema.json`).

## Motivation

RFC 0006 defines _what_ the orchestrator decides; it does not define _how_ a decision becomes runtime work. Without a normative dispatch node, hosts will invent their own conventions: which subsystem fires the worker, which interrupt routes the user prompt, how fan-out behaves, whether iteration is capped. That divergence breaks cross-host workflow portability — a workflow built against one host's dispatch convention fails to run on another.

`core.dispatch` is the canonical translator. It consumes the run's latest `runOrchestrator.decided` event and emits the corresponding side effect. Workflow authors place a `core.dispatch` node after an orchestrator-supervisor node; the dispatch node's per-kind behavior is pinned by `DispatchConfig`.

This is symmetrical to how `core.subWorkflow` translates a sub-workflow reference into a child run — a reserved typeId with a normated config schema.

## Proposal

### §A `core.dispatch` typeId

Reserve `core.dispatch` as a canonical node typeId per `node-packs.md` §"Reserved core typeIds". Hosts that advertise `capabilities.orchestrator.supported: true` (RFC 0006) MUST implement `core.dispatch`.

Workflow definition shape:

```json
{
  "nodeId": "dispatch-1",
  "typeId": "core.dispatch",
  "config": "<DispatchConfig>"
}
```

### §B `DispatchConfig` shape

Defined in `dispatch-config.schema.json`. Four fields, all optional:

```json
{
  "askUserRouting": "conversation" | "clarification" | "auto",
  "workerDispatchModel": "child-run",
  "fanOutPolicy": "sequential" | "reject",
  "iterationCap": 25
}
```

#### `askUserRouting`

Routing surface for `kind: 'ask-user'` decisions:

- `'conversation'` — uses `conversation.exchange` (RFC 0005). REQUIRES `capabilities.conversationPrimitive: true`.
- `'clarification'` — uses `clarification.requested` interrupt (pre-RFC-0005 path).
- `'auto'` (default) — selects `conversation` when the host advertises the capability, `clarification` otherwise.

Hosts that select `'conversation'` without advertising the capability MUST surface `validation_error` at workflow registration time.

#### `workerDispatchModel`

How `kind: 'next-worker'` is dispatched:

- `'child-run'` (default and only v1.x value) — each `nextWorkerIds[i]` resolves to a workflow id and is dispatched as a child run via the existing `core.subWorkflow` machinery.

Same-run DAG navigation (resolving worker IDs against the parent run's node graph) is out of scope for v1.x and deferred to a future RFC. Hosts MAY add vendor-extension dispatch models under `vendor.<host>.<model>`; conformance scenarios validate `'child-run'` only.

#### `fanOutPolicy`

Behavior when `nextWorkerIds.length > 1`:

- `'sequential'` (default) — dispatches each in array order, blocking on each child terminal before starting the next. The dispatch node's output reports the LAST child's `(childRunId, childStatus)`; intermediate child-run identifiers surface in the run's event log via standard `node.*` events.
- `'reject'` — fails the dispatch with a structured `'fan_out_unsupported'` error envelope.

Parallel fan-out is out of scope for v1.x (see §K3).

#### `iterationCap`

Optional hard cap on dispatch-node executions per run, across all dispatch nodes. When set:

- Engine MUST emit `cap.breached` with `kind: 'dispatch-iterations'` once exceeded.
- Run transitions to `'failed'`.
- Cap is independent of `RunOptions.configurable.recursionLimit` and `Capabilities.limits.maxNodeExecutions`.

When absent, the run-level `recursionLimit` cap applies normally (each dispatch counts as one node execution against the run total).

### §C Reading the latest decision

`core.dispatch` reads the latest `runOrchestrator.decided` event from the run's projection at execution time. If no such event exists, the dispatch node MUST fail with `'no_pending_decision'` and the run transitions to `failed` (with `cap.breached` not applicable — this is a workflow-authoring error).

Hosts MAY surface a more specific error envelope when the decision is found but its `kind` is not yet supported by the dispatch model. Currently, only the three RFC 0006 §B kinds are supported.

### §D Per-kind semantics

#### `next-worker`

1. Engine validates each `nextWorkerIds[i]` resolves to a workflow id (per `workerDispatchModel: child-run`).
2. Engine constructs a child run via the normal `core.subWorkflow` flow for the first ID (or all IDs sequentially per `fanOutPolicy`).
3. Dispatch node's output: `{ childRunId, childStatus }` for the last child.
4. On any child failure, dispatch node propagates failure to the parent run (default subWorkflow propagation semantics).
5. For each spawned child, the host MUST emit a `node.dispatched` `RunEvent` carrying `{ childRunId, childWorkflowId, childStatus }` (see `schemas/run-event-payloads.schema.json $defs.nodeDispatched`). The envelope's `nodeId` carries the dispatching `core.dispatch` node-id; the payload does NOT duplicate it. Observers MAY rely on this event to reconstruct the parent → child linkage without scanning the runs table.

#### `ask-user`

1. Engine consults `askUserRouting` config + advertised capability.
2. Engine emits the appropriate interrupt (`conversation.opened` with `initialTurn` containing the decision's `prompt`, OR `clarification.requested` with a single question).
3. Engine suspends the dispatch node until resume.
4. Dispatch node's output: the user-provided answer (last turn for conversation; `clarificationResolved.answers[0]` for clarification).

#### `terminate`

1. Engine emits `run.completed` with optional `reason` from the decision.
2. Dispatch node's output is the run's terminal outcome.
3. Any sibling nodes still in flight are cancelled per existing cancellation cascade rules (`interrupt-profiles.md` §Parent-child cascade).

### §E Causation chain

`core.dispatch`'s emitted events MUST set `causationId` to the `eventId` of the consumed `runOrchestrator.decided` event. This lets replay reconstruct the decision-to-effect chain even when events from concurrent runs interleave.

### §F Replay determinism

`core.dispatch` is deterministic given the cached decision: same decision in → same dispatch action out. The non-determinism is upstream (in the orchestrator); RFC 0006 §F covers that. Replays re-fold the dispatch node's outputs from the event log without re-invoking subworkflows or re-asking users.

### §G Capability advertisement

```json
{
  "capabilities": {
    "dispatch": {
      "supported": true,
      "models": ["child-run"],
      "fanOutSupported": false,
      "askUserRoutings": ["conversation", "clarification", "auto"]
    }
  }
}
```

Hosts that advertise `capabilities.orchestrator.supported: true` MUST also advertise `capabilities.dispatch.supported: true`.

### §H Workflow validation

At workflow registration time, hosts MUST validate:

1. The workflow contains at least one orchestrator-supervisor node (RFC 0006) if it contains a `core.dispatch` node.
2. The `core.dispatch` node's `config` validates against `dispatch-config.schema.json`.
3. The chosen `askUserRouting` is supported by the host's capabilities.
4. The chosen `workerDispatchModel` is in `capabilities.dispatch.models`.

Validation failures surface as `validation_error` envelopes at the `POST /v1/workflows` endpoint.

### §K Unresolved questions

#### §K1 Same-run DAG navigation

Should `workerDispatchModel: 'same-run-node'` be supported, where `nextWorkerIds[i]` references a node in the same run's DAG? Pro: lower-latency dispatch (no child-run boot cost). Con: re-entrancy and state-sharing rules across dispatched siblings are non-trivial. Deferred to a future RFC (probably v1.3).

#### §K2 Streaming dispatch outputs

Should `core.dispatch` emit partial outputs (e.g., `output.chunk` events while child runs progress) for SSE consumers? Currently no — dispatch outputs are atomic per child terminal. Could change in v1.2.

#### §K3 Parallel fan-out

Should `fanOutPolicy: 'parallel'` be supported, dispatching all `nextWorkerIds[i]` concurrently and joining on all terminals? Pro: throughput. Con: error-aggregation semantics (does one child fail = all-fail, or quorum, or wait-all-then-report?). Deferred to v1.2 with a join-policy field.

## Compatibility

**Additive.**

- `core.dispatch` is a new reserved typeId; pre-RFC workflows that don't reference it are unaffected.
- `dispatch-config.schema.json` is a new schema.
- Capability advertisement is opt-in.
- No changes to required fields on existing schemas.

## Conformance

Existing scenarios touching the area:

- `conformance/src/scenarios/subworkflow.test.ts` — covers child-run dispatch baseline; `core.dispatch` reuses this machinery.
- `conformance/src/scenarios/dispatchLoop.test.ts` — covers the orchestrator-to-dispatch loop end-to-end.

New scenarios required for `Accepted`:

- `dispatch-next-worker-sequential.test.ts` — fan-out length 2, sequential policy, second child starts after first terminal.
- `dispatch-next-worker-reject.test.ts` — fan-out length 2, reject policy, fails with `fan_out_unsupported`.
- `dispatch-ask-user-auto.test.ts` — auto routing selects `conversation` when capability advertised, `clarification` otherwise.
- `dispatch-terminate.test.ts` — terminate decision emits `run.completed`.
- `dispatch-iteration-cap.test.ts` — `iterationCap` breach fires `cap.breached` + failure.
- `dispatch-no-decision.test.ts` — no `runOrchestrator.decided` upstream → fail with `no_pending_decision`.
- `dispatch-causation.test.ts` — emitted events carry `causationId` of the consumed decision.

All gated on `capabilities.dispatch.supported: true`.

## Alternatives considered

1. **Implicit dispatch (engine consumes decisions automatically).** Rejected: implicit side-effects are non-observable. An explicit dispatch node appears in the workflow graph, in the event log, and in tracing; implicit dispatch hides behavior.
2. **Per-decision-kind separate node types** (`core.dispatchNextWorker`, `core.dispatchAskUser`, `core.terminate`). Rejected: a single node consuming the latest decision is simpler and matches the "decision-then-effect" CO-1 invariant from RFC 0006. Three nodes also bloat workflow definitions.
3. **Configuration via capability discovery rather than per-node config.** Rejected: per-node config lets the same host run two workflows with different `askUserRouting` choices, useful for migration.
4. **Skip the dispatch node entirely; orchestrator emits the runtime action.** Rejected: violates the RFC 0006 design (orchestrator decides; engine acts). Co-locating them mixes agent-side reasoning with engine-side dispatch logic.

## Implementation notes (non-normative)

- The reference TypeScript host implements `core.dispatch` as a thin executor that reads `runOrchestrator.decided`, switches on `decision.kind`, and delegates to existing primitives (`core.subWorkflow` for `next-worker`, the interrupt machinery for `ask-user`, `run.completed` for `terminate`).
- For `fanOutPolicy: 'sequential'`, the host stores the per-child outputs in a transient channel until all are complete, then writes the last child's terminal to the node's output channel.
- Iteration counting uses a run-scoped counter persisted on `RunSnapshot.runOrchestrator.decisionsTaken` (incremented by RFC 0006 on each decision; dispatch reads it).

## Acceptance criteria

- [ ] Spec text merged.
- [x] `dispatch-config.schema.json` published.
- [ ] `node-packs.md` updates reserved-typeIds list to include `core.dispatch`.
- [ ] `capabilities.md` updates with `capabilities.dispatch.*`.
- [ ] Seven new conformance scenarios.
- [ ] CHANGELOG entry.
- [ ] Reference host implements `core.dispatch` and passes scenarios.

## References

- `schemas/dispatch-config.schema.json`
- RFC 0006 (Orchestrator — produces the decisions dispatch consumes)
- RFC 0005 (Conversation — `ask-user` routing target)
- RFC 0022 (Dispatch + subWorkflow runtime variable mapping — additive amendment that adds `inputMapping` / `outputMapping` / `perWorker*` fields to `DispatchConfig`; capability-gated on `capabilities.agents.dispatchMapping`)
- `spec/v1/interrupt-profiles.md` (parent-child cancellation cascade interacts with `terminate`)
