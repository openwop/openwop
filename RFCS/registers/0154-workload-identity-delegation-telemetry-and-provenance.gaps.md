# RFC 0154 — Gap Register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B | Mandatory delegation proof format is undecided. | Security Architect | Compare JWT act/obo claims, token exchange, and signed chain envelope. | Active |
| G2 | §C | DPoP implementation availability across SDKs is unmeasured. | SDK Maintainer | Prototype TS/Python/Go verification and classify optionality. | Active |
| G3 | §D | ~~First OTel GenAI mapping version is unsettled.~~ **Closed 2026-08-16 (decided):** no stable upstream version exists (GenAI conventions moved to `semantic-conventions-genai`, Development stability, untagged); mapping v0 is experimental, optional, ref-labelled, and projects no identity field (`observability.md`). | Observability Architect | Review stability labels; map only stable fields at Active. | ~~Active~~ Closed |
| G4 | §E | Canonical attestation predicate and signing service are not selected. | Supply-chain Maintainer | Compare SLSA provenance/in-toto and current CI identities. | Active |
| G5 | §D | ~~Privacy/retention policy for hashed actor identifiers is missing.~~ **Addressed 2026-08-16:** per-tenant rotatable salt; deletion by salt rotation; retention stated in the host runbook (`auth.md` §D; `threat-model-workload-identity.md` §4.4). | Security Architect | Add privacy threat pass and retention guidance. | Addressed |

