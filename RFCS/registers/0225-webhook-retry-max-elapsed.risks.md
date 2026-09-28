# RFC 0225 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host advertises a `maxElapsedMs` shorter than its real schedule, and its dead-letter row fails. | M | L | Low | The bound is the host's own claim; the fix is to advertise the true total. The 30 s grace absorbs delivery latency. | Conformance Architect | `accepted` — a false advertisement is the host's defect, and the row reports it. |
