# RFC 0252 — Gap register

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §C, §D | The five Unresolved questions (several invocations, `argsMatch`, memory, an eval run as source, model answers). | Spec Architect | `closed` 2026-10-26 — ruled at `Draft → Active` (RFC §Unresolved questions): all invocations in sequence; `exact` only; no memory; an eval run may be the source; tool boundary only. | none |
| G2 | §Conformance | No host advertises `recordedFixtures` or lists the three fixtures. | Conformance Architect | `closed` 2026-10-27 — openwop-app's certified 2.46.32 cut (build `2c8bc27d6`, ADR 0984) advertises `recordedFixtures`, lists the three fixtures and records the six `0252.*` legs `executed-pass`. | — |
| G3 | §B | SDKs expose `fixtureRuns` and read the facet before sending it. | Compatibility Architect | `closed` 2026-10-26 — openwop-sdks #63 carries `fixtureRuns` in the v2 SDKs (#2050), released in SDK 2.7.0. | — |
| G4 | §E | "A replay does not re-resolve the source" has no outside witness: v2 has no portable run deletion. | Conformance Architect | `externally-gated:portable-run-deletion` — witnessable once a v2 operation deletes a run; until then the falsifiability row says `unwitnessable`. | none |
