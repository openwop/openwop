# RFC 0252 — Gap register

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §C, §D | The five Unresolved questions (several invocations, `argsMatch`, memory, an eval run as source, model answers). | Spec Architect | `transferred:RFC 0252 Unresolved questions` 2026-10-26 — decided at `Draft → Active`, after the comment window (ends 2026-11-02). | `Active` |
| G2 | §Conformance | No host advertises `recordedFixtures` or lists the three fixtures; the scenario and fixtures are not written. | Conformance Architect | `externally-gated:certified-host-cut` — the scenario lands at `Active`; a certified major-2 bundle with the `0252.*` host legs `executed-pass` closes this. | `Accepted` |
| G3 | §B | SDKs expose `fixtureRuns` and read the facet before sending it. | Compatibility Architect | `transferred:openwop-sdks` 2026-10-26 — after `Active`, beside the RFC 0251 properties. | `Accepted` checklist item |
| G4 | §E | "A replay does not re-resolve the source" has no outside witness: v2 has no portable run deletion. | Conformance Architect | `externally-gated:portable-run-deletion` — witnessable once a v2 operation deletes a run; until then the falsifiability row says `unwitnessable`. | none |
