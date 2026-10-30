# RFC 0254 — Gap register

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Conformance | No host advertises `agents.deployment` or lists `conformance-agent-channel-dispatch` at major 2. | Conformance Architect | `closed` 2026-10-30 — openwop-app 2.46.35 production cut `72e610b3d` advertises the facet and passes 14 `0082.*` legs (G5 owns the other two) | — |
| G2 | §D | A gated transition's `202` has no portable trigger: the suite cannot make a host gate a transition. | Conformance Architect | `externally-gated:gated-deployment-fixture` — witness once a host lists a fixture whose transition is gated, as `conformance-eval-gate-failing` declares a gate. | none |
| G3 | §D | `transitionRunId` and the 202/409 responses need types in the v2 SDKs. | Compatibility Architect | `transferred:openwop-sdks` — file with the 2.46.35 release tracking issue. | none |
| G4 | §A–§E | The eight questions `v2-deployment-lifecycle` reported (#2060). | Spec Architect | `closed` 2026-10-29 — ruled by `/architect`; §A–§E. | — |
| G5 | §A | `0082.state-unadvertised-refused` and `0082.canary-unsupported-refused` refuse a state or canary the host leaves out. The only implementation advertises all seven states and canary, so both record `inapplicable`. | Conformance Architect | `externally-gated:subset-deployment-host` — witness when a certified host advertises `agents.deployment` with a `states` subset or without canary | none |
