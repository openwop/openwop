# RFC 0178 — Gap register

Open design gaps discovered while authoring RFC 0178 (v2 assurance registers and deprecation machinery; RFC 0167 child C.11). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B.1 | 558 of 558 `gaps.json` rows were `witness: unclassified` and `requirementId: null` at filing. This PR classifies the RFC 0167 family's rows; the rest is the RFC 0166 G2 ratchet. | Security Architect | `open` — v2 rows are gated from Phase 3; v1 rows ratchet as swept | RFC 0178 `Accepted` |
| G2 | §C.1 | Nine of 164 RFCs carry a falsifiability table; the parser is a gate for the RFC 0167 family and advisory elsewhere. | Conformance Architect | `open` — becomes a gate for every v2 RFC at the cut; v1 RFCs are not re-adjudicated | RFC 0178 `Accepted` |
| G3 | §B.3 | `check-gap-contradictions.mjs` resolves scenario files and OpenAPI paths only; a gap naming any other artifact is reported unchecked. | Conformance Architect | `open` — resolver classes added as the audit finds them; the unchecked count is printed every run | — |
| G4 | Unresolved Q1 | Whether AsyncAPI 3.x carries a standard `deprecated` on channels and messages. | Spec Architect | `open` — decided with the Phase 3 generator; `x-openwop-remove-in` is the portable carrier | RFC 0178 `Accepted` |
