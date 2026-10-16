# RFC 0246 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Acceptance | `COMPATIBILITY.md` §3 requires a `### Security` CHANGELOG entry citing an advisory ID per `SECURITY.md`; no advisory exists yet. | Security Architect | `closed` 2026-10-16 — draft advisory `GHSA-ffx7-pm5h-v6pq` filed; the 2.46.13 `### Security` entry cites it. Published 2026-10-16 15:29:51Z, after MyndHyve's fix deployed (was: TODO.md, the RFC 0246 line). | — |
| G2 | UQ 1 | Whether `gatedScore` is always present on a trajectory task, or only when it differs. | Spec Architect | `closed` 2026-10-15 — always present on a trajectory task, and `gatedAggregateScore` on any suite with one (§D, UQ 1). | — |
| G3 | §Compatibility | MyndHyve (build `73befc109`) implements RFC 0244 and decides both the `mean` task pass and the suite `passed` on output scores, so it is in the harm set; the window waiver is conditional on its fix. | Reference Implementation Architect | `closed` 2026-10-16 — MyndHyve deployed the §A–§D gate (build `c8d511d84`, revision `workflow-runtime-00462-s57`) before the advisory was published, and its certified 2.46.13 production cut (`myndhyve-2.46.13-c8d511d84.json`, 418/0/0) records `0246.mean-gated` and `0246.suite-gated` `executed-pass`. | — |
