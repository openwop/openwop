# RFC 0116 — Gap Register

This RFC is `Draft`; its gaps are load-bearing, not residual. Several are escalated to Risks.

| ID  | Section     | Question / Missing Input                                                                 | Owner               | Resolution Path                                                        | Blocks            |
| --- | ----------- | --------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------- | ----------------- |
| G1 | Proposal | Portable `cachePrefixId` semantics across heterogeneous providers | Spec Architect | `carried:openwop.gap.0116.1` Comment window; may conclude host-/provider-specific only | Draft→Active |
| G2 | Security | Normative cache-key construction (`tenant ⊕ cachePrefixId`) vs trust host scoping | Security Architect | `carried:openwop.gap.0116.2` Threat-model pass per provider-policy + secret-leakage; likely MUST | Draft→Active (R1) |
| G3 | Proposal | Replay invariance enforceability — can provider cache state change outputs? | Security/Spec | `carried:openwop.gap.0116.3` RFC 0041 analysis; pilot on a real provider | Active (R2) |
| G4 | Conformance | Any observable, non-vacuous wire signal for a cache hit? | Conformance Architect | `carried:openwop.gap.0116.4` Investigate; else graduate on host-attested benchmark (needs maintainer precedent decision) | Accepted |
| G5 | Proposal | Ship general prefix field vs RFC 0112 tool-surface-only fallback | Spec Architect | `carried:openwop.gap.0116.5` Decision after G1–G3 | Draft→Active |
| G6 | Security | External-audit re-review of a new provider-cache surface | Security Architect | `carried:openwop.gap.0116.6` Per `SECURITY/external-audit-engagement.md` | Accepted |
