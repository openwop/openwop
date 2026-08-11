# RFC 0154 — Risk Register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Provenance is mistaken for authorization. | M | H | Critical | Normative separation and per-boundary negative tests. | Security Architect | Open |
| R2 | Delegation amplifies scopes or crosses tenants. | M | H | Critical | Intersection-only scopes, audience/tenant binding, fail closed. | Security Architect | Open |
| R3 | Bearer downgrade bypasses sender constraint. | M | H | Critical | Minimum-assurance policy and downgrade audit/failure. | Auth Maintainer | Open |
| R4 | Signing key compromise blesses malicious artifacts. | L | H | High | Short-lived CI identity, transparency log, rotation/revocation. | Supply-chain Maintainer | Open |
| R5 | Telemetry leaks workload or user identity. | M | H | High | Opaque IDs, cardinality limits, redaction canaries. | Observability Architect | Open |

