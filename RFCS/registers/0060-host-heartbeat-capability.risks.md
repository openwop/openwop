# RFC 0060 — Risk Register

Companion to [`RFCS/0060-host-heartbeat-capability.md`](../0060-host-heartbeat-capability.md). Likelihood × Impact (H/M/L).

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| R1 | `positioning.md` ships contradicting RFC 0052 + RFC 0060 (says request-driven only) — a credibility/consistency gap for readers. | M | M | Med | The bounded-exception note is an acceptance criterion; land it with the RFC. (Pre-existing contradiction with RFC 0052 too.) | Spec Architect | Open |
| R2 | A host implements heartbeat non-idempotently → notification spam (the exact failure the feature targets). | M | M | Med | `heartbeat-idempotent-no-spam.test.ts` is the keystone scenario; the contract gates action on a *transition* computed against persisted prior state, not the tick. | Conformance Architect | Open |
| R3 | An over-budget predicate is left running (no enforcement) → resource exhaustion. | L | M | Low | §B.2 MUST: bound by `maxRuntimeMs` (≤ RFC 0058 `maxRunDurationMs`); `heartbeat-runtime-bound.test.ts`. | Spec Architect | Open |
| R4 | Hosts model heartbeat as a short-interval `schedule` trigger (RFC 0052) instead, recreating the spam pattern. | M | L | Low | The RFC + audit document why the trigger-pack form lacks the transition gate; the host capability is the SLA-bearing form. | Spec Architect | Open |
