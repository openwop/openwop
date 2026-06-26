# RFC 0113 — Risk Register

Score = Likelihood × Impact (H/M/L).

| ID  | Risk                                                                                                       | Likelihood | Impact | Score | Mitigation                                                                              | Owner                 | Status |
| --- | -------------------------------------------------------------------------------------------------------- | ---------- | ------ | ----- | --------------------------------------------------------------------------------------- | --------------------- | ------ |
| R1  | A naïve host computes relevance over un-redacted memory, leaking secret presence via ranking order        | L          | M      | Low   | **By construction (architect 2026-06-26):** SR-1 redacts at WRITE time, so `list` only ever surfaces `[REDACTED:..]`; ranking can't see plaintext. Relevance delegates to `memory.search`, not a new engine. Conformance re-asserts SR-1 on the budgeted path as a cheap regression guard. | Security Architect    | Mitigated |
| R2  | Budgeted read silently drops the one relevant memory → agent forgets a key fact                            | M          | M      | Med   | Non-normative guidance: pin pinned/`tag`-flagged entries above the budget cut            | Spec Architect        | Open   |
| R3  | `relevance` ranking unverifiable across hosts → scenario becomes tautological                              | M          | M      | Med   | Gate `relevance` on `ranking` advertisement; assert only ordering-differs, document limit | Conformance Architect | Open   |
| R4  | Cross-RFC unit drift (0111 vs 0113 token counters disagree) → composed budgets are inconsistent            | M          | L      | Low   | G1 resolution: reuse one `tokenCounter` enum across the set                              | Spec Architect        | Open   |
