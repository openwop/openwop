# RFC 0116 — Gap Register

This RFC is `Draft`; its gaps are load-bearing, not residual. Several are escalated to Risks.

| ID  | Section     | Question / Missing Input                                                                 | Owner               | Resolution Path                                                        | Blocks            |
| --- | ----------- | --------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------- | ----------------- |
| G1  | Proposal    | Portable `cachePrefixId` semantics across heterogeneous providers                       | Spec Architect      | Comment window; may conclude host-/provider-specific only             | Draft→Active      |
| G2  | Security    | Normative cache-key construction (`tenant ⊕ cachePrefixId`) vs trust host scoping        | Security Architect  | Threat-model pass per provider-policy + secret-leakage; likely MUST    | Draft→Active (R1) |
| G3  | Proposal    | Replay invariance enforceability — can provider cache state change outputs?              | Security/Spec       | RFC 0041 analysis; pilot on a real provider                           | Active (R2)       |
| G4  | Conformance | Any observable, non-vacuous wire signal for a cache hit?                                 | Conformance Architect | Investigate; else graduate on host-attested benchmark (needs maintainer precedent decision) | Accepted          |
| G5  | Proposal    | Ship general prefix field vs RFC 0112 tool-surface-only fallback                         | Spec Architect      | Decision after G1–G3                                                  | Draft→Active      |
| G6  | Security    | External-audit re-review of a new provider-cache surface                                 | Security Architect  | Per `SECURITY/external-audit-engagement.md`                          | Accepted          |
