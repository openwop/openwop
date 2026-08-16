# RFC 0151 — Risk Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Compensation executes twice. | M | H | Critical | RFC 0150 stable IDs, durable CAS, provider idempotency. | Runtime Architect | Open — **Sweep 2026-08-16:** **Mitigated in prose** — inverse-action identity tuple stated (`compensation.md` G1 carries persistence shape); unwitnessed (no host). |
| R2 | Inverse action worsens the incident. | M | H | Critical | Approvals, least privilege, validation, manual state, audit. | Security Architect | Open — **Sweep 2026-08-16:** **Open — unwitnessed** (§E carried; no host). |
| R3 | Users interpret compensation as atomic rollback. | H | M | High | Normative best-effort language and explicit partial states. | Spec Architect | Open — **Sweep 2026-08-16:** **Mitigated in prose** — best-effort language, `partial` / `manual` states, `compensationStatus: none` default; claims-test unbuilt. |
| R4 | Replay re-fires inverse effects. | M | H | Critical | Recorded outcomes, fail-closed missing source, strict test. | Replay Maintainer | Open — **Sweep 2026-08-16:** **Mitigated in suite** — `compensation-replay-no-refire` invariant + `compensation-behavior.test.ts` leg (gated; `blocked` until a host advertises). |
| R5 | Compensation plan captures secrets. | M | H | High | Reference-only credentials, redaction schema, canary tests. | Security Architect | Open — **Sweep 2026-08-16:** **Mitigated in schema** — `compensation-policy.schema.json` carries no credential fields; `--certify` scrubs evidence; no host to test. |

