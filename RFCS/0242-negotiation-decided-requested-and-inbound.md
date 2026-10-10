# RFC 0242: a negotiation record says what was asked for, and an inbound negotiation has a home

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0242                                                            |
| **Title**         | a negotiation record says what was asked for, and an inbound negotiation has a home |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-10                                                      |
| **Updated**       | 2026-10-10 — filed `Draft` after an `/architect` design review (2026-10-10) of two defects openwop-app found implementing `negotiation.decided` (its ADR 0858 P4): the event cannot record a downgrade, and an inbound negotiation has no log to land on. |
| **Affects**       | `schemas/v2/run-event-payloads.schema.json` `$defs/negotiationDecided` (one optional property; seeded, so its seed rule in `scripts/derive-v2-schemas.mjs`) · `schemas/v2/host-event.schema.json` (one reserved protocol type) · `spec/v2/core/interop.md` §The audit event · `spec/v2/core/events.md` §Host events · `conformance/src/scenarios/v2-negotiation-decided-emitted.test.ts` and a new `v2-negotiation-decided-inbound.test.ts` · `SECURITY/invariants.yaml` (`a2a-version-no-silent-downgrade`, `mcp-version-no-silent-downgrade`) |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.4): one optional property on a closed payload, and one reserved type on the optional `hostEvents` family. No field is renamed or removed, no enum changes, no MUST relaxes. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`interop.md` requires every A2A and MCP version negotiation to leave a `negotiation.decided` record, and names that record as the witness that no host downgrades silently. Two things stop it doing that job. The closed payload has no seat for the version the peer asked for, and admits only `accepted` or `refused`, so a downgrade reads exactly like a normal accept; the prose's `outcome: downgraded` cannot be recorded. And the event is a run event, so a negotiation that happens before any run exists (a peer fetching the host's agent card, an MCP client's `initialize`) has nowhere to go. This RFC adds an optional `requested` field and gives a runless negotiation a home as a durable host event (RFC 0236).

## Motivation

**The prose and the schema disagree.** `spec/v2/core/interop.md` §The audit event shows `{ protocol, peer, requested, negotiated, outcome: accepted | downgraded | refused, reason }` and says a downgrade above the floor "reports `outcome: downgraded`". The closed payload (`run-event-payloads.schema.json#/$defs/negotiationDecided`) is `{ protocol, outcome: accepted | refused, version?, floor?, peerDigest?, reason?, at }`. Both hosts that emit the event follow the schema: the v2 reference host (`src/interop.ts`, `0175.negotiation-decided-emitted` `executed-pass` on its certified cuts) and openwop-app (`src/host/negotiationDecided.ts`, which records a downgrade as `accepted` and reports the disagreement).

**So a downgrade is invisible.** Without `requested`, a reader of the log cannot tell "the peer asked for 0.3 and got it" from "the peer asked for 1.0 and was given 0.3". The second is the silent downgrade that `a2a-version-no-silent-downgrade` and `mcp-version-no-silent-downgrade` forbid, and this event is their normative witness (RFC 0175 §D.5).

**An inbound negotiation cannot comply.** `interop.md` §Negotiation binds both directions: the peer identity is "the caller's Subject … or the host's own outbound identity". A host acting as the A2A server or MCP server negotiates before any run exists, so the run-event home is unreachable, and the MUST cannot be met.

## Proposal

### §A. What was asked for

- **A.1.** `negotiationDecided` gains an optional property `requested` (string): the version (A2A) or revision (MCP) the requesting side named. It uses the same grammar as `version`.
- **A.2.** A host MUST set `requested` whenever the requesting side named a version: inbound, the version the caller named (`A2A-Version`, or MCP `initialize` `protocolVersion`); outbound, the version the host asked the peer for.
- **A.3.** A downgrade is an `accepted` record whose `version` differs from `requested`. `interop.md`'s "Downgrade above the floor" sentence is restated in those terms; `outcome` keeps its two values.

### §B. Where a runless negotiation is recorded

- **B.1.** A negotiation made inside a run is recorded on that run's log, as today.
- **B.2.** Any other negotiation is recorded as a durable host event of reserved type `negotiation.decided` (`host-event.schema.json`), whose `payload` is `negotiationDecided` and whose `delivery` is `durable`. It belongs to the caller's tenant, and to the caller's workspace when the request names one.
- **B.3.** A host that serves either protocol inbound (it advertises `a2a.agentCardUrl`, or `mcp.serverUrls` or `mcp.serverMount`) MUST advertise `hostEvents` and list `{ "type": "negotiation.decided", "delivery": "durable" }` in `hostEvents.types[]`.
- **B.4.** An exchange with no authenticated caller has no tenant, and the `events.md` tenant gate forbids delivering its event to anyone else. Such an exchange cannot lower the version below `preferredVersion` (`interop.md` §Authentication), so there is no downgrade for the record to reveal. The host still records it; that record reaches no subscriber, and the obligation is unwitnessable from outside (falsifiability row B.4).

The type name is shared with the run event on purpose. `channel.presence` is already registered in both `run-event.schema.json` and `host-event.schema.json`; the envelope tells them apart, since a host event never carries `runId`.

### §C. Prose and schemas

- `interop.md` §The audit event: the inline payload block is replaced by a pointer to the schema, the downgrade sentence restated per A.3, and one sentence added for §B. The core word budget is at its cap (38,000 / 38,000), so the edit is word-neutral or shorter.
- `events.md` §Host events: `negotiation.decided` joins `channel.presence` as a reserved protocol type.
- `run-event-payloads.schema.json`: `requested` added to `negotiationDecided`; the seed rule in `derive-v2-schemas.mjs` carries it so `--check` stays green.
- `host-event.schema.json`: one `allOf` branch binding `negotiation.decided` to `delivery: durable` and `payload` to `negotiationDecided`.

### §D. Conformance

- `v2-negotiation-decided-emitted` additionally asserts that `requested` is present and equals the version the seam's exchange named.
- New `v2-negotiation-decided-inbound`, gated on `a2a.agentCardUrl` or `mcp.serverUrls` / `mcp.serverMount`. It reads discovery for B.3, then as an authenticated client makes one inbound exchange that names `preferredVersion` and one that names a version below the floor, and reads `/host/events` for each record. No seam is needed.
- Both silent-downgrade invariants list the two v2 scenarios in `tests`, and their witness class is re-reviewed once the inbound leg is certified on a host.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| A.2 `requested` set, outbound | `requested` on the run's `negotiation.decided`, equal to the version the exchange named | the suite, through the §22/§23 invoke seams | witnessable — gated (seam drives the exchange; the record is read on the normative surface) |
| A.2 `requested` set, inbound | `requested` on the host event, equal to the version the suite named | the suite, as an inbound A2A or MCP client | witnessable — gated |
| A.3 a downgrade reads as one | an `accepted` record with `version` ≠ `requested` | the suite, against a host whose `versions[]` spans floor to preferred | witnessable — gated; no host in `INTEROP-MATRIX.md` offers such a span today (G2) |
| B.2 runless home | a `negotiation.decided` frame on `/host/events` for an inbound exchange, `delivery: durable`, no `runId` | the suite, as an inbound client | witnessable — gated |
| B.3 listed when inbound is served | `hostEvents.types[]` contains the durable type whenever the inbound facet fields are present | the suite, reading discovery | witnessable — unaided |
| B.4 unauthenticated exchange recorded | nothing reaches any tenant | — | unwitnessable — the record has no tenant audience by construction |

## Compatibility

`additive`. `requested` is an optional property on a closed v2 object (COMPATIBILITY.md §2.4); events recorded before it existed stay valid on replay, fork and poll. `negotiation.decided` as a host event is a new reserved type on an optional family. A.2 and B.3 apply from the first suite release that ships them (§2.3): they give an existing MUST ("every negotiation outcome … MUST emit") a way to be met, rather than adding a new obligation. Committed bundles stay valid measurements at their suite version.

## Alternatives considered

1. **Add `downgraded` to `outcome`.** A reader pinned to an earlier 2.x schema (`versioning.md` §4) rejects the event, so for that reader the event's shape changes, which §2.2 forbids within a major. `requested` carries the same fact as an optional field.
2. **Erratum only: align the prose to the schema and drop the downgrade sentence.** It removes the only signal that a downgrade happened, which is the reason the event exists.
3. **Narrow the MUST to in-run negotiation.** It relaxes a MUST (§2.2), and leaves the inbound direction, which `interop.md` §Authentication binds, with no record.
4. **A distinct name, `negotiation.inbound-decided`.** A second name for one fact; `channel.presence` already lives in both registries, and the envelope disambiguates.
5. **Deliver an unauthenticated record to an operator channel.** v2 has no operator-scoped subscription surface, and inventing one is outside this RFC.

## Decisions

Settled in the `/architect` review (2026-10-10):

1. **The schema's field names stand.** Both emitters ship them; renaming would break every emitter.
2. **The same type name in both registries**, following `channel.presence`.
3. **An unauthenticated exchange is recorded but delivered to no one** (B.4), rather than relaxing the MUST or inventing an audience.

## Implementation notes (non-normative)

- **v2 reference host** (`openwop-examples`): set `requested` in `src/interop.ts` and `src/mcp-client.ts`; emit the host event from its agent-card and MCP server routes; list the type in `hostEvents.types[]`. Its certified cut is the tier-1 evidence.
- **openwop-app** (`src/host/negotiationDecided.ts`): the same; its builder already takes no recorder for a runless caller, which becomes the host-event path.
- **openwop-sdks:** `requested` on the `negotiationDecided` payload type.

## Acceptance criteria

- [ ] `Active`: §A–§C merged; `CHANGELOG.md` records it.
- [ ] `v2-negotiation-decided-emitted` asserts `requested`, and `v2-negotiation-decided-inbound` ships, each sabotage-proved against a host that omits `requested` or records nothing inbound.
- [ ] `Accepted`: a certified major-2 bundle records `openwop.requirement.0242.*` `executed-pass` for A.2 (inbound), B.2 and B.3.

## References

- RFC 0175 §D.3 and §D.5 (the event and the invariants it witnesses); RFC 0236 (host events); RFC 0241 (the reserved host-event type pattern).
- `spec/v2/core/interop.md` §Negotiation is a protocol; `spec/v2/core/events.md` §Host events; `spec/v2/core/conformance.md` §Witness class.
- openwop-app ADR 0858 P4 (the report).
