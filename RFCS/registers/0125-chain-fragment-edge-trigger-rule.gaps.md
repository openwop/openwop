# RFC 0125 — Gap Register

Companion to `0125-chain-fragment-edge-trigger-rule.md`. Open questions and deferred items beyond the in-RFC Unresolved questions.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| ~~G1~~ | Governance | ~~New standalone RFC vs fold into a coordinated RFC 0013 revision?~~ **RESOLVED (steward, 2026-07-04):** standalone RFC — the corpus pattern for new additive capabilities (0120/0121/0122); the `condition` amendment was inline only because it was a safety-fix correction to an existing field. | Spec Architect | Done. | — |
| ~~G2~~ | Sequencing | ~~Merge order on `workflow-chain-pack-manifest.schema.json` vs RFC 0124 (#821).~~ **RESOLVED:** `$def`-disjoint (`FragmentEdge` here vs the chain-entry `parameters` description in #821); trivial merge, re-derive count surfaces. | Compatibility Architect | Done. | — |
| ~~G3~~ | Reference host | **RESOLVED (openwop-app #1272):** `mapEdgeCondition` `triggerRule` pass-through landed + merged; carries the field onto the expanded WorkflowEdge verbatim. | openwop-app | Done. | — |
| ~~G4~~ | Conformance | **RESOLVED (openwop-app #1272):** non-vacuous host-gated e2e — an `all_complete` done-terminal reached from a 404 `submit-idea` completes the run cleanly (real executeRun, ADR 0247 OQ-2). | Conformance Architect | Done. | — |
