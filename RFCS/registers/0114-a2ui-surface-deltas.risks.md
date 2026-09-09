# RFC 0114 — Risk Register

Score = Likelihood × Impact (H/M/L).

| ID  | Risk                                                                                                      | Likelihood | Impact | Score | Mitigation                                                                                  | Owner                 | Status |
| --- | ------------------------------------------------------------------------------------------------------- | ---------- | ------ | ----- | ------------------------------------------------------------------------------------------- | --------------------- | ------ |
| R1  | Consumer applies a patch against a stale/missing base → divergent UI state                               | M          | M      | Med   | Deltas gated on `?a2uiDelta=1`; `surfaceRef` must resolve to a delivered full; host can always re-materialize full on any ambiguity (recorded surface is full) | Spec Architect        | Mitigated |
| R2  | **A delta opens the closed tree / injects an out-of-catalog component → bypasses `a2ui-surface-no-code-exec`** | L | H | High | **Normative (architect 2026-06-26):** consumer MUST re-validate the post-patch surface against the closed catalog (same fail-closed as a full); SR-1 walks patch `value`s; all A2UI invariants hold post-patch; conformance asserts an out-of-catalog delta is rejected | Security Architect | Mitigated |
| R3  | `move`/`copy`/`test` op hazards on replay/apply                                                          | L          | M      | Low   | **Resolved:** recorded surface stays FULL → replay never applies patches; transport op set excludes `test`; any apply failure forces full re-materialization | Security Architect    | Mitigated |
| R4  | Client-side reconstruction memory grows unbounded over a long-lived `surfaceId`                          | M          | L      | Low   | G2: host MAY evict + force full re-emit after N updates                                      | Spec Architect        | Open   |
