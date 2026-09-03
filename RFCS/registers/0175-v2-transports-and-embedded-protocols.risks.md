# RFC 0175 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A peer still on A2A 0.3 / MCP 2025-06-18 after the cut cannot talk to a v2 host | M | M | Medium | The v1 tree keeps the legacy profiles and their dated sunsets through Phase 5; one dual-era advertiser exists and it is ours; a v2 host MAY keep a private legacy path unadvertised | Steward | `accepted` |
| R2 | Demoting gRPC strands a future adopter who wanted it | L | L | Low | The door back into core is named (§A.1, G3); the proto is kept as a non-normative sketch under `ext/` | Spec Architect | `accepted` |
| R3 | `negotiation.decided` leaks peer identity or content | L | H | Medium | Content-free by rule; peer origin as a digest (G4); RFC 0128 purpose label rides separately; the threat model's §5 invariant | Security Architect | `mitigated` |
| R4 | A minimum-version floor set too high refuses every peer | L | M | Low | The floor is advertised; a peer reads it before negotiating; the fail-closed refusal names it | Reference-host maintainer | `mitigated` |
