# RFC 0251 — Gap register

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §C | Root properties or a `configurable` section; refusal code and reasons | Spec + Schema Architects | `closed` 2026-10-26 — `/architect`: root `evalModes` / `baselineRunId`, one uniform `400 validation_error`, no details (RFC §Unresolved questions 1–3). | — |
| G2 | §Conformance | No host advertises `baselineSelection` or lists the two regression fixtures. | Conformance Architect | `closed` 2026-10-26 — openwop-app's certified cut 230c (build `24b6a05ff`, ADR 0983) advertises `baselineSelection` and records the `0251.*` and `0244.regression-*` legs `executed-pass`. | — |
| G3 | §B | SDKs expose the two properties and read the facet before sending them. | Compatibility Architect | `closed` 2026-10-26 — openwop-sdks #62 carries both properties in the v2 SDKs (#2047). | — |
