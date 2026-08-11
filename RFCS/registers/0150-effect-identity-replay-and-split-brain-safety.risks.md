# RFC 0150 — Risk Register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Migration duplicates an effect across v1/v2 key spaces. | M | H | Critical | Dual-read, write-v2, migration fence, adversarial tests. | Compatibility Architect | Open |
| R2 | A semantic provider option is omitted and digest collision remains. | M | H | High | Closed namespaced providerOptions and adapter certification. | Provider Maintainer | Open |
| R3 | Fencing service outage halts effects. | M | H | High | Fail closed, explicit degraded posture, operator recovery. | Operations Architect | Open |
| R4 | Provider claims idempotency but retention is too short. | M | H | High | Qualifying contract includes retention ≥ OpenWOP retry horizon. | Security Architect | Open |
| R5 | Digests leak sensitive request information through correlation. | L | M | Low | No raw logging; keyed/truncated operational identifiers. | Security Architect | Open |
| R6 | Correcting strategy names breaks old discovery consumers. | M | M | Medium | Add new enum, warn/deprecate legacy, remove only under safety window or v2. | Compatibility Architect | Open |

