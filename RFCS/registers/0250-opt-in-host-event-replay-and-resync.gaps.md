# RFC 0250 — Gap register

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | A/C | Facet/query/error names and status | Spec + Schema Architects | `closed` 2026-10-24 — `/architect` at the `Active` flip: `hostEvents.replay {minRetentionSeconds}`, `replay=required`, `409 host_event_resync_required` (RFC §Unresolved questions 1). | — |
| G2 | A/D | Retention and lawful deletion/revocation exceptions | Security Architect | `closed` 2026-10-24 — §D: removals only narrow a view; a removed cursor is refused as in §C. | — |
| G3 | B | Stable replay order and atomic live handoff | Spec + Conformance Architects | `closed` 2026-10-24 — §B: commit order, internal, observed through sequential emits; `0250.resume-backlog` checks the handoff with a live marker. | — |
| G4 | Conformance | Causable restart/trim/oversize tests without public backdoor | Conformance Architect | `closed` 2026-10-24 — no separate rows: a loss inside the window breaks §B wherever it happens; the RFC 0241 trigger causes every observable row, and no seam is added. | — |
| G5 | E | SDK owners/minors and application baseline reconciliation | Compatibility Architect | `transferred:TODO.md` 2026-10-24 (the RFC 0250 line) — openwop-sdks exposes the opt-in and a non-retrying resync. | `Accepted` checklist item |
| G6 | Conformance | No host advertises `hostEvents.replay`. | Conformance Architect | `externally-gated:a certified major-2 bundle with the 0250.* host legs executed-pass` — openwop-app implements it (EVENT-01). | `Accepted` |
