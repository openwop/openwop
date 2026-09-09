# RFC 0171 — Gap register

Open design gaps discovered while authoring RFC 0171 (v2 wire envelope; RFC 0167 child C.4). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A.2 | The generator folded 21 three-segment types silently; two are recorded exceptions (`envelope.nl-to-format-engaged`, `trigger.subscription-state-changed`) and the rest fold cleanly — re-verified in this PR; the corpus gate over the enum lands in Phase 3. | Spec Architect | `open` — `event-naming-rule` scenario (Phase 3) checks every member against the grammar and the exception list in the codemap | RFC 0171 `Accepted` |
| G2 | §E.2 | The poll response shape disagreed between `version-negotiation.md:300–308` (five fields, `isTerminal`) and `api/openapi.yaml:427–435` (two fields, `isComplete`) and no register recorded it; hosts implemented the OpenAPI shape. | Spec Architect | `open` — unified here (row C4.14); the v1 prose is corrected editorially in a separate PR to match OpenAPI so the v1 tree does not carry two shapes to retirement | — |
| G3 | §E.1 | `hostEvents` (heartbeat) needs a declared delivery address; whether a normative transport is required is undecided. | Spec Architect | `open` — decided in Phase 3 with the C.8 child | RFC 0175 `Active` |
| G4 | §B.2 | The suite's `LEGACY` tolerance for two retired idempotency spellings leaves at the cut; a host still emitting one fails `error-registry`. | Conformance Architect | `open` — both matrix hosts emit the canonical code today; the tolerance list is deleted with suite 2.0.0 | RFC 0168 `Accepted` |
| G5 | §A.4 | E1 (partial reassembly) and E2 (multi-turn correlation) get a contract in `spec/v2/core/events.md`; the contract text is not written here. | Spec Architect | `open` — Phase 3 with the generated envelope | RFC 0171 `Accepted` |
