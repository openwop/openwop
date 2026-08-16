# RFC 0152 — Risk Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Silent downgrade exposes legacy behavior. | M | H | High | Exact profiles, authenticated negotiation, minimum-version policy. | Security Architect | Open — **Sweep 2026-08-16:** **Mitigated in suite** — `a2a-version-no-silent-downgrade` + `a2a-version-negotiation.test.ts`; host legs `blocked` (no invoke seam on any host). |
| R2 | Agent Card and runtime drift. | M | H | High | Single source and differential conformance test. | Runtime Architect | Open — **Sweep 2026-08-16:** **Mitigated in suite** — `a2a-card-runtime-consistency.test.ts` (S15, gated on `a2a.profiles ∋ a2a-1.0`). |
| R3 | Upstream 1.x changes break pinned mapping. | M | M | Medium | Version pin, refresh SLA, compatibility matrix. | Interop Maintainer | Open — **Sweep 2026-08-16:** **Mitigated** — pinned `a2a.proto@v1.0.0`; refresh SLA unwritten (RFC 0147 R10). |
| R4 | A2A identity is mistaken for OpenWOP authorization. | M | H | Critical | Boundary reauthorization and negative tests. | Security Architect | Open — **Sweep 2026-08-16:** **Mitigated in prose + suite** — `a2a-integration.md` §E; `a2a-peer-authority.test.ts` (host-blocked). |
| R5 | Real-peer CI becomes flaky. | M | M | Medium | Pinned local peer image/package; no external network dependency. | Conformance Architect | Open — **Sweep 2026-08-16:** **Not applicable yet** — no real-peer CI exists (G3). |

