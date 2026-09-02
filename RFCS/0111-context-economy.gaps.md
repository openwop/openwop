# RFC 0111 — Gap Register

| ID  | Section     | Question / Missing Input                                                                                  | Owner                 | Resolution Path                                                                 | Blocks            |
| --- | ----------- | -------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------- | ----------------- |
| G1 | Proposal | `tokenCounter` enum vs provider-native tokenizers — does a portable enum diverge too far from real cost? | Spec Architect | `open` Decision; default to portable enum, allow `host-defined` escape hatch | Schema finalize |
| G2 | Conformance | Transcript seam: host-sample-only seam vs a normative read endpoint | Conformance Architect | `open` Decision; drafted as host-sample seam to avoid a new normative REST surface | Active→Accepted |
| G3 | Proposal | Replay determinism of host summaries — must `summaryRef` artifact be byte-stable across replays? | Security/Spec | `open` Tie to RFC 0041 §replay; summary recorded in event log, replay reads the artifact | Accepted |
| G4 | Proposal | Verbatim floor unit: `keepLastTurns` (count) vs `keepLastTokens` (tokens) | Spec Architect | `open` Decision needed before reference-host impl | Reference host |
| G5 | Conformance | No non-steward host advertises `contextBudget` yet | Conformance Architect | `open` Adoption-gated; tier-2 witness suffices per GOVERNANCE bootstrap waiver | Accepted flip |
