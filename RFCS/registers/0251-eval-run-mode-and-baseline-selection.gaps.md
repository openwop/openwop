# RFC 0251 — Gap register

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §C | Root properties or a `configurable` section; refusal code and reasons | Spec + Schema Architects | `closed` 2026-10-26 — `/architect`: root `evalModes` / `baselineRunId`, one uniform `400 validation_error`, no details (RFC §Unresolved questions 1–3). | — |
| G2 | §Conformance | No host advertises `baselineSelection` or lists the two regression fixtures. | Conformance Architect | `externally-gated:certified-host-cut` — openwop-app maps its existing `configurable` path onto the root properties (openwop-app-6a); a certified major-2 bundle with the `0251.*` and `0244.regression-*` legs `executed-pass` closes this. | `Accepted` |
| G3 | §B | SDKs expose the two properties and read the facet before sending them. | Compatibility Architect | `transferred:TODO.md` 2026-10-26 (the RFC 0251 line) — an openwop-sdks issue. | `Accepted` checklist item |
