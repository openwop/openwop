# RFC 0110: Channel presence (online + typing)

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0110                                                            |
| **Title**         | Channel presence (online + typing)                              |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-06-24                                                      |
| **Updated**       | 2026-06-24 — `Draft → Accepted` via the `/prd` five-architect pass; the additive 7-day comment window waived by single-maintainer steward authority (bootstrap-phase, `CONTRIBUTING.md` §"RFC comment-window waivers" / `GOVERNANCE.md` lazy consensus) — zero external reviewers. Acceptance work landed: the `channel.presence` RunEventType + `channel-presence-payload.schema.json` (closed, no-PII); `capabilities.schema.json` `channelPresence`; the type-index + schema-README + suite-count bookkeeping; the server-free shape conformance scenario; CHANGELOG. **Reference-host emit DEFERRED** (per the acceptance-criteria option) — openwop-app channels are fetch-based (no per-channel SSE transport) and multi-instance Cloud Run cannot hold global in-memory presence on its DB budget; a single-instance / sticky-session deployment is the natural first emitter. The wire surface is frozen + conformance-covered, ready for any host. |
| **Affects**       | `schemas/conversation-event.schema.json` (new `channel.presence` payload), `schemas/run-event.schema.json` (`type` value), `schemas/capabilities.schema.json` (`channelPresence`), `capabilities.md`, `replay.md` (ephemeral-event note), `stream-modes.md` (delivery mode); 1 capability-gated conformance scenario |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.2                          |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Add an OPTIONAL, capability-gated `channel.presence` event so a host MAY publish, for a
`type:'channel'` conversation (RFC 0005 / the channels feature), the set of currently-
present member subject refs and an optional per-member typing flag. Presence is
**ephemeral live state** — membership-gated, never persisted to the replayable event log,
and replay/fork-invisible — which is the load-bearing distinction from `conversation.*`
turns. It is the channel analogue of RFC 0101's per-turn attribution, scoped to live
presence rather than the transcript.

## Motivation

The channels feature (openwop-app ADR 0126) shipped a functional local-host v1 —
membership-gated post/read over a `type:'channel'` conversation — but deliberately
deferred presence ("who is online", "X is typing") because those are **real-time,
cross-host-projectable facts**: a peer host rendering a shared channel must read presence
the same way everywhere, so it cannot be host-internal UI state. There is no wire surface
today to advertise or carry channel presence, and `/architect` NO-GO's adding it as
host-only work (it needs a new event + capability on the normative wire). This RFC opens
that surface, tightly: one optional event + one capability, additive, MAY-emit, with the
ephemerality rule stated up front so presence can never corrupt replay.

## Proposal

### Capability — `capabilities.schema.json`

```diff
+    "channelPresence": {
+      "type": "object",
+      "required": ["supported"],
+      "additionalProperties": false,
+      "description": "RFC 0110. Host publishes ephemeral channel presence (online + optional typing) via the `channel.presence` event. Advertise `supported: true` ONLY if the host actually emits it (OPENWOP_REQUIRE_BEHAVIOR honesty).",
+      "properties": { "supported": { "type": "boolean" } }
+    }
```

### Event — new `channel.presence` (`run-event.schema.json` `type` + `conversation-event.schema.json` payload)

```diff
 "oneOf": [
   { /* conversation.opened   */ },
   { /* conversation.exchanged */ },
-  { /* conversation.closed   */ }
+  { /* conversation.closed   */ },
+  {
+    "type": "object",
+    "description": "channel.presence — EPHEMERAL live presence for a channel. NOT persisted to the replayable event log (see Replay). Membership-gated.",
+    "required": ["conversationId", "present"],
+    "additionalProperties": false,
+    "properties": {
+      "conversationId": { "type": "string", "minLength": 1, "maxLength": 256, "description": "The channel conversation this presence is for." },
+      "present": {
+        "type": "array",
+        "description": "Subject refs (RFC 0041 vocabulary `user:<id>` / `agent:<id>` — opaque, non-PII) of members CURRENTLY present. MUST be a subset of the channel's current participants.",
+        "items": { "type": "string", "minLength": 1, "maxLength": 256 }
+      },
+      "typing": {
+        "type": "array",
+        "description": "OPTIONAL subset of `present` that is currently typing. Boolean-by-presence (a ref appears iff typing).",
+        "items": { "type": "string", "minLength": 1, "maxLength": 256 }
+      }
+    }
+  }
 ]
```

### Normative prose (new spec section / RFC 0005 addendum)

- A host MAY emit `channel.presence` for a `type:'channel'` conversation. A host that does
  MUST advertise `channelPresence.supported: true`; a host that advertises it MUST emit it
  (the honesty rule).
- Every ref in `present` (and `typing`) MUST be a CURRENT participant of the channel; a
  non-member MUST NOT appear.
- A host MUST NOT deliver `channel.presence` to a non-member of the channel — the SAME
  DEFAULT-DENY visibility as the channel's messages (a private channel's presence reaches
  only its participants; cross-tenant delivery is forbidden — CTI-1).
- `channel.presence` is EPHEMERAL live state: a host MUST NOT write it to the replayable
  event log / transcript, and it MUST NOT affect replay or `:fork` determinism (a fork of
  a channel run does NOT replay stale presence). It is the live-state counterpart to the
  persisted `conversation.exchanged` turn.
- `typing` is a membership-only boolean signal; a host MUST NOT include any payload beyond
  the subject refs (no IP, location, device, or free text).
- A client MAY render presence; a client MUST tolerate its absence.
- A host SHOULD debounce/coalesce presence (churn is high) to bound event volume.

### Delivery & version axes

Presence rides the EXISTING SSE run-event feed (`stream-modes.md`) — no new transport. It
is a per-event addition; it touches no engine or per-run version axis (an old client that
doesn't know the type ignores it, per forward-compat).

### Examples

Positive:

```json
{ "type": "channel.presence", "payload": { "conversationId": "chan-eng", "present": ["user:alice", "agent:iris"], "typing": ["user:alice"] } }
```

Negative (rejected — a non-subject-ref payload field):

```json
{ "type": "channel.presence", "payload": { "conversationId": "c", "present": ["user:a"], "ip": "10.0.0.1" } }
```

`additionalProperties: false` rejects `ip` (and any non-listed field) — the schema guard
behind the no-PII rule.

## Compatibility

**Additive.** A new OPTIONAL capability + a new OPTIONAL event `type`; no existing event
shape changes, no required→optional, no relaxed MUST. Forward-compat: a client that
doesn't recognize `channel.presence` ignores it (per `COMPATIBILITY.md` §2.1 unknown-event
tolerance); a host that doesn't emit it is unaffected; the capability is absent-by-default.
No migration tooling.

## Conformance

- **Existing coverage:** the conversation-event / multi-party (RFC 0101) scenarios cover
  channel turn shape; this adds one capability-gated presence scenario.
- **New scenario** (`channel-presence.test.ts`): gated on `channelPresence.supported`. When
  advertised, a `channel.presence` event MUST list only current channel members, MUST NOT
  include a non-member or any non-subject-ref field, and (a behavioral check) MUST NOT be
  delivered to a non-member. Non-advertising hosts are not exercised.

## Alternatives considered

1. **Do nothing (host-internal presence, no wire).** ADR 0126's local-host v1. Rejected:
   presence is cross-host-projectable; a peer host can't read host-internal state, so a
   shared channel can't show consistent presence.
2. **A persisted presence event (in the event log).** Rejected: presence is high-churn live
   state; persisting it would bloat the log and corrupt the replay invariant (a fork would
   replay stale "online" status). The ephemerality rule is the whole point.
3. **A separate presence transport / WebSocket.** Rejected: presence rides the existing SSE
   run-event feed — no second transport, no second auth surface.

## Unresolved questions

1. Is `present` a full snapshot per event, or a delta (join/leave)? Snapshot proposed
   (simpler, idempotent); revisit if event volume warrants deltas (with debounce, snapshot
   is fine for v1).
2. Should `typing` be a separate event (`channel.typing`) vs a field on `channel.presence`?
   Folded here (one event, less churn); split is an additive follow-on if needed.
3. A presence TTL / heartbeat cadence convention — left to the host (debounce SHOULD); a
   normative cadence is deferred.

## Implementation notes (non-normative)

Host work once Accepted: emit a debounced `channel.presence` snapshot on the channel's SSE
feed when membership/typing changes, scoped to the channel's participants (reuse the ADR
0126 membership gate). No new storage (presence is in-memory live state). The client
renders an avatar stack + a typing indicator.

## Acceptance criteria

- [x] Spec text (presence section) merged — this RFC + the `channel-presence-payload` schema descriptions
- [x] `run-event.schema.json` adds the `channel.presence` type + `channel-presence-payload.schema.json` (`additionalProperties:false`); registered in `run-event-payloads.schema.json` type-index + `schemas/README.md`
- [x] `capabilities.schema.json` adds `channelPresence` (closed, `supported`)
- [x] ≥1 server-free conformance scenario — `channel-presence-shape.test.ts` (conforming / required / closed-no-PII / typing-optional / enum-membership / capability)
- [x] CHANGELOG `[Unreleased] > Added`
- [ ] Reference host emits debounced presence — **DEFERRED** (the acceptance-criteria option): openwop-app channels are fetch-based (no per-channel SSE transport) + multi-instance presence needs shared live state the demo's DB budget can't hold; a single-instance / sticky-session deployment is the natural first emitter. The wire is frozen + conformance-covered.

## References

- ADR 0126 (team channels — the dependent host feature, openwop-app)
- RFC 0005 (conversation primitive), RFC 0101 (multi-party conversation / presence precedent), RFC 0041 vocabulary (`user:`/`agent:` subject refs)
- `schemas/conversation-event.schema.json`, `schemas/capabilities.schema.json`, `replay.md` (ephemeral vs persisted), `stream-modes.md` (SSE), `SECURITY/invariants.yaml` (CTI-1 / secret-leakage)
- Prior art: Open WebUI Channels presence/typing; Slack/Discord presence + typing indicators
