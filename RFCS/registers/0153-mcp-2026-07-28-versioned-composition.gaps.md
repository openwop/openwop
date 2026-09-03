# RFC 0153 — Gap Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | Compatibility | Legacy adopter inventory is missing. | Interop Maintainer | `carried:openwop.gap.0153.1` Survey matrix, host discovery, and downstream issues. | Active — **Sweep 2026-08-16:** **Measured** — one dual-revision advertiser (openwop-app); no reference host advertises `mcp.protocolVersions`; suite server serves both revisions, header-less = legacy. Legacy `mcp-2025-06-18-legacy` named + time-bounded. |
| G2 | §C | ~~Complete MRTR mapping is not authored.~~ **Closed 2026-08-16:** `mcp-integration.md` §C, C.1 (client) + C.2 (server), traced against run identity (RFC 0150 §B), interrupts (RFC 0051), cancel (RFC 0094), replay (RFC 0150 discharge). Bound on rounds left to host policy (new G9). | Spec Architect | `closed` Trace MRTR lifecycle against run/interrupt/cancel/replay. | ~~Active~~ Closed |
| G3 | Conformance | Real current MCP peer is not selected. | Conformance Architect | `externally-gated:unspecified` Evaluate official implementation for pinned local CI. | Active — **Sweep 2026-08-16:** **Carried, externally gated** — no real current peer selected. |
| G4 | §D | ~~Authorization-aware cache validator rules are undecided.~~ **Closed 2026-08-16:** `mcp-integration.md` §D — scope change ⇒ stale regardless of `ttlMs`; `"private"` never crosses authorization contexts; key = (tenant, workspace, principal, origin, revision, discovery context). | Security Architect | `closed` Threat-model principal/tenant/scope changes. | ~~Active~~ Closed |
| G5 | §D | Initial mapped extension set is unset. | Spec Architect | `closed` Default to opaque; promote only evidenced needs. | Accepted — **Sweep 2026-08-16:** **Closed** — `mcp-integration.md` §D: opaque by default, mapping registry empty until evidenced need (`mcp-extension-opacity.test.ts`). |

