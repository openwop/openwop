# RFC 0246 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A consumer reads `aggregateScore ≥ passScore` as the pass rule and disagrees with `passed`. | M | L | Low | §D: `gatedAggregateScore` is present whenever the two can disagree; the `passed` description names the gating aggregate. | Spec Architect | `mitigated` — by design (§D). |
| R2 | A deployment gate that passed yesterday blocks a promotion today on a host that migrates. | M | M | Med | That is the fix: the promotion it blocks is one whose agent failed its trajectory. The 90-day window and the CHANGELOG `### Security` entry announce it. | Compatibility Architect | `accepted` — the stricter answer is the correct one. |
| R3 | Until both hosts migrate, the same suite passes on one host and fails on the other. | H | M | Med | The suite legs detect both behaviours; the INTEROP row shows which hosts certify the corrected suite. | Conformance Architect | `accepted` — the window is the migration period. |
