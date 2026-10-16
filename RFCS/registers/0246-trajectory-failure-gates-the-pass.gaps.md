# RFC 0246 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Acceptance | `COMPATIBILITY.md` §3 requires a `### Security` CHANGELOG entry citing an advisory ID per `SECURITY.md`; no advisory exists yet. | Security Architect | `closed` 2026-10-16 — draft advisory `GHSA-ffx7-pm5h-v6pq` filed; the 2.46.13 `### Security` entry cites it. Publishing the advisory with the release is in TODO.md (the RFC 0246 line). | — |
| G2 | UQ 1 | Whether `gatedScore` is always present on a trajectory task, or only when it differs. | Spec Architect | `closed` 2026-10-15 — always present on a trajectory task, and `gatedAggregateScore` on any suite with one (§D, UQ 1). | — |
| G3 | §Compatibility | MyndHyve (build `73befc109`) implements RFC 0244 and decides both the `mean` task pass and the suite `passed` on output scores, so it is in the harm set; the window waiver is conditional on its fix. | Reference Implementation Architect | `transferred:TODO.md` 2026-10-16 (the RFC 0246 line) — MyndHyve ships the §A–§D gate and passes `0246.mean-gated` and `0246.suite-gated` on a certified cut. | `Accepted` |
