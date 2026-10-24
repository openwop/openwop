# RFC 0249 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | MyndHyve's v1 `agents.proposals` advert, carried into v2 discovery, makes the new legs run, and they report `blocked`, which denies certification. | M | M | Med | The scenario is gated on `clientDrafts` and `readback`, which no existing advert carries, so an old advert records `inapplicable`. MyndHyve is warned before the suite release. | Conformance Architect | `mitigated` — by the gate design (§Conformance). |
| R2 | `clientDrafts` gives a new write path. A draft is inert, but a host that wires submitted drafts into resolution early breaks the inertness invariant on a client's say-so. | L | H | Med | §B: a submitted draft is held to every RFC 0096 rule; `0249.draft-inert` reads it through the resolution surface. | Security Architect | `mitigated` — by `0249.draft-inert`. |
| R3 | A host serves a re-normalized template on read (field order, defaults filled), so honest installs fail byte-match. | M | M | Med | JCS removes ordering; §D names the host-owned fields excluded; UQ 5 asks whether the set is complete. | Schema Architect | `accepted` — UQ 5 decides before `Active`. |
| R4 | The proposal operations become an existence oracle across tenants. | L | H | Med | §A: a foreign proposal answers exactly as an unknown id; `0249.cross-tenant-not-found` compares the two. | Security Architect | `mitigated` — by the leg. |
