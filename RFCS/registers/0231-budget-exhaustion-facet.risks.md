# RFC 0231 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host advertises `budget` without the facet and does not serve `interrupt`. Under §B.2 it is still taken to serve both, so a client is misled exactly as today. | H | M | Med | The facet gives the host an honest advertisement; G1 asks whether absence should mean `fail` only. The refusal row cannot catch a host that omits the facet. | Compatibility Architect | `accepted` — the state before this RFC; it is not made worse, and G1 decides whether to remove it. |
| R2 | A host accepts `interrupt`, ignores it and lets the run exceed its cap. | L | H | Med | §C.2 forbids it, and §C.1 makes the refusal observable on a host that advertises `["fail"]`. A host without the facet is covered only by the existing budget witness, which sends `fail`. | Security Architect | `open` — mitigated once the §F refusal row ships with its sabotage proof. |
| R3 | A client written against RFC 0084 assumes `interrupt` everywhere and does not read the facet. | L | L | Low | It gets `422 capability_not_provided` at create, before any spend. | Spec Architect | `accepted` |
| R4 | The facet lists `interrupt` on a host whose approval does not extend the budget, and nothing witnesses it (G2). | M | M | Med | Recorded as unwitnessed in the falsifiability table. No row passes on the served path until its shape is pinned. | Conformance Architect | `accepted` — recorded unwitnessed (G2). |
