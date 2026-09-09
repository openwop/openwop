# RFC 0176 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A missing codemap row makes an era-`2` run unreadable on a v2 host | M | H | High | The corpus gate over `event-type-codemap` fails on any v1 registry type without a decided row; `unmapped-type-refused` proves the failure is loud; the reserved-prefix exemption covers vendor types | Conformance Architect | `mitigated` |
| R2 | A host installs the adapter at a wrapper and forks read raw v1 rows | M | H | High | `v1-events-translated` reads through poll, SSE and a fork; the seat is named in the host ADR | Reference-host maintainer | `open` |
| R3 | Cancelling inherited pinned runs surprises operators | M | M | Medium | Named reason, `cancelledBy: v2-cutover`, a counted bundle field, the runbook section in `spec/v2/core/persistence.md` | Steward | `mitigated` |
| R4 | `schemas/v2/` ships into a v1 image through an unpinned sync | M | H | High | §E.1 MUST; G3 tracks the two unpinned consumers and the registry | Steward | `open` |
