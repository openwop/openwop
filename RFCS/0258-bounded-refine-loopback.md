# RFC 0258: Bounded refine loopback for approval gates

| Field             | Value |
| ----------------- | ----- |
| **RFC**           | 0258 |
| **Title**         | Bounded refine loopback for approval gates |
| **Status**        | `Draft` |
| **Author(s)**     | David Tufts (@davidscotttufts) |
| **Created**       | 2026-11-04 |
| **Updated**       | 2026-11-04 — Draft revision: §C.4 states the `historyInput` entry shape exactly and adds a host-advertised per-entry size cap (`capabilities.loopback.maxHistoryEntryBytes` >= 4096 in the `loopback` facet, measured over JCS, typed `{truncated, bytes}` marker; UQ 7.5), at Book AI's request. No status, schema or suite change. Earlier 2026-11-04 — filed `Draft`. Registers only; no spec, schema or suite change yet. The schema diffs below are the proposal and land with the `Active` flip. No host advertises anything. |
| **Affects**       | `schemas/v2/workflow-definition.schema.json` `$defs/WorkflowEdge` (one optional property, new `$defs/EdgeLoopback`) · `schemas/v2/workflow-chain-pack-manifest.schema.json` `$defs/FragmentEdge` (same property) · `schemas/v2/run-event-payloads.schema.json` `$defs/nodeCompleted` (one optional property), `$defs/capBreached.kind` (one enum member), `$defs/workflowLoopbackLimit` (description binds it) · `schemas/v2/suspend-request.schema.json` `$defs/ApprovalData` (one optional property) · `schemas/v2/capabilities.schema.json` (one optional top-level facet `loopback`) · no new `spec/v2/core` prose: the core is at 36,795 of 36,800 words, so §§A–F are homed in the schema descriptions above, as RFC 0257 did (gap G1) · `spec/v2/surface-baseline.json` (regenerated) · conformance: one scenario, three fixtures · `conformance/fixtures.md` · CHANGELOG. v1 is frozen and is not touched. |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.4 (optional properties on closed v2 objects, a new optional capability facet, one new enum member on an event payload whose consumers MUST accept unknown members). Nothing changes for a definition without `loopback`. |
| **Supersedes**    | — |
| **Superseded by** | — |

## Summary

An approval gate can already offer `refine` (RFC 0183), but nothing says what a refine *does*: on every host measured it ends the gate, and the only way to act on the reviewer's feedback is to start a fresh run that repeats every upstream step. This RFC adds a declared, bounded loopback: a `WorkflowEdge` from the gate back to the node that produced the artifact, marked `loopback: { on: "refine", maxIterations }`. When the reviewer refines, the host re-runs that region of the graph, hands the producer every earlier round's artifact and feedback rebuilt from the event log, and asks the gate again under a new interrupt key. The cap is required and is never "unlimited"; when it is spent the gate stays open without `refine` (the default) or a further refine fails the run with a typed error, as the author chooses.

## Motivation

### Who hits it

Book AI (a tenant product on openwop-app) shows a candidate passage, a title or a selection to the author through `core.chat.approvalGate`, with three choices: accept, reject, and "Another option". "Another option" is a refine. Its chains are two nodes, `candidate → review`. Today a refine returns `{decision: "refine", approved: false}` and the gate ends; Book AI's workaround ends the run and starts a fresh one with the feedback, which re-runs every upstream step on the author's paid model key, loses the run's history, and cannot be replayed as one unit. Their stated need (2026-11-04): re-enter `candidate`, hand it every prior round oldest first (the feedback text and the candidate it replaced, so it does not repeat itself), cap at three rounds, and when the cap is spent keep the gate open with accept and reject only, without failing the run.

This is the general shape of every "generate → review → revise" loop: content drafting, code review bots, design critique, plan approval.

### What the corpus says today

Measured at openwop `aebc4a84`:

- `spec/v2/core/interrupt.md` §Re-entry and resume values already requires a per-visit `key`: "a later execution of the node, reached over an edge, MUST derive a different key". So re-asking a gate is specified. Nothing specifies how a run gets back to the gate's producer.
- §Approval lists `refine` with its `refineFeedback` and says nothing about the gate's outcome. RFC 0223 settled `reject` only.
- `schemas/v2/workflow-definition.schema.json` `settings.maxLoopbackIterations` (min 1, default 5) is an authoring hint the protocol does not enforce (openwop#1748, closed as reading 2: "a future additive RFC may bind it"). The event `workflow.loopback-limit {nodeId, iterations, limit}` is registered with no rule that emits it.
- Undeclared cycles are host-defined. The v2 reference host runs them, bounded only by `configurable.run.recursionLimit`; openwop-app refuses them (`cycle_detected`); MyndHyve runs them with per-node caps. A loop authored on one host is unbounded, bounded differently, or refused on another.

### What the hosts do

| Host | A gate's `refine` | Loop bound |
| --- | --- | --- |
| openwop-app | `core.approvalGate` completes with the resume value as output; `core.chat.approvalGate` completes with `decision: "refine"`. Neither re-enters anything; a back-edge is refused unless one end is `core.dispatch` or a supervisor. | `core.chat.approvalGate` `maxRequestChangesIterations`, where the default `0` means **unlimited**. |
| v2 reference host | Completes; a plain back-edge can route it. | `recursionLimit` only. |
| MyndHyve | Completes; plain back-edges re-fire. | Per-node `maxRequestChanges`. |

### Why the spec is the right place

A loop changes the event log every consumer reads (several `node.started` per node, several interrupts per gate), replay and fork must reproduce it, and a chain pack that loops must behave the same on every host that admits it. Without a declared shape, a chain author cannot write a bounded loop portably: the bound lives in vendor node config whose zero value means "forever" on one host.

## Proposal

### Definitions

- **Loopback edge.** A `WorkflowEdge` (or a chain `FragmentEdge`) carrying `loopback`. Its `sourceNodeId` is the **gate**; its `targetNodeId` is the **target**.
- **Forward graph.** The definition's edges with every loopback edge removed.
- **Region.** The target, the gate, and every node on a forward-graph path from the target to the gate.
- **Round.** One taking of the loopback edge. Rounds are counted per loopback edge from 1.

### §A — Shape

`WorkflowEdge.loopback` (and `FragmentEdge.loopback`) is a closed object, `$defs/EdgeLoopback`:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `on` | `"refine"` | yes | The approval action that takes the edge. This revision admits only `refine`. |
| `maxIterations` | integer, `minimum: 1` | yes | The most rounds this edge may be taken in one run. There is no default and no zero: a loop with no bound cannot be declared. |
| `onExhausted` | `"withdraw"` \| `"fail"` | no, default `"withdraw"` | What happens once `maxIterations` rounds have been taken (§D). |
| `historyInput` | string (a port key) | no | When present, the target receives the round history on this input port (§C.4). |

A loopback edge **MUST NOT** carry `condition`, `sourceOutput`, `targetInput` or `triggerRule`. Which settle takes it is decided by `on`, and what it delivers by `historyInput`, so none of the four has a meaning here.

### §B — Admission

**The cycle exemption, exactly.** v2 definition validation refuses cycles on hosts that do not run them. This RFC exempts one edge kind and no other: a declared `loopback` edge MAY close a cycle, and only from an approval gate back to an ancestor of that gate. Every other cycle keeps its host-defined treatment.

A host that advertises `capabilities.loopback` (§E) **MUST** refuse, with `400 validation_error`, at registration, instantiation from a chain, and run creation with an inline definition, a definition in which:

1. the forward graph has a cycle;
2. the target is not an ancestor of the gate in the forward graph;
3. the region is not closed: some node of the region other than the gate has an outgoing forward edge to a node outside the region;
4. two loopback edges have regions that share a node;
5. a loopback edge's `maxIterations` exceeds `capabilities.loopback.maxIterations`;
6. the gate is a node the host can determine will never raise an `approval` interrupt offering `refine`.

Edges from outside the region into it are allowed; their sources are not re-run. A host that does not advertise `capabilities.loopback` **MUST** refuse any definition carrying `loopback` with `capability_required`, and **MUST NOT** run the edge as a plain cycle or drop it. (A host validating against the closed v2 schema of an earlier suite already refuses it.)

`settings.maxLoopbackIterations` is unchanged: it **MUST NOT** admit a cycle or bound a loopback edge.

### §C — Taking the edge (home: `run-event-payloads.schema.json` `$defs/nodeCompleted.loopback` and `$defs/EdgeLoopback`)

When the gate's approval interrupt resolves with `action: "refine"` and the loopback edge has taken fewer than `maxIterations` rounds:

1. **The gate completes, marked.** The gate's `node.completed` **MUST** carry `loopback`: `{ edgeId, targetNodeId, round, rearmed }`, where `round` is this taking's 1-based number and `rearmed` lists every region node in `nodes[]` order. The marker is the only record of the decision: the host **MUST** decide a re-arm from it, never by re-evaluating the resolution, on replay, fork and recovery.
2. **Nothing leaves the region.** For this settle the host **MUST NOT** evaluate the gate's other outgoing edges. No node outside the region changes state, and none is skipped.
3. **The region re-arms.** Every region node returns to pending, its previous outputs no longer feed any edge. The target becomes ready against its incoming forward edges, whose sources keep their recorded outcomes. Each region node then executes again as a new visit: `node.started` again, and for the gate a new `interrupt.requested` under a new `key` (interrupt.md §Re-entry and resume values, unchanged).
4. **History.** When `historyInput` is declared, the target **MUST** receive on that port an array with one entry per round taken so far, oldest first:

   ```json
   { "round": 1, "outputs": { "candidate": "…" }, "refineFeedback": { "scope": "whole", "text": "Darker, and shorter." } }
   ```

   Each entry is a closed object:

   | Field | Type | Present | Value |
   | --- | --- | --- | --- |
   | `round` | integer >= 1 | always | the round this entry records (the marker's `round`) |
   | `outputs` | object | always | the target's own `node.completed.outputs` from that round, i.e. what the reviewer was shown, as the target produced it. A single-port producer's value is `outputs.<port>` (Book AI: `outputs.candidate`). |
   | `refineFeedback` | object | when the resolution carried it | the gate's `interrupt.resolved.refineFeedback` from that round (RFC 0183 shape; free text is `refineFeedback.text`) |

   The array has exactly one entry per round taken, so its length is at most `maxIterations`. The host **MUST** rebuild the array from the run's event log. It **MUST NOT** add timestamps, principals, run ids or interrupt keys, so the same rounds yield the same bytes in any run, replay or fork. On the target's first visit the port receives `[]`.

   **Size cap.** A host advertising `capabilities.loopback` **MUST** advertise `maxHistoryEntryBytes` (§E), and it **MUST** be at least 4096 so a host cannot starve the loop. A round's size is the UTF-8 byte length of the JSON Canonicalization Scheme (RFC 8785, JCS) serialization of its recorded `node.completed.outputs`; every host measures the same bytes. When that size exceeds `maxHistoryEntryBytes`, the entry's `outputs` **MUST** be replaced by the typed marker `{ "truncated": true, "bytes": <that length> }`. `round` and `refineFeedback` are kept unchanged. The marker is computed from the recorded outputs only, and JCS makes the measurement independent of key order and whitespace, so a replay or fork on any host yields the same entry. A consumer that finds `truncated: true` knows the round happened and what the reviewer said, not what they were shown.

5. **Limits still apply.** Every re-execution counts toward `recursionLimit` and `limits.maxNodeExecutions` (runs.md §run section). A retry inside a round stays in that round's visit.
6. **Replay and fork.** The round count and each visit's interrupt key **MUST** come from recorded events (the markers and the gate's `interrupt.resolved` events), never from a live counter, so a fork taken at round *k* reproduces round *k*. A `replay` fork reproduces each round from the recorded markers and resolutions. A fork whose prefix ends after a marked `node.completed` **MUST** resume with the region re-armed by that marker, not with the gate completed.

When the resolution is any other action, the edge is not taken and the gate settles exactly as it would without one: `accept` / `edit-accept` complete it and release its forward edges, and `reject` follows interrupt.md §Rejection.

### §D — Exhaustion

The gate's `ApprovalData` **MUST** carry `loopback: { round, maxIterations, exhausted }` on every visit of a gate that is the source of a loopback edge, where `round` is the number of rounds taken before this visit and `exhausted` is `round >= maxIterations`. Then:

- **`onExhausted: "withdraw"`** (default). On an exhausted visit the host **MUST** omit `refine` from `actions`, and **MUST** refuse a `refine` resume with `400 validation_error` (interrupt.md §Approval already enforces `actions` on resolve). No event marks the withdrawal beyond that visit's `interrupt.requested` (whose `ApprovalData.loopback.exhausted` is `true`); the host **MUST NOT** emit `workflow.loopback-limit` or `cap.breached` for it. The run stays `waiting-approval`, and its terminal status is whatever the remaining actions produce: `accept` / `edit-accept` complete the gate and release its forward edges, `reject` follows interrupt.md §Rejection. A gate whose only action is `refine` cannot be withdrawn; on its exhausted visit the host **MUST** fail the run as for `"fail"`.
- **`onExhausted: "fail"`.** `refine` stays offered. A `refine` resolution on an exhausted visit **MUST** emit `workflow.loopback-limit { nodeId: <gate>, iterations: maxIterations, limit: maxIterations }`, then `cap.breached { kind: "loopback-iterations", limit: maxIterations, observed: maxIterations + 1 }`, and fail the run with `loop_limit_exceeded` and `failedNodeId` naming the gate. The interrupt still records `action: "refine"`.

So a cap of 3 allows three refines: four artifacts are shown, the fourth without "refine".

### §E — Capability

`capabilities.loopback` (optional, closed): `{ "maxIterations": integer >= 1, "maxHistoryEntryBytes": integer >= 4096 }`. `maxIterations` is the host's ceiling for any edge's `maxIterations`; `maxHistoryEntryBytes` is §C.4's per-entry `outputs` cap, measured over JCS. Both are members of the `loopback` facet (UQ 7.1: homed in `spec/v2/declaration.json` + `spec/v2/facets/`, from which `capabilities.schema.json` is generated). A host MAY set it as low as it likes and MUST advertise the value it enforces (§B.5 refuses above it). Present means the host implements §§A–D. A client **MUST NOT** submit a definition carrying `loopback` to a host that does not advertise it.

### §E.1 — Loopback edges are not forward edges (RFC 0257, trigger rules)

A loopback edge is not part of the forward graph for any other rule. In particular:

- **Trigger rules.** A target's `triggerRule` is evaluated over its incoming forward edges only. A loopback edge that is not taken contributes nothing and never makes its target `skipped`.
- **RFC 0257.** "Terminal node" is computed on the forward graph: a gate whose only outgoing edge is a loopback edge is terminal. This refines RFC 0257's "a node whose only outgoing edges close a cycle is not terminal" for declared loopback edges. A run that ends after an `accept` on such a gate completed a terminal, so `skippedTerminals` is absent. A loopback edge never adds a node to `skippedTerminals`.

### §F — Chain packs (home: `workflow-chain-pack-manifest.schema.json` `$defs/FragmentEdge.loopback`)

A host **MUST** carry `loopback` through chain expansion verbatim, as it does `condition` and `triggerRule`. A loopback edge joins two nodes of one fragment; a sub-chain is one node of its parent, so a loopback cannot cross a sub-chain boundary, and a sub-chain node inside a region is re-dispatched on each round as a new child run.

### Wire shape changes

`schemas/v2/workflow-definition.schema.json`:

```diff
     "WorkflowEdge": {
       "properties": {
         …
         "triggerRule": { … },
+        "loopback": { "$ref": "#/$defs/EdgeLoopback" }
       },
       "additionalProperties": false
     },
+    "EdgeLoopback": {
+      "type": "object",
+      "description": "RFC 0258 — a declared, bounded loopback. The edge runs from an approval gate back to the node whose output it reviews; a refine re-runs that region (RFC 0258).",
+      "required": ["on", "maxIterations"],
+      "properties": {
+        "on": { "type": "string", "enum": ["refine"] },
+        "maxIterations": { "type": "integer", "minimum": 1 },
+        "onExhausted": { "type": "string", "enum": ["withdraw", "fail"], "default": "withdraw" },
+        "historyInput": { "type": "string", "minLength": 1 }
+      },
+      "additionalProperties": false
+    }
```

The edge-level exclusions in §A (no `condition`, `sourceOutput`, `targetInput`, `triggerRule` beside `loopback`) are expressed with `if/then` on `WorkflowEdge`. `FragmentEdge` gains the same property and the same exclusions (`$defs/EdgeLoopback` inlined, as `EdgeCondition` already is).

`schemas/v2/run-event-payloads.schema.json`:

```diff
     "nodeCompleted": {
       "properties": {
         "nodeId": …, "outputs": …, "durationMs": …,
+        "loopback": {
+          "type": "object",
+          "description": "RFC 0258 §C.1 — this completion took a declared loopback edge; the listed nodes re-arm.",
+          "required": ["edgeId", "targetNodeId", "round", "rearmed"],
+          "properties": {
+            "edgeId": { "type": "string", "minLength": 1 },
+            "targetNodeId": { "$ref": "ids.schema.json#/$defs/nodeId" },
+            "round": { "type": "integer", "minimum": 1 },
+            "rearmed": { "type": "array", "items": { "$ref": "ids.schema.json#/$defs/nodeId" }, "minItems": 2, "uniqueItems": true }
+          },
+          "additionalProperties": false
+        }
       }
     },
     "capBreached": { "properties": { "kind": { "enum": [ …, "budget-retries"
+      , "loopback-iterations" ] } } }
```

`schemas/v2/suspend-request.schema.json` `ApprovalData` gains `loopback: { round: integer >= 0, maxIterations: integer >= 1, exhausted: boolean }`, all required, closed. `schemas/v2/capabilities.schema.json` gains top-level `loopback: { maxIterations: integer >= 1, maxHistoryEntryBytes: integer >= 4096 }`, both required, closed (homed per UQ 7.1).

### Examples

Positive (Book AI's chain, abridged):

```json
{
  "nodes": [
    { "id": "candidate", "typeId": "vendor.bookai.author-suite.nodes.candidate" },
    { "id": "review", "typeId": "core.chat.approvalGate", "config": { "actions": ["accept", "reject", "refine"] } },
    { "id": "apply", "typeId": "vendor.bookai.author-suite.nodes.apply" }
  ],
  "edges": [
    { "id": "e1", "sourceNodeId": "candidate", "sourceOutput": "candidate", "targetNodeId": "review", "targetInput": "artifact" },
    { "id": "again", "sourceNodeId": "review", "targetNodeId": "candidate",
      "loopback": { "on": "refine", "maxIterations": 3, "historyInput": "rounds" } },
    { "id": "e2", "sourceNodeId": "review", "targetNodeId": "apply", "condition": { "type": "truthy", "left": "approved" } }
  ]
}
```

Negative:

| Definition | Refused because |
| --- | --- |
| `"loopback": { "on": "refine" }` | schema: `maxIterations` required |
| `"loopback": { "on": "refine", "maxIterations": 0 }` | schema: `minimum: 1` |
| `"loopback": { "on": "reject", "maxIterations": 2 }` | schema: `on` admits only `refine` |
| a loopback edge that also carries `condition` | schema: §A exclusion |
| `candidate → review`, `candidate → notify`, loopback `review → candidate` | §B.3: `notify` leaves the region |
| loopback `review → candidate` where `candidate` is not upstream of `review` | §B.2 |
| any `loopback` on a host without `capabilities.loopback` | §B, `capability_required` |

## Compatibility

`additive`:

- Every new property is optional on a closed v2 object; a definition, event or interrupt without it is unchanged, byte for byte. In particular a gate with no loopback edge keeps exactly its current keys, events and `ApprovalData`.
- A host that does not advertise `capabilities.loopback` keeps its behaviour, and must refuse a `loopback`-bearing definition rather than run it as a plain cycle (§B). A host validating against an earlier suite's closed `WorkflowEdge` already refuses it.
- `capBreached.kind` gains a member; events.md §Growth requires a consumer to accept an unknown registered member.
- `workflow.loopback-limit` gains its first emitting rule; its payload is unchanged.
- Undeclared cycles stay host-defined. This RFC neither licenses nor forbids them.

## Conformance

Existing: `v2-approval-reject-disposition.test.ts` (leg 8 uses an undeclared reject cycle; unchanged), `interrupt-approval.test.ts` (refine round-trip; unchanged).

New scenario `v2-bounded-loopback.test.ts`, gated on `capabilities.loopback`; `inapplicable` without it. Fixtures:

- `conformance-loopback-refine`: `draft` (`core.noop`) → `gate` (`core.approvalGate`, actions accept/reject/refine) → `apply` (`core.noop`), loopback `gate → draft` `{ on: refine, maxIterations: 2, historyInput: "rounds" }`.
- `conformance-loopback-refine-fail`: the same with `onExhausted: "fail"`, `maxIterations: 1`.
- `conformance-loopback-open-region`: adds `draft → side`; MUST be refused (§B.3).

| Requirement id (`openwop.requirement.0258.*`) | Leg |
| --- | --- |
| `refine-rearms` | refine once: the gate's `node.completed` carries `loopback {round: 1, rearmed: [draft, gate]}`, `draft` starts again, a second `interrupt.requested` with a different `key`, `apply` never started |
| `history-from-log` | `draft`'s second `node.started`/inputs or its `node.completed` echo shows `rounds` = one entry with round 1's `outputs` and `refineFeedback`, no timestamp |
| `approval-data-loopback` | each request's `ApprovalData.loopback` reads `{0,2,false}`, `{1,2,false}`, `{2,2,true}` |
| `withdraw-refine` | after two refines, the third request's `actions` omit `refine`, a refine resume answers `400 validation_error`, the run is still `waiting-approval`; accept completes it and `apply` runs once |
| `fail-on-exhausted` | `-fail` fixture: refine, refine → `workflow.loopback-limit`, `cap.breached {kind: loopback-iterations}`, `run.failed` `loop_limit_exceeded`, `failedNodeId: gate` |
| `open-region-refused` | registering `-open-region` answers `400 validation_error` |
| `replay-rearms` (gated also on `replay` mode `replay`) | a replay fork at round 1's marked `node.completed` reaches the gate's second visit without a new caller decision for round 1 |

Server-free legs (always run): the negative schema rows above against `schemas/v2`.

### Falsifiability

| Requirement | Observable | Who can cause it | Verdict |
| --- | --- | --- | --- |
| §A shape and exclusions | schema validation | the suite, server-free | witnessable |
| §B.1–B.4 refusals | `400 validation_error` on registration | the suite | witnessable — gated |
| §B.5 ceiling | `400` for `maxIterations` above the advertised ceiling | the suite (reads the ceiling) | witnessable — gated |
| §B.6 non-gate source | — | depends on what a host can determine statically | **unwitnessable** — host-judged: what a host can determine statically is not observable on the wire, so the rule is MAY-shaped in effect (UQ 7) |
| §B non-advertiser refuses | `capability_required` | the suite, against a host without the facet | witnessable — on non-advertisers |
| §C.1 marker | `node.completed.loopback` | the suite (one refine) | witnessable — gated |
| §C.2 nothing leaves the region | `apply` has no `node.started`/`node.skipped` before accept | the suite | witnessable — gated |
| §C.3 re-arm and new key | second `node.started` for `draft`, second `interrupt.requested` with a new key | the suite | witnessable — gated |
| §C.4 history from the log, no run-scoped bytes | `rounds` content | the suite, if the target's inputs are observable (`core.noop` echoes) | witnessable — gated, see Unresolved 3 |
| §C.4 size cap | an entry over `maxHistoryEntryBytes` arrives as `{truncated: true, bytes}` with `round` and `refineFeedback` intact | the suite (a fixture producer whose output exceeds the advertised cap) | witnessable — gated |
| §C.5 limits | `recursion_limit_exceeded` with a small `recursionLimit` | the suite | witnessable — gated (not in the first scenario) |
| §C.6 replay | fork behaviour | the suite, with `replay` | witnessable — doubly gated |
| §D withdraw / fail | `actions`, `400`, events, terminal | the suite | witnessable — gated |

## Alternatives considered

1. **Do nothing.** Every loop stays a fresh run (Book AI's workaround) or an undeclared cycle whose bound differs per host. Rejected: the duplication of paid upstream work and the per-host bound are the two problems.
2. **`refineTo: <nodeId>` on the gate's config.** The smallest change for one host. Rejected: v2 does not schema node `config`, so the protocol could not validate or carry it; it would have to be added to every gate type separately (`core.approvalGate`, `core.chat.approvalGate`, `core.interrupt`); a builder cannot draw it as an edge; and admitting a cycle is a graph decision, not a node's.
3. **Bind `settings.maxLoopbackIterations` to undeclared cycles** (openwop#1748 reading 1). Rejected: one number per definition cannot bound two loops differently, it does not say which settle takes the loop, and it would change the meaning of every existing cyclic definition on hosts that run cycles today.
4. **Conditioned loopback on any node** (`condition` + `maxIterations`, no `on`). More general. Deferred (Unresolved 1): a non-gate loop has no reviewer, so "withdraw" has no meaning and the region rules need a failed-settle story (a retry after a failure reads as the same visit today). Starting with the gate keeps every rule witnessable.
5. **Feedback in a run variable.** The lead design for one host. Rejected: run variables are not rebuilt from the log on that host, so a fork cut mid-loop would hand the target a different history and the replayed model call would diverge. §C.4 rebuilds from recorded events instead.
6. **A separate `workflow.looped-back` event for the re-arm.** Rejected in favour of a field on the gate's own `node.completed`: one event, no window between the gate settling and the re-arm being recorded, and no v2-only event row (the event codemap is keyed on v1 names).

## Unresolved questions

1. Should a later revision admit `on: "reject"` and conditioned non-gate loopbacks (Alternative 4)? What does a failed settle mean for visits and retries there?
2. Should `historyInput` entries carry `decidedBy`? It is useful to an agent ("the editor asked for…") but is a principal reference in model-bound text. This draft says no.
3. `history-from-log` needs the target's inputs to be observable. `core.noop` echoing its inputs on `node.completed.outputs` is the current convention; confirm, or add a dedicated `core.echo`.
4. Should `ApprovalData.loopback` also be required on `interrupt.resolved`? This draft records it on the request only.
5. Is `400 validation_error` the right refusal for §B, or a dedicated `loopback_invalid` code with `details.reason`?
6. The comment window. This RFC binds replay (§C.6), so RFC 0147 §A.6 forbids a bootstrap waiver, and only the steward can override it. Until it flips, this merges as a `Draft` and hosts keep it default-off and unadvertised.

7. **openwop-be review, to fix before `Active` (2026-11-04):**
   1. The capability facet belongs in `spec/v2/declaration.json` and `spec/v2/facets/`; `capabilities.schema.json` is generated from them, so §E's diff targets the wrong file.
   2. §B's "a host that does not advertise `capabilities.loopback` MUST refuse with `capability_required`" binds every existing host to new behaviour, and every one of them would fail it. Scope the MUST to advertisers. For non-advertisers it remains §E's client rule plus the closed `WorkflowEdge` schema.
   3. §B.6 is an unwitnessable MUST, as the falsifiability table already admits. Either make it witnessable (a closed list of gate types) or make it a SHOULD.
   4. The comment window can be waived only by the steward, given directly to openwop-be (RFC 0147 §A.6: this RFC binds replay). See UQ 6.
   5. §C.4's size cap (Draft revision, 2026-11-04): confirm the 4096 floor, JCS (RFC 8785) as the measure, and that a truncated entry keeps `refineFeedback`. Register gap G5 is left as filed, so the corpus stamp does not move; its disposition changes with the `Active` flip.

## Implementation notes (non-normative)

openwop-app (ADR to be reserved there) plans four PRs behind a default-off host flag, advertising `capabilities.loopback` only once this RFC is `Active` with the shape locked:

1. Per-visit interrupt keys for `ctx.suspend` nodes (today a `resumeKey` equal to the node id repeats on every visit) and visit-aware by-node lookups, with keys for visit 0 byte-identical to today's.
2. Admission (§B), the marker (§C.1), release suppression and the fold that re-arms from the marker.
3. History rebuilt from the log (§C.4), `ApprovalData.loopback`, withdraw/fail (§D).
4. `core.chat.approvalGate` alignment (its own counter and its `0 = unlimited` default are ignored when a loopback is declared), chain-loader carry-through, and Book AI's chains.

Prior art: BPMN 2.0 loops back through gateways with no built-in bound; Temporal and LangGraph express review loops in code (`while` with a counter; LangGraph's `recursion_limit`); AWS Step Functions loops with a `Choice` state and a counter in state. None declares the bound on the loop edge itself, which is what makes the bound portable here. (From the author's knowledge of those systems, not a fresh survey.)

## Acceptance criteria

- [ ] Normative text merged in its schema-description homes (gap G1).
- [ ] Schemas updated; `spec/v2/surface-baseline.json` regenerated.
- [ ] `v2-bounded-loopback.test.ts` and its three fixtures in the suite.
- [ ] CHANGELOG entry.
- [ ] A certified host bundle records the `0258.*` rows `executed-pass` (openwop-app is the planned first witness; the v2 reference host is not committed to).

## References

- Book AI P48 (relayed 2026-11-04): the use case, cap 3, withdraw on exhaustion.
- openwop#1748 (`settings.maxLoopbackIterations` unbound), openwop#1697 (per-visit keys), RFC 0183 (refine fidelity), RFC 0223 (reject disposition), RFC 0257 (skipped terminals), RFC 0133 (sub-chains), RFC 0185 (vendor hatch on closed defs).
- openwop-app ADR 0772 D5 (an earlier host design for loopback, never shipped) and ADR 1002 (the invocation log, already split per visit).
- Registers: `RFCS/registers/0258-bounded-refine-loopback.gaps.md`, `RFCS/registers/0258-bounded-refine-loopback.risks.md`.
