# RFC 0245 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §Falsifiability | "The agent receives the entry as a tool error" cannot be caused from outside: the scripted conformance agent's results are scripted, so what it saw and which branch it took are not observable. | Conformance Architect | `transferred:TODO.md` 2026-10-15 (the RFC 0245 line) — the same gap as RFC 0244 G2 (no suite-owned tool or agent that exposes what it received); closes with it. | none (seam-gated row) |
| G2 | UQ 1 | No registered error code for a failed tool execution, so a portable suite cannot assert `error.code`. | Spec Architect | `transferred:TODO.md` 2026-10-15 (the RFC 0245 line) — decide at `Active` whether to register one in `spec/v2/errors.json`. | — |
| G3 | UQ 2 | For a host-native (non-MCP) tool, the agent-facing error shape is host-defined. | Spec Architect | `transferred:TODO.md` 2026-10-15 (the RFC 0245 line) — decide at `Active`. | — |
