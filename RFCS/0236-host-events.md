# RFC 0236: Host events — events without a run-log position

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0236                                                            |
| **Title**         | Host events — events without a run-log position                 |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-05                                                      |
| **Updated**       | 2026-10-05 — filed `Draft` after an `/architect` design review (2026-10-05) of two problems with one cause: an event that belongs to no run has no lawful v2 shape. |
| **Affects**       | `spec/v2/core/events.md` §Host events · `spec/v2/core/webhooks.md` §Subscriptions, §Delivery · `spec/v2/core/conversation.md` §`channelPresence` · `spec/v2/core/capabilities.md` (new family `hostEvents`) · `spec/v2/declaration.json` · new `schemas/v2/host-event.schema.json` · `schemas/v2/webhook-delivery.schema.json` · `api/v2/asyncapi.yaml` (`hostEvents` channel) · `api/seams-v2.yaml` (through `scripts/derive-v2-api.py`) · `SECURITY/invariants.yaml` · new `v2-host-event-delivery.test.ts` |
| **Compatibility** | `additive` with one `safety-fix` clause (§D) per COMPATIBILITY.md; see §Compatibility. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

v2 has one kind of event: a run event, which is a position in a run's append-only log (`events.md` §1). Two real event streams belong to no run. Channel presence MUST NOT be persisted (RFC 0110), so it cannot honestly carry a `sequence`. Vendor host events (a CRM contact created, an order paid) have no run at all, so one production host delivers them to webhooks under an invented `runId`. This RFC adds the **host event**: a closed, runless, tenant-scoped envelope with a declared delivery class, `durable` or `ephemeral`. It is carried on the existing `hostEvents` channel and, for durable types, on webhooks. Presence becomes the protocol's first ephemeral host event.

## Motivation

**Presence contradicts the run log.** RFC 0110 makes `channel.presence` ephemeral: a host MUST NOT write it to the replayable log, and it MUST NOT affect replay or `:fork`. But v2 registers it as a run event. Its envelope requires `sequence`, and `events.md` §1 says every stream is a projection of the log. A streamed event that is not in the log has no lawful `sequence`, and `Last-Event-ID` resumption (`events.md` §SSE) then points at a hole. `conversation.md` §`channelPresence` therefore names the logging rule as unresolved (an `/architect` ruling of 2026-10-05). Restating it would contradict core; dropping it lets a fork replay stale presence.

**Runless vendor events have no home.** openwop-app delivers CRM, CMS and commerce events to webhook subscribers, a heavily used production feature (its ADR 0812). With v1 retired on that host, every subscription is major-2, and `webhooks.md` §Delivery admits run events only: the body is `{ runId, workspaceId?, event }`, and `event` is "the verbatim run event". The host sends `runId: "hostext:openwop-app.crm.contact-created"`, which fails `webhook-delivery.schema.json`. There is no lawful alternative:

- the `hostEvents` channel admits only the two heartbeat messages (`api/v2/asyncapi.yaml`);
- a pseudo run id names no run, so the readable-representation rule (`webhooks.md` §Delivery) fails;
- a host event has no `sequence`, so the dedup key `(OpenWOP-Webhook-Id, runId, sequence)` fails too.

**`hostEvents` is not tenant-scoped.** The channel today carries "no run data" and says nothing about who may read a message. That was harmless for heartbeats. It is a disclosure channel once business events ride it.

## Proposal

### §A The host-event envelope

New `schemas/v2/host-event.schema.json`, closed:

| Field | Type | Rule |
| --- | --- | --- |
| `eventId` | `ids.schema.json#/$defs/eventId` | REQUIRED. Unique per host; stable across every delivery attempt of the event. |
| `type` | string | REQUIRED. A protocol host-event type, or a vendor type under the `events.md` §Naming grammar (`org.name`, `org` registered). |
| `timestamp` | RFC 3339 date-time | REQUIRED. When the host produced the event. |
| `delivery` | `"durable"` \| `"ephemeral"` | REQUIRED. MUST equal the class the host advertises for `type` (§B). |
| `workspaceId` | `ids.schema.json#/$defs/workspaceId` | Present exactly when the event belongs to a workspace (`identity.md` §1). |
| `payload` | object | REQUIRED. For a protocol type, its registered payload schema. A vendor payload MUST NOT carry secret material (SR-1). |

A host event has **no `runId` and no `sequence`**. It is not a run event, and no run's log contains it.

### §B The `hostEvents` family

A new core family, `hostEvents`, with normative home `events.md` §Host events. Its facet `types[]` lists every host-event type the host emits: `{ type, delivery }`, with `type` unique and at least one entry.

A host advertising `hostEvents`:

- MUST deliver every advertised type on the `hostEvents` channel (`streamHostEvents`), as an SSE frame whose `event:` is the `type` and whose `data:` is the §A envelope;
- MUST NOT emit a host-event type it does not advertise;
- MUST keep a type's delivery class constant.

A host that does not advertise `hostEvents` emits no host events. The two heartbeat messages keep their existing shape on the same channel; they are not host events in the §A sense (gap G3).

### §C Delivery classes

An **ephemeral** host event is live state:

- a host MUST NOT persist it;
- its SSE frame MUST carry no `id:`, and a host MUST NOT redeliver it on reconnection, whatever `Last-Event-ID` says;
- a host MUST NOT deliver it through webhooks, A2A push, or any outbound sink.

A **durable** host event:

- its SSE frame's `id:` is the `eventId`;
- a host SHOULD honour `Last-Event-ID` for durable host events within its retention;
- it MAY be delivered through webhooks (§E).

### §D Tenant scope (safety fix)

Every message on the `hostEvents` channel, host events and heartbeat messages alike, MUST be delivered only to a subscriber whose tenant owns it. A host event that names a `workspaceId` MUST be delivered only to subscribers within that workspace. An ephemeral host event MUST additionally be delivered only to subscribers it is visible to; for `channel.presence`, that is the channel's current members. This is CTI-1 applied to a channel that never stated it (invariant `host-event-tenant-isolation`).

### §E Webhook delivery of durable host events

- `registerWebhook`'s `events[]` MAY name an advertised **durable** host-event type. Naming an ephemeral or unadvertised host-event type MUST be refused `400 validation_error`.
- The delivery body for a host event is `{ hostEvent }`, the §A envelope. `webhook-delivery.schema.json` becomes `oneOf` the existing run body (unchanged) and the host body.
- Headers and signing are unchanged. `OpenWOP-Event-Type` is the host-event `type`.
- The dedup key is `(OpenWOP-Webhook-Id, eventId)`. `webhook-id` MUST be identical on every attempt of one `(webhookId, eventId)`.
- Durability, retries, dead letters and secret rotation apply exactly as to run deliveries. A subscription MUST receive only host events of its own tenant (`webhook-cross-tenant-isolation`, extended).

### §F Presence is an ephemeral host event

`channel.presence` is the protocol's ephemeral host-event type, with payload `channel-presence-payload.schema.json`. A host advertising `channelPresence` MUST advertise `hostEvents` listing `{ type: "channel.presence", delivery: "ephemeral" }`, and MUST NOT emit `channel.presence` as a run event. Its entry in the v2 run-event type union is deprecated, with removal at the next major (gap G4). `conversation.md` §`channelPresence` replaces its "unresolved" sentence with this rule.

### §G The emit seam

`POST /conformance/seams/sample/host-events/emit` `{ type, workspaceId? }` answers `202 { eventId }`. The host MUST produce the event through its production path, delivery class and tenant gate included, and MUST NOT branch on the seam. The reserved org `example` (`events.md` §Naming) is held for conformance, so a host that serves the seams profile advertises an `example.*` durable type and an `example.*` ephemeral type for the suite to drive.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A, §B envelope on the stream — `openwop.requirement.0236.host-event.envelope` | a seam-emitted advertised type arrives on `/host/events` as a valid §A envelope with no `runId`/`sequence`, `event:` equal to `type`, `delivery` equal to the advertised class | the suite, through the §G seam | witnessable — executed-pass required on a host bundle |
| §C ephemeral frames carry no `id:` and are not redelivered — `openwop.requirement.0236.ephemeral.no-resume` | the ephemeral frame has no `id:`; a reconnect with `Last-Event-ID` set to an earlier durable id does not replay it | the suite, through the §G seam | witnessable — executed-pass required on a host bundle |
| §C ephemeral events are not fanned out — `openwop.requirement.0236.ephemeral.no-fan-out` | a webhook subscribed to every durable advertised type receives nothing for a seam-emitted ephemeral event | the suite, through the §G seam and the webhook receive seam | witnessable — executed-pass required on a host bundle |
| §C an ephemeral event is not persisted | only through the projections the two rows above read; host storage is not observable | — | unwitnessable beyond the projections — the no-resume and no-fan-out rows are its witness |
| §E an ephemeral or unadvertised type is refused at registration — `openwop.requirement.0236.webhook.ephemeral-refused` | `registerWebhook` naming the advertised ephemeral type answers `400 validation_error` | the suite, unaided, when an ephemeral type is advertised | witnessable — executed-pass required on a host bundle |
| §E the host body, signature and dedup id — `openwop.requirement.0236.webhook.host-variant` | a seam-emitted durable event reaches a subscribed receiver as `{ hostEvent }`, validates, verifies under the subscription secret, and carries `OpenWOP-Event-Type` = `type` | the suite, through the §G seam and the webhook receive seam | witnessable — executed-pass required on a host bundle |
| §D tenant scope — `openwop.requirement.0236.host-event.tenant-isolation` | a stream opened with a second tenant's credential receives nothing for an event emitted under the first | operator (a second-tenant credential) and the §G seam | witnessable — gated |
| §F presence is an ephemeral host event | the `hostEvents` record lists `channel.presence` as ephemeral whenever `channelPresence` is advertised | the suite, unaided | witnessable — unaided (asserted inside the envelope leg's advertisement check) |

## Compatibility

`additive`, plus one `safety-fix` clause.

- **Additive:** a new family, schema, channel message, seam and webhook body variant. A host that does not advertise `hostEvents` is unaffected. The run body of `webhook-delivery.schema.json` is byte-identical. The host body is opt-in: a subscriber receives it only by naming a host-event type in `events[]`, which no existing subscription does, because no host-event type existed.
- **Deprecation (§F):** `channel.presence` stays in the run-event union, deprecated. The emitter census is 0: no committed major-2 bundle's host advertises `channelPresence`. The frozen v1 tree is untouched.
- **Safety fix (§D):** tenant-scoping heartbeat messages tightens an unstated rule. It is a CTI-1-class correctness fix, so the 90-day window does not bind. No host is known to deliver heartbeats across tenants: the v2 reference host serves one tenant per credential.
- **Version axes:** none move. Nothing enters or leaves a run log, so no in-flight run, replay or fork is affected.

## Conformance

**Existing:** `v2-channel-presence-delivery` and `v2-channel-presence-advertisement` (presence through the §13 seam), and the durable-webhook scenarios (signing, retries, dead letters), which this RFC's host body inherits.

**New:** `v2-host-event-delivery`, gated on `hostEvents` and the seams profile, built as a shared witness (`lib/host-event-witness.ts`: an observer plus a pure judge) and proven against a scratch double that turns on one defect per self-test:

- an envelope carrying `runId`;
- an ephemeral frame carrying `id:`;
- an ephemeral event replayed on reconnect;
- an ephemeral event fanned out to a webhook;
- an ephemeral type accepted at registration;
- a host body that fails the schema or the signature;
- a second tenant receiving the event.

A coherence check in `src/coherence/` asserts that `channel.presence` is registered as a protocol host-event type.

## Alternatives considered

1. **An ephemeral run event with no `sequence`.** It would keep presence where it is, but it makes `sequence` optional on the run-event envelope, which is a breaking change for every run-event consumer. It also does nothing for runless vendor events.
2. **A pseudo run id per host event** (`<tenant>/hev.<id>`). It fits today's webhook schema but names no run, breaks the readable-representation rule and the dedup key, and invites clients to `GET` a run that is not there.
3. **A channel-scoped presence stream.** It solves presence only, needs a client route v2 deliberately does not have (`conversation.md`), and leaves vendor events homeless.
4. **Do nothing.** Presence's logging rule stays unstatable, and openwop-app must either stop a heavily used production feature or keep shipping a schema-invalid body. Both are worse than one additive envelope.

## Unresolved questions

1. **Scope.** `/host/events` uses `runs:read`. Should host events need a new `events:read` scope? Proposed: no; a new scope is vocabulary churn, and §D's tenant rule is the control.
2. **Poll.** Should durable host events also have a long-poll read? Proposed: no; SSE plus webhooks cover both consumers, and a poll would need its own cursor grammar.
3. **Heartbeat messages.** Should they move into the §A envelope? Proposed: at the next major only (G3), because wrapping them now breaks every heartbeat consumer.

## Implementation notes (non-normative)

- **v2 reference host** (`openwop-examples`): it already serves `/host/events` and durable webhooks. It needs the family record, the envelope, the tenant gate on the stream, the §G seam with an `example.*` durable and ephemeral type, and the webhook host body. That makes it the tier-1 evidence host.
- **openwop-app** (ADR 0812): the production consumer. It renames its types to two segments (`openwop-app.crm-contact-created`), advertises them as durable, and moves its CRM, CMS and commerce webhooks to the host body. It is the natural tier-2 follow-on.
- **Sequencing:** Draft → Active (prose, schemas, AsyncAPI, seam, legs, invariant) in one suite release, then the reference host adopts it and cuts, then `Accepted`.

## Acceptance criteria

- [ ] `Active`: §A–§G merged in `events.md`, `webhooks.md`, `conversation.md` and `capabilities.md`; the family row in `spec/v2/declaration.json`; `host-event.schema.json`; the `webhook-delivery.schema.json` `oneOf`; the AsyncAPI message; the §G seam; invariant `host-event-tenant-isolation`; a `CHANGELOG.md` entry.
- [ ] `v2-host-event-delivery` ships, with each leg failing on its sabotage in the scratch double.
- [ ] `Accepted`: a certified major-2 bundle records the six `openwop.requirement.0236.*` ids `executed-pass`, or as a non-pass row with a reason for the gated tenant row.

## References

- `spec/v2/core/events.md` §1, §SSE, §Naming, §Host events; `spec/v2/core/webhooks.md` §Delivery; `spec/v2/core/conversation.md` §`channelPresence`; `spec/v2/core/identity.md` §1.
- RFC 0110 (channel presence), RFC 0060 (heartbeat), RFC 0171 (event naming), RFC 0173 (the `hostEvents` address), RFC 0093 and RFC 0215 (webhook signing and durability).
- openwop-app ADR 0812 (runless host events on major-2 webhooks); the `/architect` rulings of 2026-10-05 recorded in `TODO.md` §8.
- Prior art: CloudEvents 1.0 (an envelope with `id`, `type`, `source`, `time` and no stream position); Standard Webhooks (one `webhook-id` per event).
- Registers: [`gaps`](./registers/0236-host-events.gaps.md), [`risks`](./registers/0236-host-events.risks.md).
