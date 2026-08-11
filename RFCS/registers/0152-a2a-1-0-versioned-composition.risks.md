# RFC 0152 — Risk Register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Silent downgrade exposes legacy behavior. | M | H | High | Exact profiles, authenticated negotiation, minimum-version policy. | Security Architect | Open |
| R2 | Agent Card and runtime drift. | M | H | High | Single source and differential conformance test. | Runtime Architect | Open |
| R3 | Upstream 1.x changes break pinned mapping. | M | M | Medium | Version pin, refresh SLA, compatibility matrix. | Interop Maintainer | Open |
| R4 | A2A identity is mistaken for OpenWOP authorization. | M | H | Critical | Boundary reauthorization and negative tests. | Security Architect | Open |
| R5 | Real-peer CI becomes flaky. | M | M | Medium | Pinned local peer image/package; no external network dependency. | Conformance Architect | Open |

