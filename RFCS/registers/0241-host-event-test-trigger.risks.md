# RFC 0241 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The operation amplifies deliveries against the tenant's own registered receivers. | L | L | Low | §B.4 confines it to the caller's tenant, so it reaches only URLs the caller's tenant registered; §B.5 rate limit; the payload is empty. | Security Architect | `accepted` — bounded to receivers the caller already controls. |
| R2 | A consumer treats a test event as a real one. | L | L | Low | §A reserves the types and §A.2 forbids emitting any other type in answer to §B; a subscriber names the types it wants. | Spec Architect | `accepted` — the type is the marker. |
