# core.openwop.messaging

Queue + stream primitives. Capability-gated on `host.queueBus` (RFC 0017). Sibling to `host.messaging` (which is outbound-egress-only) — `host.queueBus` covers inbound consumption + ack/nack/dead-letter semantics.

| typeId | host capability | purpose |
|---|---|---|
| `core.mq.publish` | `host.queueBus` | Publish a message to a topic/queue. |
| `core.mq.consume` (trigger) | `host.queueBus` | Subscribe to a topic/queue. |
| `core.mq.ack` / `nack` / `dead-letter` | `host.queueBus` | Delivery acknowledgement primitives. |
| `core.mq.stream-subscribe` (trigger) | `host.queueBus.stream` | Kafka / Kinesis / Redis-Streams style. |
| `core.mq.stream-publish` | `host.queueBus.stream` | Stream record producer. |
