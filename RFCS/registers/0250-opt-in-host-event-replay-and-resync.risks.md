# RFC0250 — Risk register

Qualitative planning judgments. David Tufts is proposed accountable sponsor; role owners need confirmation. High-risk review checkpoint 2026-10-31 is a proposed decision date, not a release promise.

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Cursor refusal reveals foreign event existence | M | H | High | Tenant/visibility-scoped lookup, uniform response, foreign-vs-unknown witness | Security Architect | 2026-10-31 review; before Active | Open |
| R2 | Retention promise conflicts with privacy deletion | M | H | High | Resolve G2 with explicit exception and no secret-bearing diagnostics | Security Architect | 2026-10-31 review; before Active | Open |
| R3 | Backlog/live handoff loses or reorders events | M | H | High | Resolve G3 with storage watermark/ordered reader and two-producer fault witness | Spec + Conformance Architects | 2026-10-31 review; before Active | Open |
| R4 | Restart test is skipped but replay claim reports pass | M | H | High | Separate observable from causable; blocked disposition without operator condition; signed evidence | Conformance Architect | 2026-10-31 review; before acceptance | Open |
| R5 | SDK loops on resync refusal or old host ignores query | M | M | Med | Advertise/opt in first, typed non-retriable error, SDK regression cases | Compatibility Architect | Before SDK rollout | Open |
