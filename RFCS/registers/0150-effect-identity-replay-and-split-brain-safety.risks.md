# RFC 0150 — Risk Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Migration duplicates an effect across v1/v2 key spaces. | M | H | Critical | Dual-read, write-v2, migration fence, adversarial tests. | Compatibility Architect | Open — **Sweep 2026-08-16:** **Closed as moot** — no v1 keys exist (G1); no dual-read needed while that holds. |
| R2 | A semantic provider option is omitted and digest collision remains. | M | H | High | Closed namespaced providerOptions and adapter certification. | Provider Maintainer | Open — **Sweep 2026-08-16:** **Open** (G3). |
| R3 | Fencing service outage halts effects. | M | H | High | Fail closed, explicit degraded posture, operator recovery. | Operations Architect | Open — **Sweep 2026-08-16:** **Open — no fencing host** (G10). |
| R4 | Provider claims idempotency but retention is too short. | M | H | High | Qualifying contract includes retention ≥ OpenWOP retry horizon. | Security Architect | Open — **Sweep 2026-08-16:** **Open** (G4). |
| R5 | Digests leak sensitive request information through correlation. | L | M | Low | No raw logging; keyed/truncated operational identifiers. | Security Architect | Open — **Sweep 2026-08-16:** **Mitigated** — digest v2 is a JCS SHA-256 over inputs, never logged raw by the suite; `--certify` scrubs secrets from evidence. |
| R6 | Correcting strategy names breaks old discovery consumers. | M | M | Medium | Add new enum, warn/deprecate legacy, remove only under safety window or v2. | Compatibility Architect | Open — **Sweep 2026-08-16:** **Mitigated additively** — `crossRegion` enum widened (`fenced-effects` added, legacy values retained); `multi-region-effect-vocabulary.test.ts` holds prose/schema together. |

