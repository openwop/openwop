# RFC 0233 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The registry read discloses which providers and packs a host has installed, i.e. its integrations, to any authenticated caller. | M | L | Low | §B.6 limits a row to ids, pack names and codes; unresolved question 1 settles the scope. Provider definitions are public pack metadata (`packs.md`). | Security Architect | `accepted` — decided with G1 before `Active`. |
| R2 | A host's `refusals` diverge from what its install path actually did (it reports one outcome and enforces another). | L | M | Low | The read reports the install path's own outcome, not a separate validation; the §F fixture rows check the registry and the refusal agree. | Conformance Architect | `accepted` — the §F rows are the control. |
| R3 | Installing the fictional fixture pair on a production host is mistaken for a real integration. | L | L | Low | §D: the provider is fictional, has no endpoints, and is installed only at the operator's choice; the fixture id is advertised. | Reference Implementation Architect | `accepted` — operator opt-in. |
