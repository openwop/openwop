# RFC 0153 — Risk Register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Silent downgrade re-enables weaker legacy auth/session behavior. | M | H | Critical | Exact profiles, minimum-version policy, audit, fail closed. | Security Architect | Open |
| R2 | MRTR work duplicates after timeout/retry. | M | H | High | RFC 0150 stable identity and recorded outcomes. | Runtime Architect | Open |
| R3 | Cache crosses tenant or authorization scope. | M | H | Critical | Scoped key, validator invalidation, adversarial tests. | Security Architect | Open |
| R4 | Extension metadata grants unintended authority. | M | H | High | Opaque-by-default and explicit mapping registry. | Security Architect | Open |
| R5 | Upstream protocol changes again. | M | M | Medium | Exact version profiles and scheduled refresh policy. | Interop Maintainer | Open |

