# RFC 0154 — Risk Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Provenance is mistaken for authorization. | M | H | Critical | Normative separation and per-boundary negative tests. | Security Architect | Open — **Sweep 2026-08-16:** **Mitigated in prose + suite** — identity ≠ authorization normative; `delegation-tenant-audience-bound` / `delegation-chain-bounded` invariants; **no advertiser** → behavioural rows `blocked`. |
| R2 | Delegation amplifies scopes or crosses tenants. | M | H | Critical | Intersection-only scopes, audience/tenant binding, fail closed. | Security Architect | Open — **Sweep 2026-08-16:** **Mitigated in prose + suite** — intersection-only scopes + tenant/audience binding (`auth.md`); same two invariants; no advertiser. |
| R3 | Bearer downgrade bypasses sender constraint. | M | H | Critical | Minimum-assurance policy and downgrade audit/failure. | Auth Maintainer | Open — **Sweep 2026-08-16:** **Open** — sender-constraint minimum-assurance policy in prose; downgrade audit leg absent; no advertiser. |
| R4 | Signing key compromise blesses malicious artifacts. | L | H | High | Short-lived CI identity, transparency log, rotation/revocation. | Supply-chain Maintainer | Open — **Sweep 2026-08-16:** **Open** — no signing (G4). |
| R5 | Telemetry leaks workload or user identity. | M | H | High | Opaque IDs, cardinality limits, redaction canaries. | Observability Architect | Open — **Sweep 2026-08-16:** **Mitigated in prose** — opaque hashed identifiers, per-tenant salt, content-free telemetry (`observability.md`; threat model §4.4); no witness. |

