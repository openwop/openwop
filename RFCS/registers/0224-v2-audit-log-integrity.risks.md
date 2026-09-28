# RFC 0224 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The new major-1 cadence leg fails a v1 host that advertises `checkpointIntervalEntries` but checkpoints less often. | L | M | Low | The leg asserts an existing major-1 MUST ("at intervals declared by the host"); the SQLite reference host is executed-pass on it; openwop-app opts out and MyndHyve does not advertise the profile. | Conformance Architect | `mitigated` — measured on the SQLite host 2026-09-28. |
| R2 | A host advertises a cadence it cannot keep under load, and a certified run catches a legitimate gap. | L | L | Low | The advertised bound IS the enforced one on the reference host (checked on every append); an operator sets the facet from the same config. | Reference Implementation Architect | `accepted` — a gap is exactly the defect the leg exists to show. |
