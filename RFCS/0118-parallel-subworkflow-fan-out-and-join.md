# RFC 0118: Parallel Sub-Workflow Fan-Out and Join

| Field             | Value                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0118                                                                                                                                                                                                                                                            |
| **Title**         | Parallel sub-workflow fan-out and join (`fanOutPolicy: 'parallel'` + `joinPolicy`)                                                                                                                                                                              |
| **Status**        | `Draft`                                                                                                                                                                                                                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                  |
| **Created**       | 2026-06-27                                                                                                                                                                                                                                                      |
| **Updated**       | 2026-06-27                                                                                                                                                                                                                                                      |
| **Affects**       | `schemas/dispatch-config.schema.json`, `schemas/run-event-payloads.schema.json`, `spec/v1/node-packs.md` (`core.dispatch` / `core.subWorkflow` fan-out semantics), `spec/v1/capabilities.md` (`capabilities.dispatch.*`), `api/asyncapi.yaml`, conformance `dispatch-*` scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                                                                                                                                                                                                              |
| **Supersedes**    | —                                                                                                                                                                                                                                                              |
| **Superseded by** | —                                                                                                                                                                                                                                                              |

## Summary

RFC 0007 §K3 explicitly defers `fanOutPolicy: 'parallel'` "to v1.2 with a join-policy field," leaving `core.dispatch` (and the `core.subWorkflow` machinery it drives) able to fan out to multiple child workflows only **sequentially** — each child blocks the next. This RFC closes that deferral: it adds `'parallel'` to the `fanOutPolicy` enum, introduces a normative `joinPolicy` object that pins error-aggregation and completion semantics across concurrent children, adds a bounded-concurrency control, and specifies the per-child lifecycle events a parallel fan-out emits. The change is purely additive — the default stays `'sequential'`, the new fields are optional, and hosts that do not advertise `capabilities.dispatch.fanOutSupported: true` reject the new policy at registration time exactly as they do today.

## Motivation

The dispatch model is the wire's only portable way for one run to drive several child runs. Today that fan-out is serialized: §D step 2 dispatches "the first ID (or all IDs sequentially per `fanOutPolicy`)," and §K3 names parallel fan-out as the open question, gated only by the lack of an agreed **join policy** (does one child failure fail all, or is it quorum, or wait-all-then-report?).

Real orchestrations fan out by design. The motivating implementer is a multi-channel marketing campaign workflow (openwop-app's Campaign Studio port, `docs/campaign-studio-prd.md`): a parent run selects brand/persona/knowledge-base assets, generates a shared messaging kernel, then **generates five channel deliverables concurrently** — landing page, ad variants, email sequence, creative briefs, social posts — each as an independent child workflow (`generate → quality-check → brand-compliance → approval`), joining on all five before a cross-asset consistency check. Forced to dispatch sequentially, a campaign that should take ~5 minutes (slowest channel) takes ~25 (sum of channels), and a single channel's approval stall blocks every other channel from even starting. The same shape recurs in fan-out research, multi-vendor RFQ, batch document processing, and any map-style workload.

Hosts that want this today must either (a) collapse the children into one monolithic child workflow (losing the per-child run lineage, independent approval gates, and replay isolation that `core.subWorkflow` gives), or (b) invent a `vendor.<host>.parallel` dispatch model — which is exactly the cross-host portability break RFC 0007 §Motivation warns against. A workflow authored against one host's parallel convention will not run on another. The join semantics are a wire contract, so the spec is the right place to fix this.

This RFC is deliberately scoped to fan-out **breadth** (concurrent siblings + join). It does NOT reopen §K1 (same-run DAG navigation) or §K2 streaming dispatch outputs, except where §K2's per-child progress visibility is a necessary consequence of running children concurrently (see §E).

## Proposal

### §A `fanOutPolicy: 'parallel'`

Extend the `DispatchConfig.fanOutPolicy` enum (`dispatch-config.schema.json`) with a third value, `'parallel'`. When `decision.kind === 'next-worker'` and `nextWorkerIds.length > 1`:

- `'sequential'` (default, unchanged) — dispatch each child in array order, blocking on each terminal before the next.
- `'reject'` (unchanged) — fail with `'fan_out_unsupported'`.
- `'parallel'` (**new**) — dispatch **all** `nextWorkerIds[i]` as child runs concurrently (subject to `maxConcurrency`, §C) and join on their terminals per `joinPolicy` (§B).

A host that does not advertise `capabilities.dispatch.fanOutSupported: true` (§F) MUST surface a `validation_error` at `POST /v1/workflows` when a `core.dispatch` node pins `fanOutPolicy: 'parallel'`. This mirrors the existing `workerDispatchModel` / `askUserRouting` registration-time validation in RFC 0007 §H.

```diff
     "fanOutPolicy": {
       "type": "string",
-      "enum": ["sequential", "reject"],
+      "enum": ["sequential", "reject", "parallel"],
       "default": "sequential",
-      "description": "... Parallel fan-out is OUT OF SCOPE for v1.x — see RFC 0007 §K3 (unresolved question)."
+      "description": "... `'parallel'` (RFC 0118) dispatches all `nextWorkerIds[i]` concurrently (bounded by `maxConcurrency`) and joins on their terminals per `joinPolicy`. Requires `capabilities.dispatch.fanOutSupported: true`; rejected with `validation_error` at registration otherwise."
     },
```

### §B `joinPolicy`

Add an optional `joinPolicy` object to `DispatchConfig`. It is meaningful **only** when `fanOutPolicy: 'parallel'`; a host MUST surface a `validation_error` at registration if `joinPolicy` is present while `fanOutPolicy !== 'parallel'`.

```diff
+    "joinPolicy": {
+      "type": "object",
+      "description": "RFC 0118. Completion + error-aggregation semantics for `fanOutPolicy: 'parallel'`. Ignored (and a registration `validation_error`) for any other fan-out policy.",
+      "properties": {
+        "mode": {
+          "type": "string",
+          "enum": ["wait-all", "quorum", "first", "race"],
+          "default": "wait-all"
+        },
+        "quorum": { "type": "integer", "minimum": 1 },
+        "onChildFailure": {
+          "type": "string",
+          "enum": ["fail-fast", "absorb", "collect"],
+          "default": "collect"
+        }
+      },
+      "required": [],
+      "additionalProperties": false
+    },
```

**`mode`** — when the join is considered satisfied:

- `'wait-all'` (default) — the dispatch node remains suspended until **every** dispatched child reaches a terminal state (`completed`, `failed`, or `cancelled`). MUST be the default because it is the only mode that never discards a child's outcome.
- `'quorum'` — satisfied when at least `quorum` children reach `completed`. REQUIRES the `quorum` field (`1 ≤ quorum ≤ nextWorkerIds.length`); a missing or out-of-range `quorum` is a registration `validation_error`. Children still in flight when quorum is reached are cancelled per the cascade in `interrupt-profiles.md` §Parent-child cascade.
- `'first'` — satisfied when the first child reaches `completed`. Remaining children are cancelled. (`'first'` is `'quorum'` with `quorum: 1` plus a fixed result-selection rule; it is kept distinct for authoring clarity.)
- `'race'` — satisfied when the first child reaches **any** terminal state (`completed` **or** `failed`). Remaining children are cancelled. Distinguished from `'first'` for workloads where the earliest signal — success or failure — is the answer.

**`onChildFailure`** — how a non-`completed` child terminal affects the dispatch node. This generalizes the existing single-child `core.subWorkflow.onChildFailure` (`fail-parent` / `absorb`, per `node-packs.md`) to the N-child case:

- `'collect'` (default) — no individual failure short-circuits the join; the node waits per `mode`, then reports per-child outcomes in its output (§D). The parent workflow author decides what a partial failure means via downstream edge conditions. This is the safest default for fan-out work where channels are independent.
- `'fail-fast'` — the first child to reach `failed` (or `cancelled`) immediately fails the dispatch node; remaining children are cancelled. Equivalent to the `fail-parent` semantics applied at first failure.
- `'absorb'` — failed children are recorded in the run log and in the node output but never fail the parent; the join still completes per `mode`. Equivalent to single-child `absorb` applied per child.

`mode` and `onChildFailure` are orthogonal: e.g. `{ mode: 'wait-all', onChildFailure: 'collect' }` (the campaign case — wait for all five channels, surface which failed) versus `{ mode: 'quorum', quorum: 3, onChildFailure: 'fail-fast' }` (need 3 of N, abort early on any hard failure).

### §C `maxConcurrency`

Add an optional `maxConcurrency` integer to `DispatchConfig`, meaningful only under `fanOutPolicy: 'parallel'`:

```diff
+    "maxConcurrency": {
+      "type": "integer",
+      "minimum": 1,
+      "description": "RFC 0118. Maximum number of children dispatched concurrently under `fanOutPolicy: 'parallel'`. When `nextWorkerIds.length` exceeds this, the host dispatches in waves of at most `maxConcurrency`, starting a queued child as each in-flight child terminates. Absent → host-defined effective concurrency (a host MAY cap to protect itself; it MUST advertise that cap as `capabilities.dispatch.maxFanOut` so authors can plan). Does not change join semantics — `joinPolicy` still evaluates over the full `nextWorkerIds` set."
+    },
```

A host MAY enforce its own ceiling regardless of the authored value; the **effective** concurrency is `min(maxConcurrency ?? ∞, capabilities.dispatch.maxFanOut ?? ∞)`. The host MUST NOT silently drop children above the ceiling — it queues and dispatches them in waves.

### §D Output shape

Under `fanOutPolicy: 'parallel'`, the dispatch node's output replaces the single-child `{ childRunId, childStatus }` with a `children` array plus an aggregate `joinOutcome`. Sequential and reject policies are unchanged.

```json
{
  "outputs": {
    "joinOutcome": "satisfied" | "failed" | "partial",
    "children": [
      { "workflowId": "campaign-studio.channel.landing-page", "childRunId": "run-...", "childStatus": "completed" },
      { "workflowId": "campaign-studio.channel.ad-variants",  "childRunId": "run-...", "childStatus": "completed" },
      { "workflowId": "campaign-studio.channel.email-sequence","childRunId": "run-...", "childStatus": "failed", "error": { "code": "..." } }
    ]
  }
}
```

- `joinOutcome: 'satisfied'` — the `mode` condition was met and `onChildFailure` did not fail the node.
- `joinOutcome: 'failed'` — `onChildFailure: 'fail-fast'` tripped, or `mode` could not be satisfied (e.g. `quorum: 3` but only 2 children completed). The dispatch node fails and the run transitions to `failed` per existing propagation.
- `joinOutcome: 'partial'` — `mode` satisfied but at least one child is non-`completed` under `onChildFailure: 'collect'` / `'absorb'`. The node SUCCEEDS; downstream authoring decides handling.

Output mapping (RFC 0022 `outputMapping` / `perWorkerOutputMappings`) applies per child: each `completed` child's mapped variables merge into the parent. When two children map to the same parent variable, the **last terminal in wall-clock order** wins, and the host MUST emit the merge order in the event log (§E) so replay is deterministic. Authors SHOULD avoid colliding output keys across parallel children.

### §E Per-child lifecycle events

A parallel fan-out MUST emit, for each dispatched child, the same `node.dispatched` `RunEvent` (`{ childRunId, childWorkflowId, childStatus }`, `run-event-payloads.schema.json $defs.nodeDispatched`) that sequential dispatch emits today (RFC 0007 §D5). Concurrency makes the relative ordering of these events non-deterministic across runs; consumers MUST NOT assume array order.

To keep the parent observable while children run concurrently (the §K2 concern, resolved **only** for the parallel case), the host MUST emit a `core.dispatch.fanOut` event when the wave begins and a `core.dispatch.join` event when the join is satisfied:

```diff
   "$defs": {
+    "dispatchFanOut": {
+      "type": "object",
+      "required": ["fanOutPolicy", "childCount"],
+      "properties": {
+        "fanOutPolicy": { "const": "parallel" },
+        "childCount": { "type": "integer", "minimum": 2 },
+        "maxConcurrency": { "type": "integer", "minimum": 1 },
+        "joinMode": { "type": "string", "enum": ["wait-all", "quorum", "first", "race"] }
+      },
+      "additionalProperties": false
+    },
+    "dispatchJoin": {
+      "type": "object",
+      "required": ["joinOutcome", "completedCount", "failedCount", "mergeOrder"],
+      "properties": {
+        "joinOutcome": { "type": "string", "enum": ["satisfied", "failed", "partial"] },
+        "completedCount": { "type": "integer", "minimum": 0 },
+        "failedCount": { "type": "integer", "minimum": 0 },
+        "cancelledCount": { "type": "integer", "minimum": 0 },
+        "mergeOrder": { "type": "array", "items": { "type": "string" }, "description": "childRunIds in the wall-clock terminal order used for output merging — the replay-deterministic tiebreak for colliding outputMapping keys." }
+      },
+      "additionalProperties": false
+    },
```

Both events carry the dispatching `core.dispatch` node-id in the envelope `nodeId` and set `causationId` to the consumed `runOrchestrator.decided` event (RFC 0007 §E), so replay reconstructs decision → fan-out → per-child → join even when concurrent runs interleave.

### §F Capability advertisement

RFC 0007 §G already reserves `capabilities.dispatch.fanOutSupported` (currently `false` for all conformant hosts). This RFC gives it meaning and adds two descriptors:

```diff
 {
   "capabilities": {
     "dispatch": {
       "supported": true,
       "models": ["child-run"],
-      "fanOutSupported": false,
+      "fanOutSupported": true,
+      "fanOutPolicies": ["sequential", "reject", "parallel"],
+      "joinModes": ["wait-all", "quorum", "first", "race"],
+      "maxFanOut": 16,
       "askUserRoutings": ["conversation", "clarification", "auto"]
     }
   }
 }
```

- `fanOutSupported: true` is the gate for accepting `fanOutPolicy: 'parallel'` at registration.
- `fanOutPolicies` / `joinModes` let an author detect partial support (a host MAY ship `parallel` + `wait-all` only and omit `quorum`). A `core.dispatch` node pinning a `joinPolicy.mode` not in `joinModes` is a registration `validation_error`.
- `maxFanOut` is the host's hard concurrency/breadth ceiling (§C). Absent → unbounded (authors SHOULD treat absent as "unknown, may be capped").

Hosts that advertise `dispatch.supported: true` but not `fanOutSupported: true` are fully conformant — `parallel` is opt-in.

### §G Replay determinism

Parallel dispatch is non-deterministic at **first** execution (children race) but MUST be deterministic on **replay**: the host re-folds `node.dispatched`, `core.dispatch.fanOut`, per-child terminals, and `core.dispatch.join` (including `mergeOrder`) from the event log without re-invoking children. The `mergeOrder` field (§E) is the canonical record of the output-merge tiebreak; a replay MUST apply `outputMapping` in `mergeOrder`, not in `nextWorkerIds` order. This makes a forked or replayed run reproduce the original's parent-variable state exactly even though the original children completed in a wall-clock order that a replay does not re-observe.

### §H Examples

**Positive — the campaign five-channel fan-out (wait-all, collect):**

```json
{
  "nodeId": "channel-dispatch",
  "typeId": "core.dispatch",
  "config": {
    "workerDispatchModel": "child-run",
    "fanOutPolicy": "parallel",
    "maxConcurrency": 5,
    "joinPolicy": { "mode": "wait-all", "onChildFailure": "collect" },
    "inputMapping": { "briefId": "briefId", "workspaceId": "workspaceId" }
  }
}
```

**Positive — quorum with fail-fast (need 3 of N vendor quotes, abort on hard error):**

```json
{
  "config": {
    "fanOutPolicy": "parallel",
    "joinPolicy": { "mode": "quorum", "quorum": 3, "onChildFailure": "fail-fast" }
  }
}
```

**Negative — `joinPolicy` without parallel (registration `validation_error`):**

```json
{ "config": { "fanOutPolicy": "sequential", "joinPolicy": { "mode": "wait-all" } } }
```

**Negative — `quorum` mode missing the `quorum` field (registration `validation_error`):**

```json
{ "config": { "fanOutPolicy": "parallel", "joinPolicy": { "mode": "quorum" } } }
```

**Negative — `parallel` without the capability (registration `validation_error` on a host advertising `fanOutSupported: false`):**

```json
{ "config": { "fanOutPolicy": "parallel", "joinPolicy": { "mode": "wait-all" } } }
```

## Compatibility

**Additive.** Lands in v1.2 (the version RFC 0007 §K3 names).

- `fanOutPolicy` gains an enum value; existing `'sequential'` / `'reject'` workflows are byte-identical and behave identically. The default is unchanged.
- `joinPolicy`, `maxConcurrency` are new optional fields with documented defaults (`wait-all` / `collect`, host-defined concurrency). A pre-RFC workflow omits them; a pre-RFC host that never sees `parallel` never evaluates them.
- `capabilities.dispatch.fanOutSupported` already exists; flipping it to `true` is an opt-in advertisement. `fanOutPolicies`, `joinModes`, `maxFanOut` are new optional capability descriptors that existing capability consumers ignore.
- New event `$defs` (`dispatchFanOut`, `dispatchJoin`) are additive; consumers that don't recognize them ignore them per the wire's forward-compat rule. They are emitted **only** on the parallel path, so a host that never runs a parallel dispatch never emits them.
- No required field is added, removed, or retyped on any existing schema; no error code or HTTP status changes meaning. No existing v1 conformance pass is invalidated.

Forward-compatibility clauses: a host on suite ≤1.x that does not implement this RFC stays conformant by advertising `fanOutSupported: false` and rejecting `parallel` at registration — the exact behavior it already has. A workflow authored with `fanOutPolicy: 'parallel'` is portable **only** to hosts advertising `fanOutSupported: true`; authors detect portability via the capability, not by trial.

## Conformance

Existing scenarios touching the area:

- `conformance/src/scenarios/subworkflow.test.ts` — child-run dispatch baseline (`core.subWorkflow` machinery the parallel path reuses).
- `conformance/src/scenarios/dispatchLoop.test.ts` — orchestrator → dispatch loop.
- `dispatch-next-worker-sequential.test.ts`, `dispatch-next-worker-reject.test.ts` (RFC 0007) — the two existing fan-out policies; these MUST remain green unchanged (proves the default did not move).

New scenarios required for `Accepted` (all gated on `capabilities.dispatch.fanOutSupported: true`):

- `dispatch-fanout-parallel-wait-all.test.ts` — three children, `wait-all` + `collect`; all three `node.dispatched` events present, `core.dispatch.fanOut.childCount === 3`, join emits after the last terminal, `joinOutcome: 'satisfied'`, output `children` length 3.
- `dispatch-fanout-parallel-partial.test.ts` — one child fails under `collect`; `joinOutcome: 'partial'`, node SUCCEEDS, failed child surfaces in `children[]` with its error, parent run does NOT fail.
- `dispatch-fanout-parallel-fail-fast.test.ts` — one child fails under `fail-fast`; remaining children cancelled (cascade events present), `joinOutcome: 'failed'`, run transitions to `failed`.
- `dispatch-fanout-parallel-quorum.test.ts` — `quorum: 2` of 3; join satisfied at the second completion, third child cancelled, `joinOutcome: 'satisfied'`.
- `dispatch-fanout-quorum-missing-field.test.ts` — `mode: 'quorum'` without `quorum` → `validation_error` at registration.
- `dispatch-fanout-joinpolicy-without-parallel.test.ts` — `joinPolicy` present with `fanOutPolicy: 'sequential'` → `validation_error`.
- `dispatch-fanout-unsupported-capability.test.ts` — `fanOutPolicy: 'parallel'` against a host advertising `fanOutSupported: false` → `validation_error` (this scenario runs **un-gated**, asserting graceful rejection on non-supporting hosts).
- `dispatch-fanout-replay-merge-order.test.ts` — two children map to the same parent variable; replay re-applies `outputMapping` in the logged `mergeOrder`, reproducing the original parent-variable value (RFC 0041 replay determinism).
- `dispatch-fanout-max-concurrency.test.ts` — `nextWorkerIds.length 4`, `maxConcurrency: 2`; never more than 2 children in `running` simultaneously (asserted via interleaved `node.dispatched` / child-terminal events), all 4 still complete.

The replay-merge-order and max-concurrency scenarios are **suite-version requirements** (suite 1.x asserts stricter determinism/observability than the prose strictly compels) per `COMPATIBILITY.md` §2.3 and are tagged as such.

## Alternatives considered

1. **Do nothing — keep sequential-only.** Rejected: it forces every fan-out author into either a monolithic mega-child (losing per-child run lineage, independent approval gates, and replay isolation) or a `vendor.*` parallel dispatch model that breaks cross-host portability — the precise failure RFC 0007 §Motivation exists to prevent. The campaign workflow's 5× serialization (≈25 min vs ≈5 min) is a concrete cost, and a single channel's HITL stall blocking all others is a correctness-of-experience problem, not just throughput.
2. **A separate `core.parallelDispatch` typeId** instead of extending `fanOutPolicy`. Rejected: RFC 0007 already made `fanOutPolicy` the home for fan-out behavior and named `parallel` as its next value (§K3). A second node type bifurcates the dispatch surface, duplicates the input/output-mapping config, and forces authors to choose a node type by concurrency — a per-config decision, not a per-node-type one.
3. **`joinPolicy` as a flat enum** (e.g. `joinPolicy: 'wait-all'`) rather than an object. Rejected: §K3 itself flags that the hard part is **error aggregation** — which is orthogonal to completion (`mode`). A flat enum would have to cross-product `{wait-all, quorum, first, race} × {fail-fast, absorb, collect}` into a dozen opaque tokens. The two-field object names the two independent axes and keeps each extensible.
4. **Implicit unbounded parallelism (no `maxConcurrency`).** Rejected: a 200-child fan-out would let a single run exhaust a host's worker pool. Bounded concurrency with an advertised `maxFanOut` ceiling lets authors plan and hosts self-protect, and degrades gracefully to waves rather than rejecting the workflow.
5. **Resolve §K1 (same-run sibling nodes) here too**, dispatching children as DAG peers rather than child runs for lower boot cost. Rejected: re-entrancy and cross-sibling state-sharing are non-trivial (RFC 0007 §K1 defers to ~v1.3) and independent of the join-policy question this RFC answers. Keeping child-run semantics means the parallel path reuses the already-conformant `core.subWorkflow` lineage, attestation (RFC 0063), and ancestry (RFC 0040) machinery unchanged.

## Unresolved questions

1. **Default `onChildFailure`.** This RFC defaults to `'collect'` (no individual failure short-circuits) on the argument that independent fan-out children are the common case. Should the default instead be `'fail-fast'` to match the single-child `core.subWorkflow.onChildFailure: 'fail-parent'` default, accepting that it makes the campaign case opt-in? Maintainer call before `Active`.
2. **`race` vs `first` overlap.** `'first'` (first `completed`) and `'race'` (first terminal of any kind) are close. Is the distinction worth two enum values, or should `'race'` be expressed as `mode: 'first'` + `onChildFailure: 'fail-fast'`? The current split avoids overloading two orthogonal axes, but it is a judgment call.
3. **Partial-output streaming (§K2) beyond fan-out/join markers.** This RFC emits `core.dispatch.fanOut` / `core.dispatch.join` but does NOT stream per-child `output.chunk` events. Is the coarse pair sufficient for SSE consumers driving a live campaign progress UI, or does the parallel case also need the §K2 streaming resolution? Deferrable to a follow-up.
4. **Cross-host parallel children.** RFC 0040 ancestry covers cross-host child runs. Are there join-policy hazards when concurrent children run on **different** hosts (clock skew affecting `mergeOrder`, partial-failure visibility lag)? May need an explicit note that `mergeOrder` is the *parent host's* observed terminal order, which it already is.
5. **Interaction with `iterationCap`.** A parallel wave dispatches N children "at once." Does each child count as one dispatch-iteration against `iterationCap` (so a `maxConcurrency: 5` fan-out consumes 5), or does the fan-out node count once? Proposed: one per child (consistent with sequential), but this must be pinned.

## Implementation notes (non-normative)

- The reference TypeScript host already serializes children in a transient channel for `'sequential'` (RFC 0007 §implementation-notes). The parallel path swaps the serial `await` for a bounded `Promise.allSettled` over a concurrency-limited queue, then folds terminals per `joinPolicy`. The `core.subWorkflow` child-construction, lineage (`parentRunId`/`parentNodeId`), attestation (RFC 0063), and ancestry (RFC 0040) machinery are reused unchanged — only the scheduling and the join/merge step are new.
- `mergeOrder` is the host's observed child-terminal order; persist it on the `core.dispatch.join` event at first execution and read it on replay. Do NOT recompute it from child timestamps (clock skew across cross-host children, §UQ4).
- Sequencing: this RFC is the wire dependency for openwop-app's Campaign Studio port (`docs/campaign-studio-prd.md`, the channel fan-out phase). The host port's parent orchestration can be authored against `fanOutPolicy: 'parallel'` the moment the host advertises `fanOutSupported: true`; until then it falls back to `'sequential'` (correct, just slower) with no workflow rewrite — only a config flip. The host should ship sequential first, then flip the flag when the parallel scheduler + the nine conformance scenarios are green.
- Cross-cut: add a `CC-N` entry to the impl plan only if the reference host's dispatch executor is mid-refactor; otherwise this is an additive executor change that can merge independently.

## Acceptance criteria

- [ ] Spec text merged (`node-packs.md` `core.dispatch` fan-out section + `capabilities.md` `capabilities.dispatch.*`).
- [ ] `dispatch-config.schema.json` updated (`fanOutPolicy` enum + `joinPolicy` + `maxConcurrency`); `run-event-payloads.schema.json` adds `dispatchFanOut` / `dispatchJoin` `$defs`; `api/asyncapi.yaml` references them.
- [ ] At least one conformance scenario per §B mode + the partial/fail-fast/replay-merge cases land in `@openwop/openwop-conformance` (v1.2 bump per the minor-version rule).
- [ ] CHANGELOG entry under v1.2 `### Added` citing RFC 0118 and closing RFC 0007 §K3.
- [ ] Reference host (per `ROADMAP.md`) implements `fanOutPolicy: 'parallel'` + advertises `fanOutSupported: true` and passes the new scenarios, OR the RFC explicitly defers reference-host implementation to a named milestone.

## References

- RFC 0007 (Dispatch) — §D fan-out semantics, §G capability shape, **§K3 the deferral this RFC closes**.
- RFC 0006 (Orchestrator) — the `OrchestratorDecision` (`next-worker`) this dispatches.
- RFC 0022 (Dispatch input/output mapping) — per-child `inputMapping` / `outputMapping` reused under fan-out.
- RFC 0063 (Sub-run output attestation & merge gating) — per-child attestation composes with the parallel merge.
- RFC 0040 (Multi-agent cross-host causation) — child-run ancestry / `parentRunId` lineage the parallel children inherit.
- RFC 0041 (Replay) — the determinism guarantee §G satisfies via `mergeOrder`.
- `interrupt-profiles.md` §Parent-child cascade — the cancellation cascade `quorum`/`first`/`race`/`fail-fast` invoke for in-flight children.
- Prior art: BPMN parallel gateway (fork/join) + completion conditions; Temporal child-workflow `ParallelExecution` + `Promise.allSettled` join; LangGraph `Send` API fan-out; Step Functions `Map`/`Parallel` states with `ToleratedFailurePercentage` (the `joinPolicy.onChildFailure` analogue).
- Implementer: `openwop-app/docs/campaign-studio-prd.md` (Campaign Studio port) — the motivating five-channel parallel fan-out.
