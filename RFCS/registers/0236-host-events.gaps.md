# RFC 0236 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §G, §A–§E | The v2 reference host serves `/host/events` and durable webhooks but no host-event envelope, tenant gate on the stream, emit seam or webhook host body. | Reference Implementation Architect | `externally-gated:v2-reference-host-events` openwop-examples implements §A–§G and advertises an `example.*` durable and ephemeral type, then re-cuts. | A reference-host certification on the suite that ships the legs. |
| G2 | §Conformance | No host bundle records the six `openwop.requirement.0236.*` ids, because the legs are not written yet. | Conformance Architect | `carried:openwop.gap.0236.2` The legs ship with the `Active` change; a certified major-2 bundle closes this. | `Accepted` |
| G3 | §B | The two heartbeat messages keep their bare shape on the `hostEvents` channel and are not §A envelopes; `heartbeat.stateChanged` also breaks the `events.md` §Naming grammar. | Spec Architect | `externally-gated:next-major` Wrap them in the §A envelope and rename at the next major; wrapping now breaks every heartbeat consumer. | — |
| G4 | §F | `channel.presence` stays in the v2 run-event union, deprecated. | Spec Architect | `externally-gated:next-major` Remove it from the union at the next major. | — |
| G5 | Motivation | openwop-app delivers runless host events to major-2 webhooks under a pseudo `runId` and three-segment type names. | Reference Implementation Architect | `externally-gated:openwop-app-adr-0812` The host renames its types, advertises `hostEvents` and moves to the host body (its ADR). | Tier-2 evidence only. |
