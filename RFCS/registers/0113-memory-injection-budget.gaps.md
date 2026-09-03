# RFC 0113 — Gap Register

| ID  | Section     | Question / Missing Input                                                      | Owner                 | Resolution Path                                   | Blocks          |
| --- | ----------- | ---------------------------------------------------------------------------- | --------------------- | ------------------------------------------------- | --------------- |
| G1 | Proposal | `tokenBudget` unit — reuse RFC 0111 `tokenCounter` enum vs host-defined | Spec Architect | `carried:openwop.gap.0113.1` Decision; prefer reuse for cross-RFC consistency | Schema finalize |
| G2 | Conformance | Portable test for `relevance` ranking when every host's retriever differs | Conformance Architect | `carried:openwop.gap.0113.2` Assert "differs from recency" on a crafted fixture, not absolute order | Scenario impl |
| G3 | Security | Ranking side-channel: could relevance scoring over redacted content leak bits? | Security Architect | `carried:openwop.gap.0113.3` Normative: rank over redacted form; threat-model note | Active→Accepted |
| G4 | Conformance | No host advertises `memory.injectionBudget` yet | Conformance Architect | `carried:openwop.gap.0113.4` Adoption-gated; tier-2 witness suffices | Accepted flip |
