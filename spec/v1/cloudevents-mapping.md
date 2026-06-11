# OpenWOP → CloudEvents Mapping (non-normative)

> **Status: Draft (non-normative addendum, 2026-05-15).** STD-2 from `plans/openwop-protocol-gap-closure-plan.md`. Maps OpenWOP `RunEvent` records onto the [CloudEvents 1.0](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md) envelope so hosts that export events to message brokers (Pub/Sub, Kafka, EventBridge, NATS) can do so under a wire-portable contract. **Non-normative** — OpenWOP hosts MAY but are NOT required to support CloudEvents export. Promote to a normative profile once a reference host ships one.

This document does NOT change the native OpenWOP event log shape (`schemas/run-event.schema.json` + `schemas/run-event-payloads.schema.json`). It defines a one-way projection from that shape onto CloudEvents 1.0 attributes for hosts that want to bridge run events into a CloudEvents-aware message bus.

---

## Mapping

| CloudEvents attribute | Source on OpenWOP `RunEvent` | Notes |
|---|---|---|
| `specversion` | Literal `"1.0"` | CloudEvents 1.0 envelope version. |
| `id` | `event.eventId` (when present) OR `evt-${runId}-${seq}` synthesized | MUST be unique within the producer per CloudEvents §3.1.1. Reference hosts already use the `evt-` synthetic shape; reuse it. |
| `source` | URI identifying the host + the run, e.g., `https://api.example.com/v1/runs/{runId}` | MUST be a non-empty URI-reference per CloudEvents §3.1.2. Hosts that don't expose a public base URL MAY use a URN form (`urn:openwop:host:<hostId>:run:<runId>`). |
| `type` | OpenWOP event type prefixed with `dev.openwop.event.`, e.g., `dev.openwop.event.run.started` | Reverse-DNS-style per CloudEvents §3.1.3. The `dev.openwop.event.` prefix avoids collision with consumers that already use `run.*` for their own domain. |
| `time` | `event.timestamp` (ISO 8601) | CloudEvents accepts RFC 3339 / ISO 8601 directly. |
| `datacontenttype` | Literal `"application/json"` | OpenWOP event payloads are JSON. |
| `subject` | `event.nodeId` (when present), otherwise the `runId` | Optional in CloudEvents but recommended for routing. |
| `data` | The native OpenWOP `RunEvent` document (the whole event, including `seq`, `runId`, `type`, `nodeId`, `data`, `timestamp`, optional `causationId`) | Consumers can re-derive the canonical OpenWOP shape from `data` alone. |

### Optional extension attributes

OpenWOP hosts MAY emit these CloudEvents extension attributes (per CloudEvents §"Extension Context Attributes" naming rules — all-lowercase, no separators):

| Extension | Source | Purpose |
|---|---|---|
| `openwoprunid` | `event.runId` | Lets routers shard by run without parsing `data`. |
| `openwopseq` | `event.seq` as integer | Ordering hint; consumers MUST still rely on `causationId` for true causal order. |
| `openwopcausationid` | `event.causationId` (when present) | Causal-chain anchor. |
| `openwoptenantid` | Host-derived tenant scope | Auth + multi-tenancy routing. MUST NOT carry credential material. |

Hosts SHOULD NOT add other extensions without an RFC.

---

## Worked example

OpenWOP wire-level `RunEvent`:

```json
{
  "seq": 7,
  "runId": "run-abc-123",
  "type": "agent.toolCalled",
  "nodeId": "tool-node-2",
  "data": {
    "agentId": "agent:openai/gpt-4o",
    "toolName": "search",
    "callId": "mcp-tool-node-2-mfkb1q3z",
    "argumentsSha256": "deadbeef..."
  },
  "timestamp": "2026-05-15T17:00:00.000Z"
}
```

Projected onto CloudEvents 1.0 (JSON format per [`cloudevents/spec/json-format.md`](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md)):

```json
{
  "specversion": "1.0",
  "id": "evt-run-abc-123-7",
  "source": "https://api.example.com/v1/runs/run-abc-123",
  "type": "dev.openwop.event.agent.toolCalled",
  "time": "2026-05-15T17:00:00.000Z",
  "datacontenttype": "application/json",
  "subject": "tool-node-2",
  "openwoprunid": "run-abc-123",
  "openwopseq": 7,
  "data": {
    "seq": 7,
    "runId": "run-abc-123",
    "type": "agent.toolCalled",
    "nodeId": "tool-node-2",
    "data": {
      "agentId": "agent:openai/gpt-4o",
      "toolName": "search",
      "callId": "mcp-tool-node-2-mfkb1q3z",
      "argumentsSha256": "deadbeef..."
    },
    "timestamp": "2026-05-15T17:00:00.000Z"
  }
}
```

---

## Round-trip note

This mapping is **export-only by design**. Going from a CloudEvents envelope BACK to a native OpenWOP `RunEvent` is lossless as long as the envelope's `data` field carries the full original event. Hosts that re-ingest CloudEvents from a bus and want to project them back to native shape MUST NOT trust the envelope-level `id` / `source` / `time` — those are CloudEvents-layer fields and may have been rewritten by a router. The authoritative OpenWOP fields are inside `data`.

Hosts that want a tighter binding (e.g., signed CloudEvents bridging tenant boundaries) SHOULD layer their own envelope authenticity check; OpenWOP's webhook HMAC recipe per `webhooks.md` §"Signature recipe" is the recommended pattern.

---

## Why non-normative

OpenWOP doesn't currently require CloudEvents export — most hosts pump events directly into their own observability stack. The mapping exists so adopters with CloudEvents-based downstreams (Knative Eventing, AWS EventBridge with CloudEvents binding, OpenTelemetry's experimental CloudEvents semantic conventions) don't have to invent their own projection.

Promote to normative once:

1. At least one reference host ships a CloudEvents exporter.
2. A second adopter independently produces a compatible mapping using this doc as input.
3. Versioning / extension semantics survive a real deploy-skew test.

Until then, this doc captures the intended shape so adopters don't fragment on per-host conventions.

---

## See also

- [`observability.md`](./observability.md) — canonical event vocabulary + `openwop.*` OTel namespace.
- [`run-event.schema.json`](../../schemas/run-event.schema.json) — wire shape for `RunEvent`.
- [`run-event-payloads.schema.json`](../../schemas/run-event-payloads.schema.json) — per-event payload contracts.
- [`positioning.md`](./positioning.md) §"Standards composition matrix" — broader stance on CloudEvents composition.
- [CloudEvents 1.0 specification](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)
