# RFC 0261 — Gap register

Severity is the first word of each question: **High** blocks `Active`; **Medium** and **Low** do not.

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Status | **High.** Whether the 7-day window may be waived. | Spec Architect | `closed` 2026-11-13 — waived by the maintainer directly (steward override of RFC 0147 §A.6, recorded in `MAINTAINERS.md`). | `Active` |
| G2 | §Conformance | **Medium.** No scenario witnesses §A or §C; no host advertises `multiRegion`. | Conformance Architect | `transferred:RFC 0261 Acceptance criteria` 2026-11-13 — a scenario when a host advertises the facet; port of the major-1 simulators listed in `docs/KNOWN-LIMITS.md`. | `Accepted` |
| G3 | §Unresolved questions | **Medium.** The fate of the losing run when a `reconciled-records` partition heals. | Spec Architect | `transferred:RFC 0261 Unresolved questions` 2026-11-13 — question 1. | none |
| G4 | §Unresolved questions | **Low.** Whether to add an observable home-region hint so §A can be witnessed without operator help. | Conformance Architect | `transferred:RFC 0261 Unresolved questions` 2026-11-13 — question 2. | none |
| G5 | §Proposal | **High.** Where the normative text lives, given the core word budget and that the facets are seeded from the frozen v1 schema. | Schema Architect | `closed` 2026-11-13 — a new v2-decided `spec/v2/facets/idempotency.schema.json`; descriptions only, shapes unchanged. | `Active` |
