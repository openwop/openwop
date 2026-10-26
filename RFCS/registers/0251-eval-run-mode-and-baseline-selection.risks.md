# RFC 0251 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A foreign baseline is accepted, and `scoreDelta` leaks another tenant's `aggregateScore` | M | H | High | §C: only a run the caller's owner triple can read; one refusal for every unusable baseline; `0251.baseline-uniform` uses a second tenant's real run | Security Architect | at `Active` | `mitigated` — by §C and `0251.baseline-uniform`. |
| R2 | The refusal distinguishes "another tenant's run" from "no such run" | M | H | High | One status and code, no details, no echoed id | Security Architect | at `Active` | `mitigated` — by §C. |
| R3 | A host's suite store keys by `suiteId` alone, so the two fixtures collide | M | M | Med | The fixtures resolve by fixture id; noted in Implementation notes for openwop-app | Conformance Architect | before the host cut | `accepted` — the host's store, confirmed when it lists both fixtures. |
| R4 | A client sends the properties to a host without the member and the closed body refuses them | L | L | Low | Advertise-first: the client reads `baselineSelection` first (§A) | Compatibility Architect | at `Active` | `mitigated` — by §A. |
