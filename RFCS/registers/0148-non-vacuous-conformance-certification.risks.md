# RFC 0148 — Risk Register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Historic claims are materially invalid. | H | H | Critical | Inventory, invalidate precisely, reissue, avoid blanket accusations. | Release Maintainer | Open |
| R2 | Witnesses leak response or tenant content. | M | H | High | Hash content-free reporter records; canary tests and external audit. | Security Architect | Open |
| R3 | Requirement IDs churn and make evidence unverifiable. | M | M | Medium | Stable registry and alias/deprecation rules. | Spec Architect | Open |
| R4 | Explicit skips make suite output noisy or brittle. | M | M | Medium | Structured dispositions and profile-aware summaries. | Conformance Architect | Open |
| R5 | A malicious generator fabricates witnesses. | M | H | High | Independent generation, reproducible runs, provenance/signing in RFC 0154. | Security Architect | Open |
