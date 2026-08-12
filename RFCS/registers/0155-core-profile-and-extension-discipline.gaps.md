# RFC 0155 — Gap Register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §D | Extension budget lacks empirical calibration. | Governance Maintainer | Inventory current cohort and review maintainer capacity. | Active |
| G2 | §C | Current extension registry backfill is not complete. | Spec Architect | Generate candidate ledger and review every RFC/capability. | Active |
| G3 | §C | Tier-3 exception for low-risk schema-only extensions is undecided. | Governance Maintainer | Define narrow evidence alternative or require Tier-3 universally. | Active |
| G4 | §E | Badge wording/design is not specified. | Docs Maintainer | Produce accessibility-safe text-first badge variants. | Accepted |
| G5 | §B | Manifest packaging location is unsettled. | Release Maintainer | Include in corpus and conformance package with drift check. | Active |
| G6 | §A | **§A is ready; §§B–D are not, and they gate the RFC as a whole.** §A's motivating defect is now evidence-backed (the published bundle claims `openwop-core` while failing six `interrupt-*` scenarios that `openwop-core-standard` would have rejected it for; RFC 0148 G6 gave `openwop-core` an explicit `discoveryOnly` marker recording that it has no runtime floor by design), and the alias rule is additive with no wire break. But §B's `core-standard-manifest.json` and §C's `extensions.json` **have no schema, no generator, and no conformance coverage**, so RFC 0147 §A.2's Schema and Conformance reviews cannot be completed against artifacts that do not exist. | Spec + Schema Architects | Either split §A to `Active` on its own evidence, or build the §B/§C artifacts far enough to review. Do NOT advance the whole RFC on §A's strength. | `Draft → Active` |

