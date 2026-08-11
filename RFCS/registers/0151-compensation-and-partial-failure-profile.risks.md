# RFC 0151 — Risk Register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Compensation executes twice. | M | H | Critical | RFC 0150 stable IDs, durable CAS, provider idempotency. | Runtime Architect | Open |
| R2 | Inverse action worsens the incident. | M | H | Critical | Approvals, least privilege, validation, manual state, audit. | Security Architect | Open |
| R3 | Users interpret compensation as atomic rollback. | H | M | High | Normative best-effort language and explicit partial states. | Spec Architect | Open |
| R4 | Replay re-fires inverse effects. | M | H | Critical | Recorded outcomes, fail-closed missing source, strict test. | Replay Maintainer | Open |
| R5 | Compensation plan captures secrets. | M | H | High | Reference-only credentials, redaction schema, canary tests. | Security Architect | Open |

