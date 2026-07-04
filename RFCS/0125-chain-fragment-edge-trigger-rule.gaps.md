# RFC 0125 — Gap Register

Companion to `0125-chain-fragment-edge-trigger-rule.md`. Open questions and deferred items beyond the in-RFC Unresolved questions.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| ~~G1~~ | Governance | ~~New standalone RFC vs fold into a coordinated RFC 0013 revision?~~ **RESOLVED (steward, 2026-07-04):** standalone RFC — the corpus pattern for new additive capabilities (0120/0121/0122); the `condition` amendment was inline only because it was a safety-fix correction to an existing field. | Spec Architect | Done. | — |
| ~~G2~~ | Sequencing | ~~Merge order on `workflow-chain-pack-manifest.schema.json` vs RFC 0124 (#821).~~ **RESOLVED:** `$def`-disjoint (`FragmentEdge` here vs the chain-entry `parameters` description in #821); trivial merge, re-derive count surfaces. | Compatibility Architect | Done. | — |
| G3 | Reference host | The `mapEdgeCondition` `triggerRule` pass-through is host-side (openwop-app repo), not in this spec-corpus PR. Needs a host PR to make a lifted `triggerRule` honored end-to-end in a real run. | openwop-app | Host follow-up PR on the existing edge-map seam. | `Accepted` (host witness) |
| G4 | Conformance | This RFC's conformance is server-free (expansion preserves the field). An end-to-end host-run assertion (scheduler actually honors `all_complete` so a failed source completes the run) would strengthen it but requires a reference-host run seam. | Conformance Architect | Add a host-gated leg when the host pass-through lands. | `Accepted` |
