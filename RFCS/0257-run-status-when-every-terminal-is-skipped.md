# RFC 0257: Run status when every terminal node is skipped

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0257                                                            |
| **Title**         | A run in which no node failed and every terminal node was skipped ends `completed`, and says so on `run.completed` |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-11-02                                                      |
| **Updated**       | 2026-11-02 — filed `Draft`. Registers only; no spec, schema or suite change yet. The RFC 0001 §5 cross-organization approval rule is not yet active (`GOVERNANCE.md` §"Sole-steward operation"). |
| **Affects**       | `spec/v2/core/events.md` §Payloads and §"The terminal event" (one rule) · `spec/v2/core/execution.md` §`subWorkflow` (one output field) · `schemas/v2/run-event-payloads.schema.json` `$defs/runCompleted` (one optional property) · `spec/v2/surface-baseline.json` (regenerated) · conformance: one new scenario, two new fixtures, one fixture variant · `conformance/fixtures.md` · CHANGELOG. v1 is frozen and is not touched. |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §4 ("new normative requirement on a previously undefined behavior") and §2.4 (an optional property on a closed v2 object). It changes observed behavior on one tier-1 host; see §Compatibility. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

The v2 core says a run's log ends in exactly one of `run.completed`, `run.failed` or `run.cancelled`, but never says which one a run gets when it runs out of work. This RFC settles one arm of that question: when no node failed and every terminal node (a node with no outgoing edge) was skipped, the run ends `completed`, and `run.completed` carries a new optional `skippedTerminals` list naming those terminals. A `core.subWorkflow` parent receives the same list. The decision is a pure function of the pinned definition and the recorded node outcomes, so replay and fork reproduce it. The two steward hosts disagree on this state today (one fails it, one completes it with nothing to say so), and the RFC picks completion because a `failed` run with no failed node reports a failure that nothing produced.

## Motivation

### The state

A run reaches it when nothing is ready, running or suspended, no node's latest outcome is `node.failed`, and no terminal node completed. Two mechanisms produce it, and neither needs a defect:

1. **An edge condition routes nothing** (RFC 0134 operators and the original five). A guard declines (`guard.ok equals true` is false), an "only if" step's `truthy` edge is false, or an `equals` router's value matches no branch. Every path to every terminal is skipped.
2. **A trigger rule is never satisfied, with no condition anywhere.** `A → B` where the only edge carries `triggerRule: "any_failed"` (an error handler). When `A` succeeds, `B` is skipped, and `B` is the only terminal. The workflow did exactly what its author wanted, and nothing was conditioned.

The second case matters for the decision: "every terminal was skipped" does not imply "the author's intent was violated".

### What the corpus says today

Nothing normative. Measured at openwop `cd40f264`:

- `spec/v2/core/events.md` §"The terminal event" requires exactly one terminal run event and says nothing about which.
- `spec/v2/core/runs.md` lists `completed` and `failed` as statuses, with no rule that selects between them except for specific causes (`run_timeout`, `approval_rejected` in `interrupt.md` §Rejection, `recursion_limit_exceeded`).
- RFC 0134 and `spec/v1/workflow-chain-packs.md` (line 169) define how a *skipped source* evaluates `truthy`/`falsy`. They do not define a run status.
- `node.skipped` is a registered event (`spec/v2/event-codemap.json`, payload `nodeSkipped`), but no v2 rule requires a host to emit it.
- "Terminal node" is defined only in RFC 0065 (`outputRole`), informally: "those with no outgoing edge".
- RFC 0125's motivating case says an `all_complete` terminal lets a run "complete cleanly", which presumes a completion rule the core never states.

### What the hosts do (code reads, not executions, except where noted)

| Host | Every terminal skipped, no node failed | Evidence |
| --- | --- | --- |
| openwop-app (tier 1, production) | `run.failed`, `error.code` `all_terminals_skipped` (v2 wire: vendor-namespaced `openwop-app.all_terminals_skipped`), `details.skippedTerminals`, no `failedNodeId`. The failure is dead-lettered and raises a user notification. Before openwop-app #5443 (merged 2026-11-01) it was `internal_error` "unknown node failure". | `backend/typescript/src/executor/scheduler.ts` `inspectDisposition`; `executor.ts` failed branch and `emitTerminalFailure` (dead letter, notification); **run-confirmed** on the `career.apply` chain with a declining guard (`test/cs70wf-38-all-terminals-skipped.test.ts`) |
| v2 reference host (openwop-examples `f28b78d`) | `run.completed` with `outputs: {}` and no marker. It emits `node.skipped` for the terminal. It does not evaluate edge `condition` at run time at all, so it reaches this state only through trigger rules. | `examples/hosts/v2-reference/src/executor.ts` `fires`, the run loop, `runOutputs` |

openwop-app emits no `node.skipped` event (its skips are debug log lines only), so on that host the skipped terminals are visible on the wire only in the failure's `details`.

The two conforming hosts therefore disagree, and a client cannot tell from either wire whether a `completed` run did its work or a `failed` run had a failure.

### Who hits it

openwop-app's steward write-up (`docs/steward/workflows-assessment/2026-10-31-engine-skipped-terminal.md`, finding `CS70WF-38`) lists 9 shipped chain packs whose every terminal is reached only through conditional edges with no complementary pair that guarantees one completes. One (`career.apply`) is run-confirmed; the other eight come from a static scan and are candidates, not confirmed failures. A further 32 chains are condition-gated but carry a `truthy`/`falsy` pair, so one terminal always completes.

On that host each such run currently:

- reports `failed`, so it counts in failure rates and alerts;
- is dead-lettered (`runs.md` §"Dead letters"), and with a run-level retry policy would be retried first. The retry re-runs every non-terminal node, including side effects that already succeeded, and declines again deterministically;
- as the child of a `core.subWorkflow` with the default `onChildFailure: fail-parent`, fails its parent.

### Why the spec is the right place

The terminal event type is wire: `childStatus` (`execution.md` §`subWorkflow`), dead-lettering, `cancelRun`'s `run_terminal`, retry policy and every client's success test key on it. Two hosts already disagree, and the disagreement is visible to every consumer.

## Proposal

### Choosing the outcome

Three outcomes were weighed (full trade-offs in §"Alternatives considered"):

| Concern | A. `completed` + marker (proposed) | B. `failed` + registered code | C. author declares it |
| --- | --- | --- | --- |
| Replay and fork | Deterministic: a function of the definition and recorded outcomes | Same | Same, if the declaration is read from the pinned definition, never host config |
| `outputs` and `outputRole` | `outputs` is an object as today; the marker tells tooling there is no deliverable | No outputs; the code tells tooling why | Depends on the declared branch |
| `core.subWorkflow` parent | Continues; it can route on `childSkippedTerminals` | Fails by default (`fail-parent`) on a by-design decline | Author-dependent, per child |
| Retries, dead letters, alerts keyed on status | Not retried or dead-lettered; alerts must read the marker to see it | Retried, dead-lettered, alerted, including the trigger-rule case where nothing was conditioned | Author-dependent |
| Routing defects (a router matches nothing by mistake) | **Silent unless the marker is read** | Loud | Loud only where the author opted in |
| Backward compatibility | Flips openwop-app; adds a marker to the reference host | Flips the reference host; openwop-app swaps a vendor code for a registered one | Both hosts change; new wire surface in two schemas |
| What it claims | No node failed, and the run says it completed with no terminal | A failure that no node produced | Whatever the author declared |

**The decisive reason:** a run status is a claim about the run, and `failed` here would claim a failure that no node produced. openwop-app had to invent a code and leave `failedNodeId` empty because there was nothing to name. Each consumer of `failed` then acts on that missing failure: the dead-letter sink, the default `fail-parent`, retry policies and alerts. The trigger-rule case (`A → B` over `any_failed`) shows that the state is reached by ordinary graphs with no conditions at all, so "every terminal skipped" is not evidence of a broken intent.

**The strongest counter-argument:** silent success hides routing defects. If a model node renames its output key, every `equals` edge on the old key goes false, and every run "completes" having done nothing while a dashboard keyed on status stays green. Prior art splits the same way. Airflow, Argo and GitHub Actions treat a run whose remaining steps were skipped by a guard as successful. AWS Step Functions (`States.NoChoiceMatched`) and BPMN 2.0 (an exclusive gateway with no true condition and no default flow) raise an error. (These descriptions are from the author's knowledge of those systems and were not re-checked against their current documentation for this draft.) In both of the failing systems, though, the error is raised **at the routing node**, not as a run status with no cause. This RFC keeps that division:

- a run with no failed node is not a failed run;
- an author who needs "nothing routed" to be a failure says so at the routing point, with primitives that exist today: a `core.fail` terminal on the complementary (`falsy`) edge or on a router's default branch;
- the marker makes the no-terminal outcome visible to every consumer that wants to alert on it.

Whether to add an author declaration (option C) as well is Unresolved question 1.

### Definitions

- **Terminal node.** A node of the run's definition, after chain expansion, with no outgoing edge. A node whose only outgoing edges close a cycle is not terminal. (RFC 0065's informal definition, made normative.)
- **Quiescent.** No node of the run is ready, running or suspended, and the host will schedule none without new input.
- A node's **latest outcome** is the last of `node.completed`, `node.failed` or `node.skipped` the host recorded for it, or the equivalent internal state on a host that does not emit `node.skipped`.

### §A — Disposition (`spec/v2/core/events.md` §"The terminal event")

When a run is quiescent, its definition has at least one terminal node, no terminal node's latest outcome is completed, no node's latest outcome is failed, and no rule that ends the run on its own cause applies (cancellation, `run_timeout`, a breached cap, `recursion_limit_exceeded`):

1. The host **MUST** end the run with `run.completed`, and the run's status **MUST** be `completed`. It **MUST NOT** emit `run.failed` for this state.
2. `run.completed` **MUST** carry `skippedTerminals`: the id of every terminal node of the definition, each once, in the order the definition's `nodes[]` lists them.
3. A `run.completed` for a run in which at least one terminal node completed **MUST NOT** carry `skippedTerminals`.
4. The disposition **MUST** be a function only of the run's pinned definition and its recorded node outcomes. It **MUST NOT** depend on host configuration, the clock, or which host instance evaluates it. A `replay` fork that reproduces the source's node outcomes **MUST** end with the same terminal event type and the same `skippedTerminals`.
5. `outputs` remains governed by events.md §Payloads (an object, `{}` valid). This RFC adds no rule on its contents.

The state where a node failed and every terminal was skipped is **not** governed by this RFC (see §"Open spec gaps", row 2).

### §B — `core.subWorkflow` parent (`spec/v2/core/execution.md` §`subWorkflow`)

When the child's terminal event is `run.completed` carrying `skippedTerminals`:

1. The parent node's `node.completed` **MUST** carry `outputs.childStatus: "completed"` and **MUST** carry `outputs.childSkippedTerminals`, equal to the child's `skippedTerminals`.
2. `onChildFailure` does not apply; the child did not fail.
3. `outputMapping` applies as for any completed child: a mapped child variable that is unset arrives undefined (the existing rule).

A parent that must stop when its child reached no terminal routes on it, for example `{ "type": "truthy", "left": "childSkippedTerminals" }` to a `core.fail` node.

### §C — Authoring guidance (non-normative)

- To make a decline an ordinary completion with a deliverable, give the declining branch its own terminal (a `falsy` complement edge to a `core.noop` or a node that records the reason). openwop-app's Campaign Studio channel chains did this (its ADR 1020 P1).
- To make "nothing routed" a failure, add a `core.fail` terminal on the complement edge or the router's default label.
- Tooling that uses `outputRole` (RFC 0065) to pick a primary deliverable should present "no deliverable" when `skippedTerminals` is present, rather than fall back to another node's output.

### Wire shape changes

`schemas/v2/run-event-payloads.schema.json` `$defs/runCompleted`, one optional property:

```diff
   "properties": {
     "outputs": { "$ref": "#/$defs/_outputsObject" },
     "durationMs": { "type": "integer", "minimum": 0 },
+    "skippedTerminals": {
+      "type": "array",
+      "description": "RFC 0257 §A — present only when the run completed with no terminal node completed and no node failed: every terminal node's id (a node with no outgoing edge), once each, in nodes[] order. Absent when any terminal completed.",
+      "items": { "$ref": "ids.schema.json#/$defs/nodeId" },
+      "minItems": 1,
+      "uniqueItems": true
+    }
   },
```

`outputs.childSkippedTerminals` on the `core.subWorkflow` node needs no schema change: `_outputsObject` is open and `execution.md` already lets the node "add fields". The field is named in prose.

No change to `RunSnapshot` (Unresolved question 3), the error registry, the event registry, `api/v2/openapi.yaml` or `api/v2/asyncapi.yaml` (the AsyncAPI message references the payload schema). The CloudEvents and webhook renderings are generated from the same definition and change with it.

Version axes: no `eventLogSchemaVersion` change. Whether `run.completed`'s per-event `schemaVersion` changes for an added optional property is Unresolved question 6.

### Examples

Positive — a guard declined; the only terminal `session` was skipped:

```json
{ "type": "run.completed", "payload": { "outputs": {}, "skippedTerminals": ["session"], "durationMs": 412 } }
```

Positive — a terminal completed, so no marker:

```json
{ "type": "run.completed", "payload": { "outputs": { "payload": { "ok": true } }, "durationMs": 380 } }
```

Negative — fails validation (`minItems: 1`):

```json
{ "type": "run.completed", "payload": { "outputs": {}, "skippedTerminals": [] } }
```

Negative — validates, but violates §A.1 (a failure with no failed node, for this state):

```json
{ "type": "run.failed", "payload": { "error": { "code": "openwop-app.all_terminals_skipped", "message": "…", "details": { "skippedTerminals": ["session"] } } } }
```

### Security considerations

- **Threat models.** `SECURITY/threat-model-prompt-injection.md`: a model or injected content that steers a guard to decline now yields a `completed` run. A consumer that reads `completed` as "the action happened" would be wrong. That was already true of a host that completes the run, as the reference host does; the marker makes it detectable. `SECURITY/threat-model-replay.md`: §A.4 forbids configuration-dependent dispositions, which would otherwise let a replay under a different configuration report a different outcome for the same history.
- **Payload.** `skippedTerminals` carries node ids from the run's definition, which `node.*` events already carry. No credential, input or output material. No redaction recipe needed.
- **Invariants.** None added. The disposition is not a security property, and `SECURITY/invariants.yaml` is reserved for those.
- **Audit and OTel.** No new audit event. v2 core defines no run-status OTel attribute (the v1 `openwop.run_status` attribute is in the frozen `spec/v1/observability.md`); whether to add a no-terminal attribute is Unresolved question 5.
- **External audit.** No surface the external audit scoped changes (`SECURITY/external-audit-engagement.md`).
- **Embargo.** Not a safety fix; no embargo path.

### Open spec gaps (what this RFC does not cover)

1. **The general run-completion predicate.** The v2 core never says when a run is `completed` versus `failed` beyond named causes. This RFC settles the "no node failed, every terminal skipped" arm only.
2. **A failed node with every terminal skipped.** Out of scope. By code read, openwop-app fails with the failed node's error; the reference host completes when the failure was routed over an `all_complete`/`any_failed` edge.
3. **Trigger-rule semantics over a skipped source.** Not defined at v2. By code read the hosts differ on `all_success` with one completed and one skipped source (openwop-app fires the target; the reference host skips it). This changes which graphs reach this RFC's state, not the rule.
4. **Edge-condition evaluation is optional at v2.** RFC 0134 binds only "a host that evaluates `EdgeCondition`", and the reference host does not.
5. **`node.skipped` emission is not required**, and openwop-app emits none.
6. **`left` path resolution** against a node's outputs is not pinned at v2. The conformance fixture below depends on it.
7. **A definition with no terminal node** (every node has an outgoing edge) and **`disabled: true` nodes** are not addressed.

## Compatibility

**Classification: `additive`.**

- `COMPATIBILITY.md` §4: "New normative requirement on a previously undefined behavior — Yes, additive (the spec was previously silent)." No v2 text selects a terminal event for this state.
- §2.4: adding an optional property to the closed `runCompleted` object is additive. A consumer validating against an older v2 schema version is validating against that version and SHOULD pin it (`versioning.md` §4). A consumer that validates new events against an old pinned closed schema will reject a `run.completed` carrying the marker; that is the known cost of v2 closure, accepted by §2.4 and its precedents (RFCs 0183, 0186, 0188).
- §2.2: no required field changes, no event type changes shape, no endpoint contract changes, no `MUST` is relaxed. No **registered** error code changes meaning. `openwop-app.all_terminals_skipped` is a vendor code the host owns, and it stops being emitted for this state.

**Forward-compatibility clauses.** `skippedTerminals` is optional with no default and is absent from every `run.completed` where a terminal completed. Clients that do not know it ignore it, as `events.md` requires for unknown members. Hosts that never reach the state never emit it.

**Honest caveat.** "Additive" is a statement about the corpus, not about users. On openwop-app, runs that end `failed` today will end `completed`:

- failure counts drop;
- dead letters and failure notifications stop for these runs;
- a `core.subWorkflow` parent stops failing on a child that reached no terminal, and continues (Risk R6).

Persisted runs keep their recorded `run.failed`. A `replay` fork whose `fromSeq` precedes the terminal event re-executes under current code, reaches `run.completed` instead, and emits `replay.diverged` as `replay.md` §Divergence requires. That is the documented meaning of replay under current code, not a regression.

On the reference host the status is unchanged; it gains the marker and, under §B, the parent field.

No migration tooling is required (additive). Under `GOVERNANCE.md` §"Sole-steward operation" there is no outside host to coordinate with; the two steward hosts are listed in §"Implementation notes".

## Conformance

### Existing coverage

- `v2-run-completed-outputs.test.ts` asserts `run.completed` carries `outputs` (on `conformance-noop`).
- `v2-terminal-event-once.test.ts` asserts exactly one terminal run event.
- `conformance-approval-reject-routed` (with `v2-approval-reject-disposition`) is the nearest fixture: a terminal is skipped while another completes, and the run completes.
- `edge-condition-truthy-falsy` (v1) checks the operator shape. No v2 scenario drives an edge condition at run time.
- `subworkflow.test.ts`, `v2-subworkflow-linkage.test.ts` and `v2-sub-workflow-advertisement.test.ts` cover `core.subWorkflow`; none covers a child that reached no terminal.

No existing scenario reaches the state this RFC governs.

### New scenario (planned): `v2-all-terminals-skipped.test.ts`

Targets major 2 (row in `conformance/scenario-majors.json`). Top-of-file docstring cites `spec/v2/core/events.md` §"The terminal event" and `execution.md` §`subWorkflow`. Each fixture is advertised through discovery `fixtures[]`; a fixture the host does not list records `blocked` for its leg (the existing rule), never a pass.

| Leg | Fixture and input | Asserts |
| --- | --- | --- |
| `0257.trigger-rule-skip-completes` | `conformance-error-route-only`: `start` (`core.noop`) → `on-fail` (`core.noop`) over `triggerRule: "any_failed"`. No input. | `run.completed`; `skippedTerminals` deep-equals `["on-fail"]`; no `run.failed` in the log. Needs no condition evaluation, so it runs on both steward hosts. |
| `0257.condition-skip-completes` | `conformance-all-terminals-skipped`: `check` (`core.identity`) → `act` (`core.noop`) over `{ "type": "truthy", "left": "payload.ok" }`. Input `payload: { ok: false }`. | `run.completed`; `skippedTerminals` deep-equals `["act"]`; no `run.failed`. |
| `0257.terminal-completed-no-marker` | Same fixture, input `payload: { ok: true }`. | `run.completed` **without** `skippedTerminals`. This is the positive control: a host that ignores the condition runs `act` on both inputs and fails the previous leg rather than passing both. |
| `0257.replay-same-disposition` | Gated on `replay` advertising `modes` ⊇ `replay`. Fork the `ok: false` run with `mode: "replay"`. | The fork ends `run.completed` with the same `skippedTerminals`. |
| `0257.subworkflow-child-skipped` | Gated on `subWorkflow`. `conformance-subworkflow-skip-parent` → child `conformance-error-route-only`. | Parent `run.completed`; the parent node's `node.completed.outputs.childStatus === "completed"` and `childSkippedTerminals` deep-equals `["on-fail"]`. |

Server-free: a coherence assertion that `$defs/runCompleted.properties.skippedTerminals` exists with `minItems: 1` and `uniqueItems: true`, and that the negative example above fails validation.

### Fixtures

New `conformance/fixtures/conformance-error-route-only.json`, `conformance-all-terminals-skipped.json` and `conformance-subworkflow-skip-parent.json`, each with a row in the `conformance/fixtures.md` catalog table and a per-fixture contract, using only typeIds existing fixtures already use (`core.noop`, `core.identity`, `core.subWorkflow`). The `truthy` fixture depends on `left: "payload.ok"` resolving against `core.identity`'s `output.payload`, which v2 does not pin (gap G7).

### Capability gating

No new capability flag. The disposition is core run behavior, like the terminal-event rule beside it. Legs gate only on existing facets (`replay`, `subWorkflow`) and on fixture advertisement.

### Reference-host coverage and INTEROP-MATRIX

- openwop-app (tier 1) is expected to witness every leg, including `0257.condition-skip-completes`, which needs run-time condition evaluation.
- The v2 reference host can witness `0257.trigger-rule-skip-completes`, `0257.replay-same-disposition` and `0257.subworkflow-child-skipped` once it emits the marker. It cannot witness the condition legs until it evaluates conditions (Open spec gap 4).
- No new profile or column in `INTEROP-MATRIX.md`.

### Suite vs spec

The legs assert only what §A and §B state. Nothing is stricter than the spec text.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 ends `completed`, never `run.failed` | the terminal event type in the log | the suite, by running an advertised fixture (`v2-all-terminals-skipped.test.ts`, planned) | witnessable — unaided (fixture-advertised; an unlisted fixture is `blocked`) |
| §A.2 `skippedTerminals` lists every terminal, once, in `nodes[]` order | the `run.completed` payload | the suite, same fixtures | witnessable — unaided (fixture-advertised) |
| §A.3 absent when a terminal completed | the `run.completed` payload on the `ok: true` input | the suite | witnessable — unaided (fixture-advertised) |
| §A.4 replay reproduces the disposition | the fork's terminal event and marker | the suite, via `forkRun` | witnessable — gated (`replay`) |
| §A.4 does not depend on host configuration, clock or instance | — | only the operator can change a host's configuration | unwitnessable — the suite cannot vary host configuration; the replay leg witnesses only that a re-derivation agrees with the recorded one |
| §B.1 parent carries `childStatus: "completed"` and `childSkippedTerminals` | the parent node's `node.completed` outputs | the suite, via the parent fixture | witnessable — gated (`subWorkflow`) |

## Alternatives considered

**B. Keep `failed`, register a standard code.** Register `all_terminals_skipped` (`422`, not retriable, `details: { skippedTerminals: nodeId[] }`), and require `run.failed` with no `failedNodeId` for this state. It is loud: routing defects cannot hide behind a green status. openwop-app already behaves this way under a vendor code, so it would only rename the code. Rejected because:

- it reports a failure no node produced;
- it fails the trigger-rule case (`A → B` over `any_failed`), where nothing was conditioned and every node did what it was told;
- it dead-letters, retries and alerts on deterministic outcomes, and a retry re-runs side effects that succeeded;
- it fails `core.subWorkflow` parents by default on a child's by-design decline;
- it flips the reference host the other way.

The loudness it buys is available more precisely at the routing node (`core.fail` on the complement edge or default branch).

**C. An author declaration.** For example, `WorkflowSettings.onNoTerminal: "complete" | "fail"`, or a per-terminal "skippable" flag. It states intent exactly where the executor cannot infer it, and is the only option where a multi-branch router with no default can be made fail-closed in one line. Not proposed now because:

- it adds surface to two closed schemas (the definition and the chain manifest);
- it gives two ways to say what a `core.fail` or `core.noop` terminal already says (`overview.md` Axiom 2, "one name per thing");
- it still needs a default, and the default is exactly the A-versus-B question.

It can be added later as an additive optional setting whose default is this RFC's rule (Unresolved question 1).

**D. A new run status (`skipped`, or `completed-empty`).** `runs.md` lets the status vocabulary grow by `overview.md` §0. Rejected because:

- a consumer must accept an unknown status and "MUST NOT act on it", so existing clients would see a terminal run they cannot classify;
- `childStatus` (`completed | failed | cancelled`) and the three terminal event types are closed sets that would all have to grow;
- `cancelRun`'s `run_terminal` and `isTerminal` on poll would need the new member too.

A marker on `run.completed` carries the same information without that cost.

**E. Refuse such graphs at registration.** Require every definition to have a terminal that is reachable on every input. Undecidable in general (conditions test run-time values), and a conservative check would refuse the 9 legitimate chains and the `any_failed` handler pattern. Rejected.

**F. Do nothing.** Leaves the two steward hosts disagreeing on the terminal event type for the same graph, with no marker on either wire that would let a client tell the difference. Every consumer of `childStatus`, dead letters and retry policy keeps acting on whichever host it happens to talk to. Rejected; the disagreement is the reason this RFC exists.

## Unresolved questions

1. **Add option C now?** Should the spec also add an author declaration that makes "no terminal completed" a failure, defaulting to this RFC's rule? The proposal says not yet; reviewers who expect many routers without a default branch may disagree.
2. **Marker name and shape.** `skippedTerminals` (a node id list) or a closed outcome token such as `terminalOutcome: "none-completed"`? The list is more useful to a person reading a run. The token extends better if partial-skip outcomes are ever reported.
3. **Project it onto `RunSnapshot`?** A client that only reads `getRun` cannot see the marker. Adding an optional snapshot property is additive, but the snapshot is a fold of the log, and a second copy is a second thing to keep consistent.
4. **`outputs` contents.** Should `outputs` be `{}` when no terminal completed? The reference host already emits `{}`. What openwop-app would put there has not been measured, and the core never defines how `outputs` is derived.
5. **An OTel or metrics signal.** Should a host expose the count of runs that completed with no terminal, so operators can alert on routing defects without reading payloads? v2 core has no run-status attribute to extend.
6. **Per-event `schemaVersion`.** Does adding an optional payload property bump `run.completed`'s `schemaVersion`? No precedent was found in this draft.
7. **Core word budget.** `spec/v2/core` is at 36,784 of 36,800 words (`scripts/check-core-budget.mjs`). §A and §B need roughly 120 words. Which words are freed, or does the rule live outside `core/`?
8. **A definition with no terminal node, and `disabled` nodes.** Should a definition with no terminal node be refused at registration? Is a `disabled: true` node terminal-eligible?

## Implementation notes (non-normative)

- **openwop-app.** `scheduler.ts` `inspectDisposition`: the `skippedTerminals` branch returns `completed` instead of `failed`, and `executor.ts`'s completion path stamps `skippedTerminals` on `run.completed`. The `all_terminals_skipped` failure branch and its vendor-code mapping are deleted. Note that `scheduler.ts` today also returns `failed` for a quiescent run where nothing completed and some node failed (Open spec gap 2), which this RFC leaves alone. `subWorkflowDispatcher.ts` adds `childSkippedTerminals`. Its `cs70wf-38-all-terminals-skipped.test.ts` flips its expectation. Before the flip, measure how many production runs per day end `all_terminals_skipped`, and which chains produce them, so the change to failure counts is expected rather than discovered.
- **v2 reference host.** `executor.ts` computes the terminal set (nodes not in `links(def).map(from)`, the same set `runOutputs` uses) and adds `skippedTerminals` when none has a `node.completed`. Evaluating edge conditions at run time is a separate change (Open spec gap 4).
- **Sequencing.** Spec text and schema → scenario and fixtures (suite minor) → both hosts → certified cuts. The core budget question (UQ 7) must be answered before the spec text can merge.
- **Effort.** Small on both hosts. The conformance scenario is the largest piece.
- **SDKs.** openwop-sdks regenerates the `RunCompleted` payload type with the optional field.

## Acceptance criteria

- [ ] Spec text merged (`events.md` §"The terminal event", `execution.md` §`subWorkflow`) within the core word budget.
- [ ] `schemas/v2/run-event-payloads.schema.json` `$defs/runCompleted.skippedTerminals` added; `spec/v2/surface-baseline.json` regenerated; `check-v2-surface-monotone.mjs` passes.
- [ ] `v2-all-terminals-skipped.test.ts` with its three fixtures and catalog rows, in a suite minor.
- [ ] CHANGELOG entries (corpus and `conformance/CHANGELOG.md`).
- [ ] openwop-app passes every leg on a certified production cut, including `0257.condition-skip-completes` and its positive control.
- [ ] The v2 reference host passes `0257.trigger-rule-skip-completes`, or the RFC records why it does not.
- [ ] Register sweep: every gap and risk row closed, transferred or carried.

## References

- openwop-app `docs/steward/workflows-assessment/2026-10-31-engine-skipped-terminal.md` (finding `CS70WF-38`), openwop-app #5443 (`all_terminals_skipped`), `backend/typescript/test/cs70wf-38-all-terminals-skipped.test.ts`.
- openwop-app `backend/typescript/src/executor/scheduler.ts` (`inspectDisposition`, `evaluateTrigger`), `executor.ts` (failed branch, `emitTerminalFailure`), `middleware/protocolVersion.ts` (`v2EventErrorCode`), at `fc536023f`.
- openwop-examples `examples/hosts/v2-reference/src/executor.ts` (`fires`, the run loop, `runOutputs`), at `f28b78d`.
- RFC 0013 (workflow-chain packs), RFC 0053 (dead letters), RFC 0065 (`outputRole`, terminal node), RFC 0125 (`triggerRule` on fragment edges), RFC 0133 (sub-chains), RFC 0134 (`truthy`/`falsy`), RFC 0194 (terminal event ends forward execution), RFC 0213 (stating outcomes the core left unstated), RFC 0223 (approval rejection disposition).
- Spec: `spec/v2/core/events.md`, `runs.md`, `execution.md`, `replay.md`, `interrupt.md` §Rejection, `workflow-chain-packs.md`, `errors.md`; `spec/v1/workflow-chain-packs.md` (frozen).
- Prior art (author's knowledge, not re-verified for this draft): Apache Airflow DAG-run state with skipped leaves (ShortCircuitOperator); Argo Workflows `when`; GitHub Actions job `if`; AWS Step Functions `Choice` / `States.NoChoiceMatched`; BPMN 2.0 exclusive gateway default flow.
- Registers: [`registers/0257-run-status-when-every-terminal-is-skipped.gaps.md`](./registers/0257-run-status-when-every-terminal-is-skipped.gaps.md), [`registers/0257-run-status-when-every-terminal-is-skipped.risks.md`](./registers/0257-run-status-when-every-terminal-is-skipped.risks.md).
