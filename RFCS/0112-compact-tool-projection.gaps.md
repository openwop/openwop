# RFC 0112 — Gap Register

| ID  | Section     | Question / Missing Input                                                       | Owner                 | Resolution Path                                          | Blocks          |
| --- | ----------- | ----------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------- | --------------- |
| G1  | Proposal    | Hard char cap on compact `description` vs SHOULD-truncate                      | Spec Architect        | Decision                                                 | Schema finalize |
| G2  | Conformance | ~~Tier-1 validator?~~ **RESOLVED (architect 2026-06-26):** Tier-1 is informative + drift-prone with no schema; compact constraint pinned as a self-contained structural subset in `compact-tool-descriptor.schema.json`, validated directly. | Conformance Architect | Done | — |
| G3  | Proposal    | Interaction of `view=compact` with paging/filter params                       | Spec Architect        | Decision; default orthogonal                             | OpenAPI finalize |
| G4  | Conformance | No host advertises `toolCatalog.compactView` yet                              | Conformance Architect | Adoption-gated; tier-2 witness suffices                  | Accepted flip   |
