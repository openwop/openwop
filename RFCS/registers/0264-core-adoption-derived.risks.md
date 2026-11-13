# RFC 0264 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The gate signal over-counts: a scenario that names a family key without testing its rules makes a host a "witness". | M | M | Med | §A.3 needs an executed-pass row of a gating scenario AND no executed-fail; `V2-WITNESS-COVERAGE.md` already states the signal is necessary, not sufficient. Adoption reports presence of evidence, not completeness. | Conformance Architect | at `Active` | `accepted` 2026-11-13 — the axis is a count, not a certification. |
| R2 | `keep` rows are renewed by rote, so the review never bites. | M | L | Low | §B.3 refuses a date-only renewal; the reason or plan must change, which is visible in review. | Spec Architect | at `Active` | `mitigated` 2026-11-13 |
| R3 | Every bundle re-cut moves adoption values and churns the packed schema descriptions. | M | L | Low | Changes reach npm only with a suite release; the value moves only when a host's witness status changes, not on every cut. | Conformance Architect | at `Active` | `accepted` 2026-11-13 |
