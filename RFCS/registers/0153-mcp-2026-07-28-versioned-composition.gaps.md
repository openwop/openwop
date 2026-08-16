# RFC 0153 — Gap Register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | Compatibility | Legacy adopter inventory is missing. | Interop Maintainer | Survey matrix, host discovery, and downstream issues. | Active |
| G2 | §C | ~~Complete MRTR mapping is not authored.~~ **Closed 2026-08-16:** `mcp-integration.md` §C, C.1 (client) + C.2 (server), traced against run identity (RFC 0150 §B), interrupts (RFC 0051), cancel (RFC 0094), replay (RFC 0150 discharge). Bound on rounds left to host policy (new G9). | Spec Architect | Trace MRTR lifecycle against run/interrupt/cancel/replay. | ~~Active~~ Closed |
| G3 | Conformance | Real current MCP peer is not selected. | Conformance Architect | Evaluate official implementation for pinned local CI. | Active |
| G4 | §D | ~~Authorization-aware cache validator rules are undecided.~~ **Closed 2026-08-16:** `mcp-integration.md` §D — scope change ⇒ stale regardless of `ttlMs`; `"private"` never crosses authorization contexts; key = (tenant, workspace, principal, origin, revision, discovery context). | Security Architect | Threat-model principal/tenant/scope changes. | ~~Active~~ Closed |
| G5 | §D | Initial mapped extension set is unset. | Spec Architect | Default to opaque; promote only evidenced needs. | Accepted |

