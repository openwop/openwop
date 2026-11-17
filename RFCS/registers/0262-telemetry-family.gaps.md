# RFC 0262 — Gap register

Severity is the first word of each question: **High** blocks `Active`; **Medium** and **Low** do not.

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A | **High.** Re-shape the `observability` metadata into a family, or add a new family? | Schema Architect | `closed` 2026-11-13 — a new core family `telemetry`; re-shaping a root key is breaking at v2 (§Alternatives 1). | `Active` |
| G2 | §Status | **High.** Whether the comment window may be waived. | Spec Architect | `closed` 2026-11-13 — waived by the maintainer directly (steward override of RFC 0147 §A.6, recorded in `MAINTAINERS.md`). | `Active` |
| G3 | §Conformance | **Medium.** No host advertises `telemetry`, so every host leg records `inapplicable` until one does. | Conformance Architect | `closed` 2026-11-17 — the reference host advertises `telemetry`, and its certified 2.49.6 cut (`ed00ba4`) records every host leg `executed-pass`. | `Accepted` |
| G4 | §Conformance | **Medium.** A deployed host's exporter cannot reach a collector on the suite's loopback; the certify run needs a public front for the collector, as the webhook receiver has. | Conformance Architect | `closed` 2026-11-17 — the witness host runs beside the suite and exports to the collector over loopback, so no public front is needed. A deployed host still needs one, or the legs record `blocked`. | `Accepted` |
| G5 | §Security | **Medium.** Whether a host may decline to continue an untrusted caller's `traceparent`. | Security Architect | `transferred:RFC 0262 Unresolved questions` 2026-11-13 — question 2. | none |
| G6 | §F | **Low.** The fate of the `observability` metadata at v3. | Spec Architect | `transferred:RFC 0262 Unresolved questions` 2026-11-13 — question 1. | none |
| G7 | §B.5 | **Low.** Metrics are a SHOULD with no v2 vocabulary. | Spec Architect | `transferred:RFC 0262 Unresolved questions` 2026-11-13 — question 4. | none |
| G8 | §Compatibility | **Low.** A replay fork's spans have no rule linking them to the source run's trace. | Spec Architect | `transferred:RFC 0262 Unresolved questions` 2026-11-13 — question 3. | none |
