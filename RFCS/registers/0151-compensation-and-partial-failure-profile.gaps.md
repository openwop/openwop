# RFC 0151 — Gap Register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §C | Dependency-graph inclusion in profile v1 is undecided. | Spec Architect | Prototype against three multi-effect fixtures. | Active |
| G2 | §D | ~~Exact run response carrying `compensationStatus` is unsettled.~~ **Closed 2026-08-16 (#1007):** `RunSnapshot` (`schemas/run-snapshot.schema.json`, `GET /v1/runs/{runId}`) is the sole owner. Traced: the run list has no summary schema of its own, and `debug-bundle.schema.json` + AsyncAPI `run.snapshot` reuse the snapshot by `$ref`, so one property covers every surface that returns a run; the six §D events already carry the transitions and do not need the rollup. OPTIONAL, capability-gated (non-advertising host MUST omit; advertising host MUST carry, `none` when idle), and the value is the normative fold in `spec/v1/compensation.md` §"Run rollup". Not settled by this: the value on a forked run of a partially compensated source (`compensation.md` G4). | Schema Architect | Trace run document/status/result schemas and choose one source. | ~~Active~~ Closed |
| G3 | §E | Operator substitution authorization and plan-version rules are open. | Security Architect | Threat-model and define closed override actions. | Active |
| G4 | §B | Irreversible-effect declaration vocabulary is absent. | Spec Architect | Add advisory/required declaration in child revision. | Accepted |
| G5 | Conformance | Real-service emulator choice is unset. | Conformance Architect | Use local transactional HTTP emulator with deterministic failures. | Accepted |

