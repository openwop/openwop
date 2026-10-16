# RFC 0247 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §Falsifiability | No suite leg observes a bounded close: it needs an opted-in stream held open on a live run past the advertised age, longer than the suite's stream waits budget for. | Conformance Architect | `transferred:TODO.md` 2026-10-15 (the RFC 0247 line) — decide whether a gated, operator-opt-in long-hold leg is worth its run time. | none (no row claimed) |
| G2 | UQ 2 | A host behind a short front end closes sooner on that hop than its advertised `maxStreamAgeSec`; a consumer cannot learn the hop's bound. | Spec Architect | `transferred:TODO.md` 2026-10-15 (the RFC 0247 line) — revisit if a consumer needs it; "at most the advertised age" is the current rule. | — |
