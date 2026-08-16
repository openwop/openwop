# RFC 0153 — Risk Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Silent downgrade re-enables weaker legacy auth/session behavior. | M | H | Critical | Exact profiles, minimum-version policy, audit, fail closed. | Security Architect | Open — **Sweep 2026-08-16:** **Mitigated in suite** — `mcp-version-no-silent-downgrade` + `mcp-version-negotiation.test.ts`; host legs `blocked` on current hosts. |
| R2 | MRTR work duplicates after timeout/retry. | M | H | High | RFC 0150 stable identity and recorded outcomes. | Runtime Architect | Open — **Sweep 2026-08-16:** **Mitigated in prose + suite** — MRTR mapping traced against RFC 0150 identity; `mcp-mrtr-roundtrip.test.ts` (client half host-blocked, server half gated). |
| R3 | Cache crosses tenant or authorization scope. | M | H | Critical | Scoped key, validator invalidation, adversarial tests. | Security Architect | Open — **Sweep 2026-08-16:** **Mitigated in prose + suite** — §D scoped key; `mcp-cache-tenant-scope.test.ts` (gated). |
| R4 | Extension metadata grants unintended authority. | M | H | High | Opaque-by-default and explicit mapping registry. | Security Architect | Open — **Sweep 2026-08-16:** **Mitigated** — opaque-by-default (G5) + `mcp-extension-opacity.test.ts`. |
| R5 | Upstream protocol changes again. | M | M | Medium | Exact version profiles and scheduled refresh policy. | Interop Maintainer | Open — **Sweep 2026-08-16:** **Mitigated** — exact revision profiles; refresh policy unwritten (RFC 0147 R10). |

