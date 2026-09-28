# RFC 0224 — Gap register

Open design gaps found while authoring RFC 0224 (a major-1 witness bundle for a major-1-only requirement id). Rows are keyed to the RFC. Each has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Implementation notes | The predicate branch, the INTEROP-MATRIX path check and the coherence scenario `v2-major1-witness-bundle.test.ts` do not exist. They land at `Active`, never at `Draft`, because they loosen a gate. | Conformance Architect | `transferred:rfc-0224` — §Acceptance criteria boxes 3 and 4, at the `Active` flip after the window closes 2026-10-05. | `Active` |
| G2 | §Motivation 4 | The Postgres reference host publishes no `certification-bundle` key in its v1 `signingKeys[]` on `openwop-examples` `main`, so no attributable major-1 witness bundle can be cut yet. The 2026-09-28 dry run is not committed. | Reference Implementation Architect | `externally-gated:openwop-examples-postgres-signing-keys` — the in-flight `openwop-examples` change that adds the key, then a cut on a published suite ≥ 2.42.7. | RFC 0218 `Accepted`; this RFC's box 5 |
| G3 | Unresolved questions 1–4 | Whether a reasoned `inapplicable` sibling leg is admitted; where §A.1 is evaluated; a `openwop-discovery-core` floor; the tier floor. | Spec Architect | `transferred:rfc-0224` — §Unresolved questions 1–4, answered or carried at `Active`. | `Active` |
| G4 | Unresolved question 5 | The audit-log integrity family has no v2 home (`spec/v2/profiles.json`, no core doc), which is why its signature row is major-1-only. | Spec Architect | `externally-gated:v2-audit-log-profile-rfc` — a separate normative RFC, if the corpus wants the family at v2. | Nothing in this RFC. |
| G5 | Unresolved question 6 | The approval count for an amendment to the decision rule (two approvals; one maintainer). | Governance | `transferred:rfc-0224` — decided and recorded at the `Active` flip under `GOVERNANCE.md` §"Sole-steward operation"; the window itself is not shortened. | `Active` |
