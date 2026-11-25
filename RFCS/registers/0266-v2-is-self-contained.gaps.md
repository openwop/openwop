# RFC 0266 — Gap register

Severity is the first word of each question: **High** blocks `Active`; **Medium** and **Low** do not.

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Status | **High.** Whether the 7-day comment window may be waived. | Spec Architect | `closed` 2026-11-25 — waived by the maintainer directly (steward override of RFC 0147 §A.6, recorded in `MAINTAINERS.md`). | — |
| G2 | §B.2 | **Medium.** Whether any v2 operation serves the v1 debug bundle (UQ 1). | Spec Architect | `open` — read `spec/v2/path-manifest.json` during implementation; re-home or delete the v2 references. | `Accepted` |
| G3 | §B.2 | **Medium.** Whether the core-document homes fit `check-core-budget` (UQ 2). | Spec Architect | `open` — rules that do not fit move to schema descriptions; the cap is not raised. | `Accepted` |
| G4 | §D | **Medium.** openwop-app reads v1 files from `@openwop/spec-artifacts` (CORS header generator, seven flat-schema loaders). | openwop-app | `transferred:openwop-app v2 migration plan phase 3` — must land before §D.1 ships. | `Accepted` |
| G5 | §E | **Low.** Registry discovery lives in `openwop-registry`; its deploy is a separate repo's release. | Registry operator | `open` — PR in openwop-registry after §A.1's row exists. | `Accepted` |
