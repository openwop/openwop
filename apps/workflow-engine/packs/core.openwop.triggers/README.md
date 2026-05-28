# `core.openwop.triggers`

Workflow entry-point pack. Four universal trigger shapes — webhook, schedule, event, envelope — for external-event-driven workflow dispatch.

| Pack name | `core.openwop.triggers` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | JavaScript (ESM), Node `>=20` |
| External deps | None — pure pass-through of `ctx.triggerData` |
| License | Apache-2.0 |

## What triggers are (and aren't)

Trigger nodes appear at the entry of a workflow. They DON'T execute in the normal sense — the host's trigger subsystem fires the workflow on the external event, captures the payload, and exposes it to the entry node via `ctx.triggerData`. This pack's runtime forwards that payload to outputs.

| | What it does | What it doesn't do |
|---|---|---|
| **Host trigger subsystem** | Listens for external events (HTTP, cron, event bus); starts the run with payload | (not in the workflow graph) |
| **Trigger node (this pack)** | Forwards `ctx.triggerData` to outputs; provides typed schemas for the payload | Does NOT listen, register endpoints, or run continuously |

## Nodes

| typeId | role | capabilities |
|---|---|---|
| `core.openwop.triggers.webhook` | `pure` | `cacheable` |
| `core.openwop.triggers.schedule` | `pure` | `cacheable` |
| `core.openwop.triggers.event` | `pure` | `cacheable` |
| `core.openwop.triggers.envelope` | `pure` | `cacheable` |

All four are `pure` + `cacheable` — NOT `side-effectful`. The external-event listening is the host's concern; the node only reflects what the host captured. `ctx.triggerData` is persisted at run start, so replays return the same payload without re-fetching.

### `webhook`

HTTP webhook entry-point. Config declares path + accepted methods + optional HMAC secret. Output carries method + headers + query + body + receivedAt + remoteAddr.

```json
{
  "config": { "path": "/hooks/github/push", "methods": ["POST"], "secret": "github-hmac" },
  "inputs": {}
}
// at fire-time, ctx.triggerData is set from the HTTP request →
// outputs: { method, headers, query, body, receivedAt, remoteAddr }
```

HMAC verification (`secret` field) happens in the host BEFORE workflow start per `spec/v1/webhooks.md` §verification — missing or invalid signature returns 401 to the caller; the workflow never starts.

### `schedule`

Cron-style scheduled trigger. Config declares cron expression + IANA timezone + missed-fire policy (skip / fire-once / fire-all).

```json
{
  "config": { "cron": "0 9 * * MON", "timezone": "America/New_York", "missedFirePolicy": "fire-once" }
}
// outputs: { firedAt, scheduledFor, cron, timezone, isCatchUp }
```

Drift / missed-fire handling is the host's responsibility — `missedFirePolicy: 'fire-once'` fires one catch-up with the LATEST missed timestamp; `fire-all` fires one per missed (bounded; hosts MAY cap).

### `event`

Generic event-bus subscription. Config declares the event name + optional source filter.

```json
{ "config": { "eventName": "order.created", "source": "billing" } }
// outputs: { eventName, source, payload, firedAt, eventId }
```

For typed envelope events with schema validation, use `core.openwop.triggers.envelope` instead.

### `envelope`

Typed-envelope entry-point. Hosts that maintain an envelope router (e.g., emit/listen surfaces for cross-workflow chaining) dispatch the workflow when an envelope of the declared type fires. Optional `payloadSchema` for pre-dispatch validation.

```json
{
  "config": {
    "envelopeType": "prd.create",
    "payloadSchema": {
      "type": "object",
      "required": ["title", "author"],
      "properties": { "title": { "type": "string" }, "author": { "type": "string" } }
    }
  }
}
// outputs: { envelopeType, payload, envelopeId, sourceRunId?, firedAt }
```

When `sourceRunId` is set, the envelope came from a parent run's emit (cross-workflow chaining). When absent, externally published.

## Domain-specific triggers

Triggers tied to a specific host concept — canvas state, chat messages, artifact lifecycle, run lifecycle — live in vendor packs (e.g., `vendor.myndhyve.triggers`). This pack ships only the universal four.

## See also

- [`spec/v1/rest-endpoints.md`](../../spec/v1/rest-endpoints.md) — host webhook + event endpoints
- [`spec/v1/webhooks.md`](../../spec/v1/webhooks.md) — HMAC verification + delivery semantics
- [`docs/PACKS-MVP-PLAN.md`](../../docs/PACKS-MVP-PLAN.md) — Phase 1 catalog
- `docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md` (lives in the myndhyve repo) — domain trigger split decisions
