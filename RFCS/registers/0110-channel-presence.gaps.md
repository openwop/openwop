# RFC 0110 — Gap register

Open questions, deferred decisions, and missing inputs beyond the in-RFC Unresolved questions. Each gap has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
|---|---|---|---|---|---|
| G1 | Proposal | Snapshot vs delta for `present` (RFC Unresolved Q1)? | Spec Architect | `carried:openwop.gap.0110.1` Snapshot recommended (idempotent + debounced); promote to deltas additively if volume warrants. | Schema freeze → Active |
| G2 | Proposal | `typing` folded into `channel.presence` vs a separate `channel.typing` event (Q2)? | Spec Architect | `carried:openwop.gap.0110.2` Folded recommended (one event, less churn); split is an additive follow-on. | Active |
| G3 | Delivery | Presence TTL / heartbeat cadence — normative or host-chosen? | Spec Architect | `carried:openwop.gap.0110.3` Host-chosen with a `SHOULD debounce`; a normative cadence is deferred to a follow-on. | Active |
| G4 | Conformance | The "not delivered to a non-member" assertion needs a two-subject test seam (a member + a non-member subscriber). | Conformance Architect | `carried:openwop.gap.0110.4` Reuse the channels membership fixture (member + non-member); assert the non-member's SSE stream omits the presence event. | Accepted (scenario) |
| G5 | Security | Does presence (online/typing of a `user:` ref) constitute a privacy signal warranting a higher invariant severity than `low`? | Security Architect | `carried:openwop.gap.0110.5` Confirm against `secret-leakage.md`; opaque refs + membership-gating → `low/medium` (no PII, no location). | Active (invariant text) |
| G6 | INTEROP-MATRIX | Which host beyond openwop-app dual-witnesses `channelPresence`? | Compatibility Architect | `carried:openwop.gap.0110.6` Survey INTEROP-MATRIX; bootstrap-phase steward waiver with openwop-app as reference host if none. | Accepted (third-party gate) |
