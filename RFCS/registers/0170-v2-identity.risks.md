# RFC 0170 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Tenant-bound ids change every run id on the wire and break a client that parses ids | M | H | High | v2 only; the C.9 reader maps v1 ids on reads of v1 runs; SDK 2 types carry the kind; ids are opaque to clients by rule and a client that parsed them was already non-conforming | Spec Architect | `open` |
| R2 | A revocation MUST on every lane is unwitnessable on lanes with no seam | M | M | Medium | One revoke seam leg per lane in the §20 family (Phase 3); a lane whose seam does not land is `seam-gated` and its MUST is recorded as such, not as passed | Conformance Architect | `open` |
| R3 | The `Idempotency-Key` grammar refuses a legitimate client's short keys | L | M | Low | 22 chars of base64url is 128 bits; UUIDs pass; the refusal code names the grammar; the RFC 0150 escalation used exactly the shape refused | Reference-host maintainer | `accepted` |
| R4 | The legacy stamp is applied to a run that in fact carried a lane the host could attest, losing the lane | L | L | Low | §A.3 says "as attested else `api-key`"; both hosts already attest at mint time (RFC 0165 legs); only pre-2026-09-02 runs take the floor | Reference-host maintainer | `accepted` |
| R5 | Registering eight invariants at once at the cut lands with vacuous tests | M | H | High | RFC 0166 §C witness classes on each; RFC 0178's contradiction gate; an invariant whose scenario soft-skips on both matrix hosts is `blocked`, not passed (RFC 0148 §A) | Security Architect | `open` |
