# RFC 0075 — Gap Register

| ID | Section | Question / Item | Owner | Resolution Path | Blocks |
|---|---|---|---|---|---|
| G1 | P0-2 | Should `validation: "closed"` ever be *required* for a cross-host-contract type, or is advisory-only sufficient? | Spec Architect | Maintainer decision; current = advisory, default `open` | — (acceptable as-is) |
| G2 | P2-1 | Reference-host choice for the store-only posture (SQLite host vs. a dedicated `render:false` conformance harness). | Conformance Architect | Implement on the SQLite reference host; follow-on PR | Store-without-render end-to-end coverage |
| G3 | P1-3 | MyndHyve must serve its 7 host-native schema URLs (`$id` injection + `/schemas/artifacts/:id` route) + advertise `validation:"open"` for `registered:true` to be downstream-verifiable. | MyndHyve | Host-side, unblocked by P0-2; MyndHyve committed to sequence it post-merge | Phase-1 `registered:true` verifiability close-out |
| G4 | Process | RFC renumber risk: 0075 reserved off origin/main@0074; a parallel session could claim it (as 0070/0072 did). | Implementer | Renumber if collided at merge time | — |
