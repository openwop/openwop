# RFC 0260 — Gap register

Severity is the first word of each question: **High** blocks `Active`; **Medium** and **Low** do not.

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Compatibility | **High.** Safety-fix (every replaying host switches) or opt-in (an advertised recipe id)? | Compatibility Architect | `closed` 2026-11-13 — the maintainer chose opt-in ("1. opt-in"); RFC 0041's recipe stays the default. | `Active` |
| G2 | §Status | **High.** Whether the comment window may be waived for a replay-class RFC. | Spec Architect | `closed` 2026-11-13 — waived by the maintainer directly (steward override of RFC 0147 §A.6, recorded in `MAINTAINERS.md`). | `Active` |
| G3 | §Conformance | **High.** Is there a witness that needs no seam? | Conformance Architect | `closed` 2026-11-13 — the key is recorded on the effect ledger (§C), a normative observation path; the fixture pins every input so the suite recomputes it. | `Active` |
| G4 | §B.2 | **Medium.** RFC 0041 left the canonical message form open. | Schema Architect | `closed` 2026-11-13 — §B.2: `{role, content[]}`, a string content becomes one text part, no Unicode normalisation. | none |
| G5 | §C.3 | **Medium.** Replay matching by the source record's recipe has no witness: the suite cannot change a host's recipe mid-test. | Conformance Architect | `transferred:RFC 0260 Unresolved questions` 2026-11-13 — question 2. | none |
| G6 | §Acceptance criteria | **Medium.** No host advertises the facet or the fixture yet, so every host leg records `inapplicable`. | Reference host | `transferred:RFC 0260 Acceptance criteria` 2026-11-13 — the `Accepted` gate; openwop-app and the v2 reference host map `conformance.callai.cache-key`. | `Accepted` |
| G7 | §B.1 | **Low.** Whether `reasoning` / `effort` parameters belong in the named set. | Spec Architect | `transferred:RFC 0260 Unresolved questions` 2026-11-13 — question 3; `extra` covers them today. | none |
