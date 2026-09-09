# RFC 0171 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The event-type codemod renames a persisted log wrongly and replay diverges | L | H | Medium | The map is data reviewed row by row (20 hand decisions); the codemod refuses any reserved-prefix name with no row; the C.9 fork-a-v1-run scenario replays a v1 log through the same map on both matrix hosts before the cut | Conformance Architect | `open` |
| R2 | Closing every payload def strands a host that emits an extra key today | M | M | Medium | The C.9 reader strips unknown keys on v1 reads; a v2 host that needs a key adds it to the registry (§A.5 growth rule) | Spec Architect | `mitigated` |
| R3 | A closed error enum makes every new code a schema regeneration | M | L | Low | That is the design: `errors.json` is the registry and the envelope is generated; adding a row is additive under §A.5 | Spec Architect | `accepted` |
| R4 | `configurable` closure refuses a run that a v1 host accepted (unknown undotted key) | M | M | Medium | v2 only; the codemod refuses rather than drops so the operator sees the key; `extensions.<org>` is the sanctioned home | Reference-host maintainer | `mitigated` |
| R5 | Dropping `details.retryAfter*` removes a field an SDK reads | L | M | Low | All three SDKs read `Retry-After`; the body fields were mirrors by rule (`production-profile.md:51`); SDK 2 drops the readers | SDK maintainer | `mitigated` |
