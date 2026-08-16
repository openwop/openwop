# RFC 0154 — Gap Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B | Mandatory delegation proof format is undecided. | Security Architect | Compare JWT act/obo claims, token exchange, and signed chain envelope. | Active — **Sweep 2026-08-16:** **Carried** — `workload-identity.schema.json` names the vocabularies; no mandatory proof format chosen; no advertiser. |
| G2 | §C | DPoP implementation availability across SDKs is unmeasured. | SDK Maintainer | Prototype TS/Python/Go verification and classify optionality. | Active — **Sweep 2026-08-16:** **Carried** — DPoP availability unmeasured across SDKs (`openwop-sdks`). |
| G3 | §D | ~~First OTel GenAI mapping version is unsettled.~~ **Closed 2026-08-16 (decided):** no stable upstream version exists (GenAI conventions moved to `semantic-conventions-genai`, Development stability, untagged); mapping v0 is experimental, optional, ref-labelled, and projects no identity field (`observability.md`). | Observability Architect | Review stability labels; map only stable fields at Active. | ~~Active~~ Closed |
| G4 | §E | Canonical attestation predicate and signing service are not selected. | Supply-chain Maintainer | Compare SLSA provenance/in-toto and current CI identities. | Active — **Sweep 2026-08-16:** **Carried** — no attestation predicate / signing service; bundles unsigned (0148 G4). |
| G5 | §D | ~~Privacy/retention policy for hashed actor identifiers is missing.~~ **Addressed 2026-08-16:** per-tenant rotatable salt; deletion by salt rotation; retention stated in the host runbook (`auth.md` §D; `threat-model-workload-identity.md` §4.4). | Security Architect | Add privacy threat pass and retention guidance. | Addressed |

