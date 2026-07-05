# RFC 0126: Data-parallel `core.dispatch` — per-item input fan-out

| Field | Value |
|---|---|
| **RFC**           | 0126 |
| **Title**         | Data-parallel `core.dispatch` — per-item input fan-out |
| **Status**        | `Accepted` |
| **Author(s)**     | David Tufts (@davidscotttufts); motivated by the openwop-app segment-winback team (ADR 0255) |
| **Created**       | 2026-07-04 |
| **Updated**       | 2026-07-04 (Active → Accepted — single-witness bootstrap steward waiver; register swept, gaps G1/G2/G4/G7 resolved, G3/G5/G6 + risks R2/R3/R4 carried forward as named open gaps) |
| **Affects**       | `schemas/orchestrator-decision.schema.json` (`nextWorkerInputs`), `spec/v1/node-packs.md §core.dispatch`, `spec/v1/capabilities.md` (`dispatch.perItemInput` descriptor — prose, matching the existing prose-only `dispatch.*` descriptors; `capabilities.dispatch` is not enumerated in `capabilities.schema.json`), `conformance/src/scenarios/dispatch-per-item-input.test.ts` (new). Builds on RFC 0118 (parallel fan-out + join) and RFC 0022 (dispatch input/output mapping). |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes**    | — |
| **Superseded by** | — |

## Summary

`core.dispatch` parallel fan-out (RFC 0118) dispatches a **heterogeneous** worker set — each `nextWorkerIds[i]` is a distinct workflow id — and RFC 0022's per-worker input mapping is keyed **by workflow id**, so it cannot give N instances of *one* workflow distinct inputs. This RFC adds the one missing wire concept for **data-parallel** fan-out: an optional, index-aligned `nextWorkerInputs` array on the `next-worker` `OrchestratorDecision`, so a supervisor can fan one `childWorkflowId` out over N runtime items, each child receiving a distinct per-item input. It is additive, capability-gated (`capabilities.dispatch.perItemInput`), and replay-deterministic because the items are frozen in the recorded `runOrchestrator.decided` event.

## Motivation

The canonical "map a workflow over a list" pattern — run one per-item workflow for every element of a runtime-computed collection — is a first-class capability in every comparable engine (Temporal child-workflow fan-out, AWS Step Functions `Map` state, LangGraph `Send`). OpenWOP's `core.dispatch` supports **fan-out** (RFC 0118) and **input mapping** (RFC 0022), but not their composition over *homogeneous* workers with *distinct data*.

Concretely (OpenWOP reference-app ADR 0255, "segment-winback"): a supervisor resolves a marketing segment to N `contactId`s and wants to run the single-contact `re-engage-contact` workflow once per contact. Today this is inexpressible:

- The **cardinality** is already expressible — `nextWorkerIds` has no uniqueness constraint, so `['re-engage','re-engage','re-engage']` legally dispatches three children of one workflow.
- The **per-item input** is not — RFC 0022's `perWorkerInputMappings` is keyed by `workflowId`, and the default `inputMapping` projects the *same* parent variables into every child. All N children therefore receive the **same** input. A host that ran this today would process one contact N times and skip the other N−1 — a silent, severe correctness (and, for send-side workflows, spend) hazard.

The workflow engine is the right place to close this: fan-out, concurrency bounding, join, and replay-determinism already live in `core.dispatch`. A host-side "create N child runs directly" workaround would stand up a *second* fan-out/join/concurrency implementation beside the primitive — the anti-pattern RFC 0118 exists to avoid. The minimal wire addition is a **per-index input source on the dispatch decision**; nothing else in the fan-out machinery changes.

## Proposal

### Wire-shape changes

**1. New optional field `nextWorkerInputs` on `NextWorkerDecision`** (`orchestrator-decision.schema.json`).

An index-aligned array of per-child input objects. When present, the host MUST project `nextWorkerInputs[i]` into the inputs of the child dispatched for `nextWorkerIds[i]`.

- `nextWorkerInputs` is OPTIONAL. When absent, dispatch behaves exactly as today (RFC 0118/0022): every child receives only the `inputMapping` / `perWorkerInputMappings` projection.
- When present, `nextWorkerInputs.length` **MUST** equal `nextWorkerIds.length`. A host consuming a `next-worker` decision whose `nextWorkerInputs.length` differs from `nextWorkerIds.length` **MUST** fail the dispatch node with a `validation_error` (`error-envelope.md`) and **MUST NOT** dispatch any child from that decision.
- Each `nextWorkerInputs[i]` is a flat-or-nested JSON object of child input variable names → values.
- **Merge precedence.** Child `i`'s effective inputs are the `inputMapping` / `perWorkerInputMappings` projection from parent variables (RFC 0022), with `nextWorkerInputs[i]` merged **over** it — a key present in both resolves to the `nextWorkerInputs[i]` value. Per-item literal data is the more specific source and wins. (See Unresolved question 1.)

**2. New capability descriptor `capabilities.dispatch.perItemInput`** — a boolean **prose** descriptor documented in `capabilities.md §dispatch`, alongside the RFC 0118 `capabilities.dispatch.*` descriptors (`fanOutSupported`, `maxFanOut`, `joinModes`), which are themselves prose-only. `capabilities.dispatch` is not enumerated in `capabilities.schema.json` (the root capabilities object is `additionalProperties: true`), so advertising `capabilities.dispatch.perItemInput: true` is wire-legal with **no** `capabilities.schema.json` change. (See Unresolved question 2 / gap G2.)

- A host that advertises `capabilities.dispatch.perItemInput: true` **MUST** honor `nextWorkerInputs` as specified above.
- A host that does **not** advertise it, upon consuming a `next-worker` decision carrying a non-empty `nextWorkerInputs`, **MUST** fail the dispatch node with a `validation_error` and **MUST NOT** dispatch. It **MUST NOT** silently drop `nextWorkerInputs` and dispatch N identically-inputted children — silent-drop is the exact correctness/spend hazard this RFC closes, so the gate fails **closed**. (Old hosts predating this RFC reject the field automatically: `OrchestratorDecision` is `additionalProperties: false`, so a strict validator refuses the unknown property — the fail-closed behavior is consistent with the existing schema.)

**3. Homogeneous cardinality is unchanged.** This RFC adds no new fan-out *mode*: repeated ids in `nextWorkerIds` already express "one workflow, N children" (RFC 0118 §fan-out; `quorum ≤ nextWorkerIds.length` counts duplicates). `fanOutPolicy`, `joinPolicy`, `maxConcurrency`, `iterationCap`, and `DispatchConfig` are **untouched**.

### Replay determinism (normative)

`nextWorkerInputs` rides on the `OrchestratorDecision`, which is recorded verbatim in the `runOrchestrator.decided` event (`run-orchestrator-decided-event.schema.json`, `decision` field). On `:fork`/replay the host **MUST** re-read the recorded decision — including `nextWorkerInputs` — and **MUST NOT** recompute the per-item inputs. The items are **frozen at decision time** (computed once by the supervisor node), so a forked or replayed run reproduces byte-identical children. This mirrors the RFC 0118 `mergeOrder` replay clause: the parent re-folds recorded child terminals rather than re-invoking, and here it re-reads recorded inputs rather than re-deriving.

### Bounds + conservative-path (normative, unchanged)

- `nextWorkerIds.length` (= `nextWorkerInputs.length`) counts against `maxConcurrency`, `capabilities.dispatch.maxFanOut`, and `iterationCap` exactly as RFC 0118 today — each dispatched child is one dispatch-iteration (RFC 0118 §Resolved Q5). A host **MUST NOT** silently drop children above `maxFanOut`; it surfaces the existing over-cap behavior.
- **CP-2 preserved.** Per-item input is a *scheduling* input to child construction, not a run-DAG mutation. The parent's static template DAG is unchanged; N children of one `childWorkflowId` is one dispatch node executing N child-constructions — the existing repeat-id case with data attached.

### Positive example

`runOrchestrator.decided.decision`:

```json
{
  "kind": "next-worker",
  "nextWorkerIds": ["re-engage-contact", "re-engage-contact", "re-engage-contact"],
  "nextWorkerInputs": [
    { "contactId": "c_001" },
    { "contactId": "c_002" },
    { "contactId": "c_003" }
  ]
}
```

Under `fanOutPolicy: 'parallel'` on a host advertising `capabilities.dispatch.perItemInput: true`: three concurrent children of `re-engage-contact`, receiving `inputs.contactId` of `c_001` / `c_002` / `c_003` respectively (each also receiving any `inputMapping` projection), joined per `joinPolicy`.

### Negative examples (each a `validation_error`, no child dispatched)

```json
// length mismatch: 2 inputs for 3 workers
{ "kind": "next-worker", "nextWorkerIds": ["w","w","w"], "nextWorkerInputs": [ {"contactId":"c1"}, {"contactId":"c2"} ] }
```

```json
// host does NOT advertise capabilities.dispatch.perItemInput → fail closed, never dispatch N identical children
{ "kind": "next-worker", "nextWorkerIds": ["w","w"], "nextWorkerInputs": [ {"contactId":"c1"}, {"contactId":"c2"} ] }
```

## Compatibility

**Classification: `additive`** (`COMPATIBILITY.md` §2.2).

- **No required→optional, removal, or retype.** `nextWorkerInputs` is a new OPTIONAL property on `NextWorkerDecision`; existing decisions omit it and are byte-identical. `capabilities.dispatch.perItemInput` is a new OPTIONAL boolean descriptor (absent ⇒ `false`).
- **No event-shape change of meaning.** `runOrchestrator.decided`, `node.dispatched`, `core.dispatch.fanOut`/`join` are unchanged; `nextWorkerInputs` is carried inside the existing `decision` field.
- **No endpoint contract, error-code, or HTTP-status meaning change.** The length-mismatch and unadvertised-capability failures reuse the existing `validation_error` envelope.
- **No `MUST` relaxed.** All existing RFC 0118/0022 MUSTs stand.

**Forward-compatibility clauses.**
- A host that does not advertise `capabilities.dispatch.perItemInput` **fails closed** on a decision carrying the field (rejects, never mis-dispatches). This is a deliberate *stricter-than-ignore* choice, and it is consistent with the existing `OrchestratorDecision` `additionalProperties: false` strictness — an old validator already rejects the unknown property. Silent-drop-and-dispatch is the one behavior the spec forbids, because it produces N identical children (the motivating bug).
- Existing v1 conformance passes are unaffected: no current scenario emits `nextWorkerInputs`, and hosts not advertising the capability are exempt from the new scenario (capability-gated).

No migration tooling is required (additive, no old shape to detect).

## Conformance

**Existing adjacent coverage:** `conformance/src/scenarios/dispatch-fanout-parallel.test.ts` (RFC 0118 parallel fan-out + join), `dispatch-input-mapping.test.ts` / `dispatch-output-mapping.test.ts` (RFC 0022 mapping), `orchestratorDispatch.test.ts`, `dispatchLoop.test.ts`.

**Landed scenario — `dispatch-per-item-input.test.ts`** (suite `1.49.0`), in two layers:

- **Always-on, server-free schema legs** (run in the CI spec-corpus gate, no host): a well-formed index-aligned `nextWorkerInputs` validates on `NextWorkerDecision`; a decision omitting it stays valid (additive/back-compat); a non-object item and a non-array are rejected; a mis-named `perItemInputs` is rejected by `additionalProperties:false` (the pre-0126 fail-closed rail); and a length-mismatch is **ADMITTED at the wire** — array-length equality with `nextWorkerIds` is not JSON-Schema-expressible, so it is a **runtime** MUST driven in the behavioral layer.
- **Capability-gated behavioral legs** (gated on `capabilities.dispatch.perItemInput: true`, over the `POST /v1/host/sample/dispatch/per-item` seam; soft-skip on 404/403 until a host wires the seam), each via `driver.describe('node-packs.md §core.dispatch per-item input', '<requirement>')`: **(1) per-index projection**, **(2) merge precedence** (per-item value wins over `inputMapping` on key collision, G1), **(3) length-mismatch** ⇒ `validation_error`, zero children, **(4) replay-freeze** (a `:fork`/replay re-reads the recorded per-item inputs verbatim), and **(5) the fail-closed gate** — a host **not** advertising the capability that receives a non-empty `nextWorkerInputs` surfaces `validation_error` and dispatches nothing.

**Single-witness evidence:** the graduation is witnessed by the **openwop-app** reference host (PR #1278), whose own `dispatch-per-item-input-executor.test.ts` (5/5) drives projection, precedence (G1), the fail-closed gate, length-mismatch, back-compat, and the replay-safe recorded-decision re-read (R5) through a **real** `core.dispatch` node + real `subWorkflowDispatcher`. The host is honest-off (behind an env flag) until the post-graduation advertisement flip.

**Carried-forward conformance gaps** (named per the register sweep; none is graduation-critical wire surface): the `POST /v1/host/sample/dispatch/per-item` seam is not yet wired in the in-repo reference hosts, so the behavioral legs above soft-skip in the server-free suite (precedence + replay-freeze are therefore reference-host-witnessed today, not yet server-free-pinned — gap G5); the in-memory/sqlite hosts + python do not yet implement (gap G6, INTEROP-MATRIX cells `—`); the `dispatch.perItemInput` INTEROP-MATRIX column populates when openwop-app advertises post-flip (risk R4). A dedicated fixture is not required (the scenario builds decisions inline).

## Alternatives considered

1. **Do nothing / defer (status quo).** Segment-wide map-over-collection stays inexpressible; ADR 0255 stands blocked. Rejected — this is a canonical, broadly-useful engine capability, not a niche.
2. **Host-side fan-out** — a feature node creates N child runs directly via run-creation, bounding concurrency and joining itself. Rejected: re-implements `core.dispatch`'s fan-out/concurrency/join/replay outside the primitive — a second dispatch system that will drift from the first (the exact "parallel architecture" RFC 0118 consolidates).
3. **A new `dataParallel` `DispatchConfig` mode carrying `childWorkflowId` + `items` in static config.** Rejected: the items are *runtime* data (resolved from an upstream node, e.g. a segment), so they cannot live in registration-time config; and it duplicates the cardinality that `nextWorkerIds` already expresses. The decision-carried field is both smaller and already on the recorded-event replay path.
4. **Index-keyed `perWorkerInputMappings`** (extend RFC 0022 to key by fan-out index instead of workflowId). Rejected: `perWorkerInputMappings` *values* are parent-variable **mappings**, not literal data; per-item data is not a mapping. Conflating the two overloads RFC 0022's mapping semantics.

## Unresolved questions

_Resolution status recorded at `Accepted` (register sweep, 2026-07-04)._

1. **Merge precedence** (Proposal §1). **RESOLVED — per-item overrides** (most-specific wins). `nextWorkerInputs[i]` projects *over* the RFC 0022 `inputMapping` projection; a key present in both resolves to the per-item value. Pinned in `node-packs.md §core.dispatch per-item input` + conformance assertion 2 + the openwop-app witness (test 2). (Closes gap G1.)
2. **Capability name.** **RESOLVED — `capabilities.dispatch.perItemInput`** (describes the wire delta). Landed as a **prose** descriptor in `capabilities.md §dispatch` (matching the prose-only `dispatch.*` descriptors); no `capabilities.schema.json` change. (Closes gap G2.)
3. **Item value constraints.** **CARRIED FORWARD (named open gap).** `nextWorkerInputs[i]` permits arbitrary nested JSON (matching unconstrained child inputs); **no hard per-item depth/size cap is specified**. The bounded-work guarantee rests on the existing decision-event size limits (the whole decision, including `nextWorkerInputs`, rides one `runOrchestrator.decided` event and is bounded by the host's event-size ceiling) plus `maxFanOut`/`maxConcurrency`/`iterationCap` bounding child *count*. A dedicated per-item size cap is deferred to a follow-up if a resource-exhaustion signal appears in practice (gap G3 / risk R2, tracked). This is not a wire-shape commitment — a later cap is additive.
4. **Mismatch error timing.** **RESOLVED — runtime `validation_error` only.** The decision is produced at run time, not registration time, and the emitting node's `typeId` is not known-data-parallel at `POST /v1/workflows`; there is no registration-time signal. Length-mismatch and unadvertised-capability both fail the dispatch node at run time, dispatching no child. (Closes gap G4.)
5. **Per-item output symmetry.** **RESOLVED — out of scope for 0126.** Per-child *output* already maps via RFC 0022 `outputMapping` per completed child; no per-item output projection is added here. A future RFC may revisit if a per-item output need appears.

## Implementation notes (non-normative)

- **Executor delta is surgical.** The reference executor's fan-out arm already threads the fan-out index into child construction (`dispatchChild(childWorkflowId, idx)` in the OpenWOP-app reference host); the only change is projecting `decision.nextWorkerInputs?.[idx]` into that child's inputs after the RFC 0022 mapping. No change to `fanOutPolicy`/`joinPolicy`/`maxConcurrency` handling.
- **Supervisor side (host application concern, no new wire).** A pure supervisor node reads an upstream collection (e.g. resolved segment members) and emits the `next-worker` decision with `nextWorkerIds = [childId] × N` + `nextWorkerInputs = items.map(...)`. The per-item child's own idempotency guard (e.g. an enroll-CAS) makes a re-dispatched wave duplicate-safe.
- **Sequencing.** `Draft` (this doc, comment window) → `Active` (unresolved questions 1–4 closed, scenarios sketched) → `Accepted` (schemas + spec prose + conformance scenario + in-memory/sqlite reference hosts landed). No cross-cut (`CC-N`) needed — additive, no breaking impl assumption.
- **Consumer.** OpenWOP-app ADR 0255 §deferred is the first consumer; its executor arm + supervisor node + `campaign-journeys.segment-winback` chain land after 0126 reaches `Accepted`.

## Acceptance criteria

- [x] Spec text merged (`node-packs.md §core.dispatch` per-item-input clause; `capabilities.md` `perItemInput` descriptor). — #825.
- [x] `orchestrator-decision.schema.json` (`nextWorkerInputs`) updated; `additionalProperties: false` preserved on `NextWorkerDecision`; positive + negative examples added. **G2 resolution:** the capability landed as a **prose** descriptor in `capabilities.md §dispatch` (matching the existing prose-only `dispatch.*` descriptors); `capabilities.dispatch` is not enumerated in `capabilities.schema.json`, so there is no `capabilities.schema.json` diff. — #825.
- [x] OpenAPI / AsyncAPI: no endpoint/channel change (the decision rides the existing `runOrchestrator.decided` event) — confirmed, no diff.
- [x] At least one conformance scenario (`dispatch-per-item-input.test.ts`) covering per-index projection, length-mismatch, precedence (over `inputMapping`), the fail-closed capability gate, and the length-mismatch/back-compat cases. Server-free schema legs always-on; behavioral legs capability-gated (soft-skip until a host advertises). — #825, suite `1.48.0 → 1.49.0`.
- [x] `CHANGELOG.md` entry under `[Unreleased] → ### Added`. — #825 (Active surface) + this graduation entry.
- [x] **Single-witness reference-host implementation** — **openwop-app** (implementer #1) landed the host executor arm (PR #1278): `subWorkflowDispatcher.perItemInputs` projected over the RFC 0022 mapping (per-item override), `decision.nextWorkerInputs[idx]` projected into each child on **both** the parallel fan-out and sequential-loop arms, the fail-closed gate (non-advertising host + length-mismatch ⇒ `validation_error`, 0 children), and replay-safe re-read of the recorded decision (CP-2). Witness `dispatch-per-item-input-executor.test.ts` — 5/5 green on a **real** `core.dispatch` node + real dispatcher (distinct-per-item projection not N-identical; per-item overrides `inputMapping`; fail-closed unadvertised; length-mismatch closed; no-`nextWorkerInputs` back-compat); 64 existing dispatch/scheduler tests still green. Host advertises **honest-off** (capability behind an env flag, default false) until this graduation; the flip to advertise `perItemInput` is a one-line follow-up now unblocked. Graduated **single-witness** under the bootstrap steward waiver (RFC 0120/0121/0125 precedent). **Deferred hosts** (recorded, G6): the in-memory / sqlite conformance reference hosts + the Python host are not required for this graduation — their INTEROP-MATRIX cells stay `—` until they implement (R4 tracked).

## References

- RFC 0118 — Parallel sub-workflow fan-out and join (the parallel path + `mergeOrder` replay clause + `capabilities.dispatch.*` descriptors this extends).
- RFC 0022 — `core.dispatch` + `core.subWorkflow` runtime variable mapping (`inputMapping` / `perWorkerInputMappings`, keyed by workflowId — the limitation this composes with).
- RFC 0007 — `core.dispatch` node + the dispatch loop (CP-2 conservative-path commitment).
- RFC 0006 §C — `OrchestratorDecision` shape (`next-worker` / `ask-user` / `terminate`).
- `spec/v1/node-packs.md §core.dispatch`, `spec/v1/capabilities.md`, `spec/v1/replay.md`.
- OpenWOP-app ADR 0255 — "segment-winback fan-out is an RFC-gated engine feature, not a chain step" (the motivating finding + first consumer).
- Prior art: AWS Step Functions `Map` state; Temporal child-workflow fan-out; LangGraph `Send` API.
