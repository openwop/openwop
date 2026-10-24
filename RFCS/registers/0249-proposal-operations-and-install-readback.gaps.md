# RFC 0249 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Conformance | No host implements the seven operations. openwop-app does not advertise `agents.proposals`; MyndHyve advertises it at v1 only. openwop-app builds phase 1 (ADR 0970, user-directed 2026-10-24). | Conformance Architect | `externally-gated:a certified major-2 bundle with the 0249.* host legs executed-pass` | `Accepted` |
| G2 | §D phase 2 | `workflow-chain-pack` and `agent-pack` have no v2 operation that serves the installed bytes: `getWorkflow` serves one workflow, `getAgent` an inventory entry. | Schema Architect | `transferred:TODO.md` 2026-10-24 (the RFC 0249 line) — audit both, then either name the operation in §D or file a follow-up RFC for a pack read. | none (phase 2) |
| G3 | §E | The replay-fork rule has no portable trigger: the suite cannot make a host synthesize a proposal from a run it controls. | Conformance Architect | `transferred:TODO.md` 2026-10-24 (the RFC 0249 line) — witness when a host offers a fixture whose run synthesizes a proposal, the RFC 0248 fixture pattern. | none |
| G4 | §D phase 3 | `automation` (RFC 0052 job) has no v2 read surface at all. | Spec Architect | `transferred:TODO.md` 2026-10-24 (the RFC 0249 line) — disclosed per kind in the facet until a schedules read surface exists. | none |
| G5 | UQ 1–5 | Submit scope, approval-gate shape, `readback` vs implied, the terminal-state error code, and the complete host-owned field set for `prompt-template`. | Spec Architect | `closed` 2026-10-24 — resolved by `/architect` at the `Active` flip (RFC §Unresolved questions). | — |
