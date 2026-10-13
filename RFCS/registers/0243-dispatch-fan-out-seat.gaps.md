# RFC 0243 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A.2, §Conformance | No host seeds `conformance-dispatch-fanout-race`, so the `createRun` refusal has no witness; every host records the leg `inapplicable`. | Reference Implementation Architect | `transferred:TODO.md` — the v2 reference host (openwop-examples) seeds the fixture and refuses it, then a certified cut records `0243.unadmitted-fan-out-refused`. | `Accepted` |
| G2 | §A.3, §A.4 | No fixture drives a live parallel fan-out or a supervisor emitting `nextWorkerInputs`, so `maxFanOut` waves and the `perItemInput` refusal have no v2 leg. | Conformance Architect | `externally-gated:host-advertises-agents-fanOut` — a leg is worth writing once a host advertises the facet; until then both rules bind no one who claims them. | — |
