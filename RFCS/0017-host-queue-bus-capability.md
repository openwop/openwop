# RFC 0017: host.queueBus capability

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0017                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Title**         | host.queueBus inbound queue + stream capability                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Author(s)**     | OpenWOP Working Group                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Created**       | 2026-05-17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Updated**       | 2026-05-18 (Active → Accepted: all 5 acceptance-criteria items satisfied. `capabilities.queueBus` block in schema; `spec/v1/host-capabilities.md §host.queueBus` landed at commit c5831fe; invariant `queue-cross-tenant-isolation` + 3 mandatory scenarios (`queue-publish-consume-roundtrip`, `queue-cross-tenant-isolation`, `queue-ack-nack-dlq`) + 1 gated (`stream-subscribe-from-beginning`); reference impl advertised in `routes/discovery.ts` lines 193–199; CHANGELOG entry under `[Unreleased]`.) |
| **Affects**       | `spec/v1/host-capabilities.md` · `schemas/capabilities.schema.json` · `SECURITY/invariants.yaml`                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Summary

Adds an optional `host.queueBus` capability covering publish + inbound-consume + ack/nack/dead-letter, plus stream subscribe/publish. Required by `core.openwop.messaging`. Sibling to existing `host.messaging` (which is outbound-egress-only) — `host.queueBus` covers full message-queue semantics including delivery acknowledgement.

## Motivation

n8n RabbitMQ/Kafka/SQS/NATS/MQTT/Pub-Sub nodes all expose the same pattern: a trigger fires on inbound, an action publishes outbound, plus ack/nack on the trigger side. openwop currently has no inbound-queue surface at all. `host.messaging` only handles outbound chat egress.

## Proposal

### §A Capability schema

```json
{
  "queueBus": {
    "type": "object",
    "properties": {
      "supported": { "type": "boolean" },
      "backends": { "type": "array", "items": { "type": "string", "enum": ["rabbitmq","kafka","sqs","sns","pubsub","mqtt","nats","redis-streams","in-memory"] } },
      "deadLetterSupported": { "type": "boolean" },
      "stream": {
        "type": "object",
        "properties": {
          "supported": { "type": "boolean" },
          "fromBeginning": { "type": "boolean" }
        }
      }
    },
    "additionalProperties": false
  }
}
```

### §B Host-contract MUSTs

1. Cross-tenant message isolation. A consumer for tenant A MUST NOT receive messages published by tenant B, even on the same logical topic.
2. Ack semantics: `ack` removes the message from the queue; `nack` returns it for redelivery; `deadLetter` routes it to the configured dead-letter queue.
3. Trigger-mode delivery: when a workflow registers `core.messaging.consume` as a trigger, the host MUST deliver one workflow run per message.

### §C SECURITY invariant

```yaml
- id: queue-cross-tenant-isolation
  tier: protocol
  summary: "host.queueBus MUST partition messages by tenant. Cross-tenant consumption MUST NOT occur."
  conformance_test: "queue-cross-tenant-isolation.test.ts"
```

### §D Conformance

- `queue-publish-consume-roundtrip.test.ts`.
- `queue-cross-tenant-isolation.test.ts`.
- `queue-ack-nack-dlq.test.ts`.
- `stream-subscribe-from-beginning.test.ts` (gated on `stream.fromBeginning`).

## Compatibility

**Additive**. New capability. `host.messaging` (existing, outbound-egress-only) remains unchanged.

## Implementation notes (non-normative)

- Schema diff in §A lands in `schemas/capabilities.schema.json` on Active promotion, not at Draft.
- SECURITY invariant `queue-cross-tenant-isolation` lands in `SECURITY/invariants.yaml` alongside the matching scenario.
- Reference impl candidate: in-memory pub/sub bus per tenant in `examples/hosts/in-memory/`.

## Acceptance criteria

- [x] Capability block.
- [x] Prose section. (Landed at commit c5831fe.)
- [x] Invariant + 3 mandatory scenarios + 1 gated.
- [x] In-memory reference impl.
- [x] CHANGELOG entry.

## References

- n8n RabbitMQ/Kafka/SQS/NATS/MQTT triggers (prior art).
- Existing `host.messaging` (sibling, outbound-only).
- `core.openwop.messaging` pack.
