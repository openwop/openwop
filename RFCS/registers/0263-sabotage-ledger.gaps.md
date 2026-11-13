# RFC 0263 — Gap register

Severity is the first word of each question: **High** blocks `Active`; **Medium** and **Low** do not.

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Status | **High.** Whether the 7-day window may be waived for a certification rule. | Spec Architect | `closed` 2026-11-13 — waived by the maintainer directly (steward override of RFC 0147 §A.6, recorded in `MAINTAINERS.md`). | `Active` |
| G2 | §A | **High.** Would §A refuse a table that is honest but has a row with no leg yet? | Conformance Architect | `closed` 2026-11-13 — the verdict says `planned`; from RFC 0260 a `planned` row blocks `Accepted` (§A, Alternatives 4). | `Active` |
| G3 | §C | **Medium.** RFCs below 0260 have no ledger rows, though many legs were sabotaged when written (records in docstrings and commits). | Conformance Architect | `transferred:RFC 0263 Proposal §C` 2026-11-13 — a backfill is invited; §C is prospective by design (Alternatives 3). | none |
| G4 | §B | **Low.** A row's `subject.build` may name a sabotaged build that exists only locally. | Conformance Architect | `transferred:RFC 0263 Unresolved questions` 2026-11-13 — UQ 1. | none |
| G5 | §Conformance | **Medium.** The three `0263.*` ids have no `executed-pass` row in `evidence/corpus-ledger.json` until the regen chain runs `check-spec-coherence.mjs` on the merged tree. | Conformance Architect | `transferred:RFC 0263 Acceptance criteria` 2026-11-13 — the `Accepted` gate. | `Accepted` |
