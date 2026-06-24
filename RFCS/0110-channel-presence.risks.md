# RFC 0110 — Risk register

Likelihood × Impact (H/M/L). Critical/High risks require a named mitigation owner + target date.

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| R1 | Presence leaks to a non-member of a private channel (cross-tenant or cross-channel). | L | H | Med | DEFAULT-DENY membership gate on delivery (same as channel messages); CTI-1 invariant + the conformance "non-member not delivered" assertion. | Security Architect | Open |
| R2 | A host persists `channel.presence` to the event log → replay shows stale "online" + log bloat. | M | M | Med | Explicit MUST-NOT-persist + replay-invisible rule (replay.md note); the ephemerality is the load-bearing distinction from `conversation.exchanged`. | Spec Architect | Open |
| R3 | Presence churn floods the SSE feed. | M | M | Med | `SHOULD debounce/coalesce`; snapshot-per-event (idempotent); host-side rate guidance. | Spec Architect | Open |
| R4 | A naive host puts PII (IP/location/device) in the presence payload. | L | M | Low | `additionalProperties:false` + subject-refs-only; the no-PII MUST-NOT + the conformance no-extra-field assertion. | Security Architect | Open |
| R5 | Capability advertised but not honored → dishonest wire claim. | L | M | Low | Capability-gated scenario asserts emission when advertised; non-advertising hosts skipped. | Conformance Architect | Open |
| R6 | Old clients break on the unknown `channel.presence` event type. | L | M | Low | COMPATIBILITY §2.1 unknown-event tolerance (clients ignore unknown types); additive classification. | Compatibility Architect | Open |
