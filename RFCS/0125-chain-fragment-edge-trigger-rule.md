# RFC 0125: Chain-pack `FragmentEdge.triggerRule` (fan-in / error-routing for workflow-chain packs)

| Field             | Value                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0125                                                                                                                        |
| **Title**         | Chain-pack `FragmentEdge.triggerRule` — mirror `WorkflowEdge.triggerRule` onto chain fragment edges                          |
| **Status**        | `Accepted`                                                                                                                  |
| **Author(s)**     | David Tufts (@dtuftsg); motivated by the openwop-app STRAT-PORTAL team (ADR 0247)                                            |
| **Created**       | 2026-07-04                                                                                                                  |
| **Updated**       | 2026-07-04 (Active → Accepted — single-witness: spec/schema/conformance `#822` + openwop-app reference-host `#1272`)          |
| **Affects**       | `schemas/workflow-chain-pack-manifest.schema.json`, `spec/v1/workflow-chain-packs.md`, `conformance/src/lib/workflow-chain-expansion.ts`, `conformance/src/scenarios/workflow-chain-expansion.test.ts` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — new OPTIONAL enum field on `FragmentEdge`, default `all_success` = the implicit prior behavior |
| **Supersedes**    | —                                                                                                                          |
| **Superseded by** | —                                                                                                                          |

## Summary

Top-level workflow edges carry `triggerRule` (`WorkflowEdge.triggerRule` in `workflow-definition.schema.json`) — a fan-in / error-routing enum the scheduler reads from a node's incoming edge to decide when the target fires (`all_success` default, plus `any_success`, `all_complete`, `none_failed`, `any_failed`). Workflow-chain packs' `FragmentEdge` does not expose it, so a chain pack cannot express error-routing or best-effort completion at the DAG-edge level. This RFC mirrors `triggerRule` onto `FragmentEdge` as an OPTIONAL field with default `all_success` — the exact same "mirror a `WorkflowEdge` field onto `FragmentEdge`" move as the 2026-07-03 RFC 0013 `condition` amendment. Expansion MUST carry the value onto the resulting `WorkflowEdge` so the scheduler honors it.

## Motivation

`FragmentEdge` (`schemas/workflow-chain-pack-manifest.schema.json`) currently exposes `from`, `to`, and (since the RFC 0013 2026-07-03 amendment) `condition`. It omits `triggerRule`, so a chain author cannot declare fan-in / error-routing semantics that the base workflow engine already supports on top-level edges. The result: any chain whose DAG needs "continue even if an upstream step failed / 404'd" must be authored by hand post-expansion, defeating the chain-pack abstraction.

**Concrete driver (openwop-app ADR 0247, STRAT-PORTAL forms→intake bridge, OQ-2):** a `done` terminal edge with `triggerRule: all_complete` so that a deleted-bound-list `submit-idea` returning `404` lets the run **complete cleanly** rather than failing — best-effort completion at the chain level. Today that requires editing the expanded workflow by hand; with this RFC the chain pack declares it once.

The spec already notes (`workflow-chain-packs.md` §WorkflowDefinitionFragment) that "The `FragmentNode` definition SHOULD be kept in sync as `WorkflowNode` evolves"; the same sync discipline applies to `FragmentEdge` ↔ `WorkflowEdge`. `WorkflowEdge` has `triggerRule`; `FragmentEdge` should too. This RFC closes that gap.

## Proposal

### Schema

Add an OPTIONAL `triggerRule` to `FragmentEdge` in `schemas/workflow-chain-pack-manifest.schema.json`, with the **same shape and enum as `WorkflowEdge.triggerRule`**:

```jsonc
"triggerRule": {
  "type": "string",
  "enum": ["all_success", "any_success", "all_complete", "none_failed", "any_failed"],
  "default": "all_success"
}
```

`FragmentEdge` remains `additionalProperties: false`. Omitting `triggerRule` is identical to `all_success` — the implicit prior behavior of a fragment edge — so no existing chain changes meaning.

### Expansion preservation (the load-bearing requirement)

Hosts (and the spec-authoritative expansion library `conformance/src/lib/workflow-chain-expansion.ts`) MUST **carry `FragmentEdge.triggerRule` onto the resulting `WorkflowEdge`** during expansion, exactly as `condition` is carried. This is normative in `workflow-chain-packs.md` §"Expansion semantics" step 6 ("Edge-field preservation"). The scheduler reads `triggerRule` from the target node's incoming edge; if expansion drops it (the failure mode the `condition` amendment documented — reference hosts historically dropped `condition` at expansion), the field is never honored and the RFC is silently no-op'd. The reference host carries `condition` through a `mapEdgeCondition` seam at expansion; `triggerRule` rides the same seam.

### Composition with `condition`

`condition` (does this edge participate, given the source's output?) and `triggerRule` (how does the target node aggregate its participating incoming edges?) are **orthogonal** and compose on the same edge. `condition` gates edge participation; `triggerRule` governs target firing across the (participating) incoming edges. No ordering dependency; both MUST be preserved at expansion.

### Positive example

```jsonc
{ "from": "submit-idea", "to": "done", "triggerRule": "all_complete" }
```

expands (with id-rewrite) to a `WorkflowEdge` `{ from, to, triggerRule: "all_complete" }` — the scheduler fires `done` once `submit-idea` has *finished* regardless of success, so a `404` completes the run instead of failing it.

### Negative example

A host that drops `triggerRule` at expansion (produces `{ from, to }` with no `triggerRule`) → **non-conformant**: violates §"Expansion semantics" step 6 edge-field preservation. The declared best-effort semantics silently vanish.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1:

- New OPTIONAL field on `FragmentEdge`; `default: "all_success"` equals the implicit prior behavior, so every existing chain expands to byte-identical `WorkflowEdge`s.
- No required field, no type change, no `MUST` relaxed, no error-code / status change.
- The rewrite target (`WorkflowEdge.triggerRule`) is an existing v1 construct — nothing new on the `WorkflowDefinition` wire.
- **No capability flag.** Like `condition`, `triggerRule` is an unconditional part of the manifest + expansion surface, gated only by `workflowChainPacks.supported` (a host that does chain expansion at all). The scheduler-side `triggerRule` semantics already exist for top-level edges.

## Conformance

- **New server-free assertions** in `conformance/src/scenarios/workflow-chain-expansion.test.ts` (edge-rewriting block): (a) a fragment edge carrying `condition` + `triggerRule` expands to a `WorkflowEdge` retaining both (backfills the previously-untested `condition`-survives case too); (b) omitting `triggerRule` yields an expanded edge with no `triggerRule`.
- The spec-authoritative lib `workflow-chain-expansion.ts` gains the `triggerRule` carry-through + a `TriggerRule` type; its stale `condition?: string` type is corrected to `unknown` (a lingering miss from RFC 0013 amendment #818 — the lib carried `condition` opaquely but mistyped it).
- Runs unconditionally (spec-corpus logic); no capability gate.

## Alternatives considered

1. **Fold into a coordinated RFC 0013 revision** (as the `condition` amendment did). Rejected: the `condition` amendment was a *safety-fix* (correcting a wrong *type* on an existing field); `triggerRule` is a *new additive capability*. The corpus pattern for new additive capabilities is a standalone RFC (0120 apiHosts, 0121 subscription auth, 0122 self-hosted-runner). Standalone keeps its own motivation + registers.
2. **Add `triggerRule` to `FragmentNode` instead of `FragmentEdge`.** Rejected (and corrected during drafting): `triggerRule` is an *edge* property (`WorkflowEdge.triggerRule`; the scheduler reads it from the target's incoming edge). A node-level field would be silently ignored.
3. **Do nothing.** Rejected: the ADR 0247 use case (and any best-effort chain) must hand-edit expanded workflows, defeating the pack abstraction.

## Unresolved questions

1. **Multiple incoming edges with divergent `triggerRule` after expansion.** The base workflow engine already resolves this (the target reads its incoming edges); expansion does not introduce new fan-in shapes beyond what the fragment author declares. No new rule needed — flagged for completeness.

## Implementation notes (non-normative)

- **Host seam:** the reference host carries `FragmentEdge.condition` through expansion via `mapEdgeCondition`; a `triggerRule` pass-through is a one-line addition on the same edge-mapping seam (openwop-app-1, crosstalk `4d98`). No new host plumbing.
- **Sequencing vs RFC 0124:** the in-flight RFC 0124 deferred-parameter work touches the same manifest schema file but a different `$def` (the chain-entry `parameters` description); `$def`-disjoint from `FragmentEdge`, so no conflict.

## Acceptance criteria

**Promoted to `Accepted` 2026-07-04 (single-witness, bootstrap steward waiver).** Witness: openwop-app reference host **#1272** (squash `2683286d`) — the `mapEdgeCondition` `triggerRule` pass-through carries the field onto the expanded `WorkflowEdge` verbatim, and the **non-vacuous host-gated leg** (forms-intake chain: an `all_complete` `done`-terminal reached from a `submit-idea` that 404s → the run **completes cleanly** in a real `executeRun`) closes ADR 0247 OQ-2; full backend suite 4793/0. Spec/schema/conformance side is `#822`. Single-witness under the 0120/0121 precedent (reference host + conformance). Register sweep: G3/G4 closed by #1272; no open register rows.

- [x] Schema: `FragmentEdge.triggerRule` (OPTIONAL, `WorkflowEdge` enum + default).
- [x] Spec: `workflow-chain-packs.md` §WorkflowDefinitionFragment edges row + §"Expansion semantics" step 6 edge-field-preservation MUST.
- [x] Spec-authoritative lib carries `triggerRule` through expansion; `condition` type corrected.
- [x] Server-free conformance asserts `condition` + `triggerRule` survive expansion + the omit-default case.
- [x] CHANGELOG entry + RFCS/README row/tally.
- [x] Reference host (openwop-app #1272) implements the `mapEdgeCondition` `triggerRule` pass-through + non-vacuous host-gated e2e witness (ADR 0247 OQ-2); rides `workflowChainPacks.supported`, no new capability.

## References

- **Motivating ADR:** openwop-app ADR 0247 (STRAT-PORTAL forms→intake bridge) OQ-2 — best-effort `all_complete` terminal.
- **Base being extended:** RFC 0013 (workflow-chain packs) + its 2026-07-03 `FragmentEdge.condition` amendment (#818) — the mirror-`WorkflowEdge`-field precedent.
- **Source shape:** `schemas/workflow-definition.schema.json` §`WorkflowEdge.triggerRule`.
- **Prior art:** Argo Workflows `depends` / dag-task dependency conditions; Airflow `trigger_rule` (`all_success`/`all_done`/`one_failed`/…) — the direct naming inspiration for the enum; Step Functions `Catch`/`Next` best-effort routing.
