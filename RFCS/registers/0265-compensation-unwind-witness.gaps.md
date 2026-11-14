# RFC 0265 — Gap register

Severity is the first word of each question: **High** blocks `Active`; **Medium** and **Low** do not.

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Status | **High.** Whether the 7-day comment window may be waived. | Spec Architect | `closed` 2026-11-13 — waived by the maintainer directly (steward override of RFC 0147 §A.6, recorded in `MAINTAINERS.md`). | `Active` |
| G2 | §Falsifiability | **Medium.** The two registration refusals in `security-defaults.md` §Compensation have no v2 observable. | Spec Architect | `closed` 2026-11-13 — UQ 1 decided: both stay MUST, recorded unwitnessable in the Falsifiability table. | none |
| G3 | §A | **Medium.** No host serves `core.conformance.compensable-effect` yet; the five legs are `inapplicable` everywhere until one does. | Conformance Architect | `transferred:RFC 0265 Acceptance criteria` 2026-11-13 — the certified-bundle box. | `Accepted` |
| G4 | §B | **Low.** `manualIntervention` has no behavioral leg. | Conformance Architect | `closed` 2026-11-13 — UQ 2 decided: no leg in this RFC; a later RFC may add one with a second reserved behavior. | none |
