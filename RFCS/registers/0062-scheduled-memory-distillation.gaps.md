# RFC 0062 — Gap Register

Companion to [`RFCS/0062-scheduled-memory-distillation.md`](../0062-scheduled-memory-distillation.md). Verdict from the reconciliation audit: **reframed** — reuse `memory.compacted` (+ additive `distillation` sub-object) instead of a new `memory.distilled` event; `trigger` stays `host-managed` (the RFC 0012 enum is closed); register `token_budget_exceeded`.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
|---|---|---|---|---|---|
| G1 | §B.6 | **Reframe applied:** event is `memory.compacted` + optional `distillation` sub-object, NOT a new `memory.distilled`. `trigger` = `host-managed` (0012's closed enum). Confirm RFC 0012 author accepts the additive sub-object. | Spec Architect | Confirm with RFC 0012 / Compatibility maintainer. | Active |
| G2 | §B.2 | **`token_budget_exceeded` is NOT in `rest-endpoints.md`** (present in SDK error vocab only). Must register it at implementation. | Spec Architect | Add the error-code row with the RFC's spec text. | Active |
| G3 | §B.2 / Unresolved #1 | Token-accounting authority — budget counted against advertised `tokenizerName`, best-effort-honest. Define the conformance tolerance (±%). | Spec Architect | Decision before Active. | Active |
| G4 | §B.5 / RFC 0059 | Memory-index as a workspace file (`MEMORY-INDEX.json`) — index format (JSON normative? `.md` sibling?) + path naming, jointly with RFC 0059 G3. | Spec Architect | Joint resolution with 0059. | Active |
| G5 | Impl | Gate RFC 0062 `Accepted` on RFC 0059 reaching at least a pinned workspace-file schema (the index file's home). | Implementer | Sequence after 0059 schema pins. | Accepted |
| G6 | §B | Archive retention / GC + recursive distillation (distilling prior archives) — advertise `archiveRetention`; recursive re-checks SR-1. | Spec Architect | Decision before Active. | Active |
