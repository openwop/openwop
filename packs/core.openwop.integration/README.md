# `core.openwop.integration`

Universal communication-integration pack. Phase 1 v1.0.0 ships email-send + slack-message — both side-effectful with engine Layer-2 cost-once caching via deterministic Idempotency-Key derivation.

| Pack name | `core.openwop.integration` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | JavaScript (ESM), Node `>=20` |
| External deps | None — pack speaks no SMTP / Slack API directly |
| License | Apache-2.0 |

## What ships in v1.0.0

| typeId | role | host adapter |
|---|---|---|
| `core.openwop.integration.email-send` | `side-effect` | `ctx.email.send(...)` |
| `core.openwop.integration.slack-message` | `side-effect` | `ctx.slack.postMessage(...)` |

Both declare `side-effectful + cacheable`. Engine's Layer-2 invocation log caches terminal payloads keyed on `(runId, nodeId, request-hash)`. **Replays do NOT re-send emails or post duplicate Slack messages** — the host returns the cached payload directly. Cost-once + replay-deterministic.

## What does NOT ship in v1.0.0

These were originally scoped per `docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md` but defer to follow-on minors because each needs real connection-pool / credential abstractions in the host:

- File-system read/write
- Database query (SQL / NoSQL — connection pooling, transactions, parameterized queries)
- GitHub action invocation
- Event-bus emit (overlaps with `core.openwop.triggers.event` pattern; deferred until the event-emit-side host contract stabilizes)
- Webhook response (low value; can be derived from `core.openwop.http.fetch`)

Each will land in a future `core.openwop.integration` minor or a focused pack (`core.openwop.fs`, `core.openwop.database`).

## `email-send`

```json
{
  "config": {
    "from": "noreply@example.com",
    "provider": "ses",
    "fallbackOnFailure": false
  },
  "inputs": {
    "to": "user@example.com",
    "subject": "Your order has shipped",
    "text": "Tracking: ABC123",
    "html": "<p>Tracking: <b>ABC123</b></p>"
  }
}
// outputs: { sent, messageId, provider, idempotencyKey }
```

Behavior:
- Provider-agnostic (SES / Resend / SendGrid / SMTP — host's `Capabilities.email.providers` declares)
- Bulk recipients via array (host MAY cap at 50 per message)
- Idempotency-Key derived from `(runId, nodeId, to[], subject, text, html)` — same run + node + payload → same key across replays
- `fallbackOnFailure: true` permits host-side provider fallback on transient 5xx / network errors
- On terminal failure, `sent: false` + `error` populated (workflow authors branch on the boolean)

## `slack-message`

```json
{
  "config": { "channel": "C0123456789", "workspace": "primary" },
  "inputs": {
    "text": "Deploy complete: v1.4.2",
    "blocks": [{ "type": "section", "text": { "type": "mrkdwn", "text": "*Deploy complete*" } }],
    "threadTs": "1715353200.123456"
  }
}
// outputs: { posted, ts, channel, idempotencyKey }
```

Behavior:
- Posts as host's bot user by default; `asUser` field overrides (requires `chat:write:user` OAuth scope)
- Thread-reply via `threadTs`; `broadcast: true` to also surface in channel
- Channel by ID (`C0123456789`) preferred; name (`#general`) auto-resolves via host
- Idempotency-Key derived from `(runId, nodeId, channel, text, blocks, threadTs)`
- `posted: false` + `error` (Slack error code like `channel_not_found`) on terminal failure

## Host contract

The pack reads `ctx.email.send` + `ctx.slack.postMessage` from the node context. Per `spec/v1/capabilities.md`, hosts advertising these surfaces MUST expose:

```typescript
ctx.email.send({
  from, to, cc?, bcc?, subject, text?, html?, replyTo?,
  provider?, fallbackOnFailure?, idempotencyKey
}) → Promise<{ sent: boolean, messageId, provider, error? }>

ctx.slack.postMessage({
  channel, text, blocks?, threadTs?, broadcast?,
  workspace?, asUser?, idempotencyKey
}) → Promise<{ ok: boolean, ts, channel, error? }>
```

Hosts that don't expose these throw `host_capability_missing` at runtime. (Workflow-register-time refusal via `peerDependencies` is the preferred path; runtime check is defense-in-depth.)

## See also

- [`spec/v1/capabilities.md`](../../spec/v1/capabilities.md) — host integration advertisement
- [`spec/v1/replay.md`](../../spec/v1/replay.md) §"Replay determinism"
- [`spec/v1/idempotency.md`](../../spec/v1/idempotency.md) — Layer-1 + Layer-2 cost-once contract
- [`docs/PACKS-MVP-PLAN.md`](../../docs/PACKS-MVP-PLAN.md) — Phase 1 catalog
