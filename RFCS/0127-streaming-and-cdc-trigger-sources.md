# RFC 0127: Streaming & CDC trigger sources

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0127                                                            |
| **Title**         | Streaming & CDC trigger sources                                 |
| **Status**        | `Draft` (open questions resolved 2026-07-06 — ready for comment)  |
| **Author(s)**     | openwop-app maintainers                                         |
| **Created**       | 2026-07-05                                                      |
| **Updated**       | 2026-07-06                                                      |
| **Affects**       | `spec/v1/trigger-bridge.md`, `spec/v1/capabilities.md`, `schemas/trigger-subscription.schema.json`, `schemas/trigger-event.schema.json`, conformance `trigger-bridge-*` scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                               |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0083 defined a durable trigger bridge whose `capabilities.triggerBridge.sources[]`
enumerates `webhook / schedule / queue / email / form`, and RFC 0099 defined the
normalized `TriggerEvent` envelope for externally-originated events. This RFC **additively**
extends both with two new sources — **`stream`** (a message consumed from a streaming
broker: Kafka / Kinesis / Pub-Sub) and **`change`** (a change-data-capture row from a
warehouse/database changelog) — so a CDP-class host can advertise honest, conformance-gated
streaming/CDC ingestion. It reuses RFC 0099's `TriggerEvent` envelope, SSRF posture, and
body-redaction invariants unchanged; only the `source` vocabulary and a small per-source
ingestion advertisement grow.

## Motivation

Customer-Data-Platform and analytics hosts ingest first-party events from streaming
brokers and warehouse CDC feeds, not only webhooks/email/forms. Today a host that consumes
a Kafka topic or a BigQuery/Snowflake changelog and lands each message as a run has **no
honest wire vocabulary** for it: `capabilities.triggerBridge.sources[]` cannot name
`stream` or `change`, so the host must either mislabel the source as `webhook` (a dishonest
wire claim that `OPENWOP_REQUIRE_BEHAVIOR=true` rightly rejects) or leave the capability
unadvertised (invisible to peers/agents). The ingestion *plumbing* is a host implementation
detail; the **source vocabulary and its ingestion contract are wire shape** and therefore
belong in the spec (per `CONTRIBUTING.md` — a new capability value is a normative change).

## Proposal

### 1. `source` vocabulary (additive)

Extend the trigger `source` enum (RFC 0083 `sources[]`, RFC 0099 `TriggerEvent.source`,
`TriggerSubscriptionRegistration.source`) with two values:

```diff
   "source": {
     "type": "string",
-    "enum": ["webhook", "schedule", "queue", "email", "form"]
+    "enum": ["webhook", "schedule", "queue", "email", "form", "stream", "change"]
   }
```

- **`stream`** — a message consumed from a streaming broker (Kafka/Kinesis/Pub-Sub). The
  host is the *consumer*; each delivered message normalizes to one `TriggerEvent`.
- **`change`** — a change-data-capture record (insert/update/delete) from a warehouse or
  database changelog. Carries an `op` discriminator in `metadata.triggerData`.

Both are OPTIONAL sources: a host that consumes neither simply omits them from
`capabilities.triggerBridge.sources[]` (the RFC 0083 §D "any one durable source" profile is
unchanged — `stream`/`change` are additional durable sources, not required ones).

### 2. `TriggerEvent` envelope — unchanged shape, two source values

A streamed/CDC event uses the **existing** RFC 0099 `TriggerEvent` envelope verbatim
(content-free on the wire — identifiers + normalized metadata only; the message/row body
lives in `metadata.triggerData` and is redacted out of `trigger.*` events, SR-1). No new
fields on the envelope itself. `metadata.triggerData` for a `change` event MUST include an
`op` field (`"insert" | "update" | "delete"`); for a `stream` event it MAY include the
broker `partition`/`offset` for at-least-once dedup keying.

### 3. Ingestion advertisement (additive sub-block)

`capabilities.triggerBridge.ingestion` (RFC 0099) gains two OPTIONAL booleans mirroring the
existing per-source advertisements — a host MUST advertise a source in `ingestion` **only
when it behaviorally ingests it** (the RFC 0099 honesty rule):

```diff
   "ingestion": {
     "webhook": true,
     "email": true,
-    "form": true
+    "form": true,
+    "stream": true,
+    "change": true
   }
```

### 4. Dedup, SSRF, replay — reused verbatim

- **Dedup.** A `stream` event's dedup key SHOULD derive from the broker `(topic, partition,
  offset)`; a `change` event's from `(table, changelog-id)`. Reuses the RFC 0083 §C-1 ≥24h
  dedup floor — no new mechanism.
- **SSRF.** Any host-side fetch the ingestion path performs (e.g. resolving a schema-registry
  reference) MUST pass the RFC 0099 SSRF guard. The broker/warehouse *connection* is a
  credential-brokered egress (RFC 0095), never a wire field.
- **Replay.** `trigger.*` events stay content-free recorded-facts (RFC 0083/0099); a
  streamed/CDC event introduces no new non-determinism on the wire (the body is host-local).

### Positive example

`capabilities.triggerBridge = { supported: true, sources: ["webhook","schedule","queue","email","form","stream","change"], ingestion: { webhook:true, email:true, form:true, stream:true, change:true }, dedup:true }` — a CDP host that consumes a Kafka topic **and** a warehouse CDC feed, both landed as durable runs.

### Negative example

A host advertising `sources: [...,"stream"]` but whose `trigger-bridge-delivery` scenario
never produces a `trigger.delivery.attempted` for a `source:"stream"` event fails the gated
conformance run under `OPENWOP_REQUIRE_BEHAVIOR=true` (advertise-only-what-you-honor).

## Security & Compatibility

- **Compatibility: additive.** New enum values + new optional advertisement booleans. Pre-RFC
  hosts/peers ignore unknown sources; the four-state subscription machine, dedup/retry model,
  and causation edge are unchanged.
- **SR-1 preserved.** No message/row body ever reaches the wire — the existing RFC 0099
  redaction invariant covers `stream`/`change` unchanged (the payload builder's closed
  allowlist already excludes `triggerData`).

## Host implementation note (non-normative)

The consuming plumbing (`core.openwop.streams` connection + node pack landing each message
via `ingestExternalEvent`) is host-extension and needs no wire change beyond this RFC's
`source` value. openwop-app ADR 0269 (CDP-G) gates its streaming-ingest work on this RFC
reaching `Accepted`.

## Resolved questions

1. **`change` stays ONE source with an `op` discriminator** (not three `insert`/`update`/`delete`
   sources). This mirrors how `webhook` carries an HTTP *method* inside one source rather than
   fragmenting the `sources[]` vocabulary per verb — keeping the enum small and stable is the
   dominant concern. `op` (`"insert" | "update" | "delete"`) is REQUIRED in a `change` event's
   `metadata.triggerData` (§2). *(Resolved 2026-07-06.)*
2. **Reuse the RFC 0083 dedup floor; no `deliveryGuarantee` advertisement is added.** An
   at-least-once/exactly-once advert would be a normative claim a conformance run cannot refute
   over the wire (the guarantee is a property of the host's consumer + the broker, not an
   observable event field) — an unfalsifiable MUST is worse than none. The observable, testable
   contract is the existing dedup floor (`trigger.delivery.attempted` + the ≥24h dedup key). A
   `deliveryGuarantee` sub-field is deferred until a concrete conformance gap demonstrates the
   dedup floor is insufficient. *(Resolved 2026-07-06.)*

## Open questions

None — the two questions above are resolved. The RFC is ready for the comment window.
