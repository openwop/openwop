# RFC 0264 — Gap register

Severity is the first word of each question: **High** blocks `Active`; **Medium** and **Low** do not.

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Status | **High.** Whether the 7-day comment window may be waived. | Spec Architect | `closed` 2026-11-13 — waived by the maintainer directly (steward override of RFC 0147 §A.6, recorded in `MAINTAINERS.md`). | `Active` |
| G2 | §A.2 | **Medium.** Whether a retired host's last bundle should keep counting toward adoption. | Spec Architect | `closed` 2026-11-13 — UQ 1 decided: it keeps counting (GOVERNANCE.md). | none |
| G3 | §A.3 | **Medium.** The 2026-11-13 counts (18 / 24 / 16 / 12) came from a text match on discovery documents, not from the script §A specifies. | Conformance Architect | `closed` 2026-11-13 — the script's counts replaced the estimate (18 / 24 / 28). | `Active` |
| G4 | §B.6 | **Medium.** Each family at `none` needs a stated plan before its first `keep` row can be written. | Spec Architect | `closed` 2026-11-13 — `evidence/core-adoption-review.json` holds 18 `keep` rows with reasons and plans. | `Active` |
