# RFC 0254 — Gap register

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Conformance | No host advertises `agents.deployment` or lists `conformance-agent-channel-dispatch` at major 2. | Conformance Architect | `externally-gated:openwop-app-5393` — openwop-app implements the facet and cuts on 2.46.35 or later. | `Active → Accepted` |
| G2 | §D | A gated transition's `202` has no portable trigger: the suite cannot make a host gate a transition. | Conformance Architect | `externally-gated:gated-deployment-fixture` — witness once a host lists a fixture whose transition is gated, as `conformance-eval-gate-failing` declares a gate. | none |
| G3 | §D | `transitionRunId` and the 202/409 responses need types in the v2 SDKs. | Compatibility Architect | `transferred:openwop-sdks` — file with the 2.46.35 release tracking issue. | none |
| G4 | §A–§E | The eight questions `v2-deployment-lifecycle` reported (#2060). | Spec Architect | `closed` 2026-10-29 — ruled by `/architect`; §A–§E. | — |
