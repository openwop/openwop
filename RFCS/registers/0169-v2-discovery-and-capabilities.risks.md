# RFC 0169 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A closed root strands a host extension that today rides the open root | M | M | Medium | One extension key with a grammar; the codemod moves the eleven known families and refuses unknown ones rather than dropping them | Spec Architect | `mitigated` |
| R2 | Deleting `Capabilities-Etag` breaks a client that read it as the negotiation validator | L | M | Low | RFC 0165 §C.2 dual emission through the overlap; `ETag` is the same bytes; row C2.9 is `behavior` with the deprecation date | Reference-host maintainer | `mitigated` |
| R3 | The declaration file becomes a fifth registry beside the four it replaces | M | H | High | The Phase 3 PR that lands the generator deletes the four; `check-declaration.mjs` refuses a tree where both exist | Spec Architect | `open` |
| R4 | Two-axis maturity lets `stable` be claimed with one steward-owned witness | M | M | Medium | `adoption: independent` is the only place independence lives; the claim vocabulary binds "OpenWOP conformant" to `openwop-core-standard` evidence, not to `stable` | Steward | `mitigated` |
