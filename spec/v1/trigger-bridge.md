# openwop Spec v1 — Durable Trigger + Channel Bridge

> **Status: DRAFT v1.x (filed via [RFC 0083](../../RFCS/0083-durable-trigger-and-channel-bridge-profile.md), 2026-05-30).** Additive v1.x extension — not part of the v1.0 conformance gate. Lands the `triggerBridge` capability + the opt-in `webhooks.durable` mode, the `TriggerSubscription` record + four-state machine, the content-free `trigger.subscription.state.changed` / `trigger.delivery.attempted` events, and the derived `openwop-trigger-bridge` profile. The behavioral delivery scenario, the subscription-management OpenAPI surface, and the reference-host durable-delivery implementation land at `Active → Accepted`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

openwop has the *pieces* of durable inbound work — scheduling (RFC 0052), dead-letter sinks (RFC 0053), a queue bus (RFC 0017), webhooks (`webhooks.md`), cross-host causation (RFC 0040), and 15 trigger node shapes (`core.openwop.triggers`) — but **no uniform contract that ties them together**. Webhooks are *signed but best-effort* (a circuit breaker, no durable retry); trigger fan-out is not wired; there is no subscription state machine, no delivery-attempt/dedup model, and no explicit trigger→run causation. An operator can't see "this subscription is failing / dead-lettered" and a client can't reason about at-least-once inbound delivery portably.

This document composes those primitives into one **profile**, additively. It changes no existing primitive — the best-effort webhook contract is preserved as the default; durability is a strictly additional opt-in.

## §A — The `triggerBridge` capability + opt-in durable webhooks

A host advertises `capabilities.triggerBridge` (`supported` + optional `subscriptionStates`/`dedup`/`retryPolicy`/`sources`). Webhook durability is the additive opt-in `capabilities.webhooks.durable`: absent or `false` ⇒ the existing `webhooks.md` best-effort contract (circuit breaker, no durable retry) is **unchanged**; `true` ⇒ webhook delivery participates in the §C durable model. The best-effort default is **not** relaxed.

## §B — Subscription states

A [`TriggerSubscription`](../../schemas/trigger-subscription.schema.json) is a durable record (a webhook registration, a schedule, a queue consumer) with a standardized `state`:

| State | Meaning | Entered by |
|---|---|---|
| `active` | accepting + delivering inbound events | create / resume |
| `paused` | retained but not delivering (operator-held) | pause |
| `failed` | delivery failing past policy (the `webhooks.md` circuit-breaker generalized) | repeated delivery failure |
| `dead-lettered` | terminal failure; deliveries routed to the RFC 0053 sink | retry exhaustion |

The record carries `subscriptionId`, `source`, `state`, `dedupEnabled`, the `retryPolicy`, and (for webhooks) the existing `(webhookId, secretFingerprint)` register keys — **unchanged**, with the state machine layered over them. `failed` → `dead-lettered` reuses RFC 0053's `deadLetter` sink + `retentionDays`.

## §C — Delivery model: attempts, dedup, retry, causation

When an inbound event arrives on an `active` subscription, the host:

1. **De-duplicates** by `dedupKey` (a caller- or host-derived stable key). When `triggerBridge.dedup` is advertised, a repeat `dedupKey` within the retention window MUST be a no-op returning the prior `runId` — at-least-once becomes effectively-once (the `idempotency.md` Layer-1 model applied to inbound triggers; dedup retention reuses the Layer-1 ≥24h floor with an optional override).
2. **Attempts delivery**, recording each attempt; on failure, retries per `retryPolicy` (backoff, `maxAttempts`); on exhaustion, transitions the subscription/delivery to `dead-lettered` (RFC 0053). For `webhooks.durable: true`, this replaces the best-effort circuit-breaker-then-drop.
3. **Links causation:** the run started by a successful delivery MUST carry the delivery's id as `causationId` on its `run.started` (reusing RFC 0040's `causationId` + optional `causationHostId` for cross-host inbound), so "which delivery (and which attempt) started this run" is answerable via the existing `/ancestry` endpoint. A `dead-lettered` delivery starts no run; the `trigger.delivery.attempted { outcome: "dead-lettered" }` event is the terminal record (no `runId`) and the RFC 0053 sink holds the delivery.

Two **content-free** events ([`run-event-payloads.schema.json`](../../schemas/run-event-payloads.schema.json)):

| Event | Payload (content-free) |
|---|---|
| `trigger.subscription.state.changed` | `{ subscriptionId, source, fromState, toState, reason? }` |
| `trigger.delivery.attempted` | `{ subscriptionId, dedupKey, attempt, outcome: "delivered"\|"retrying"\|"dead-lettered", runId? }` |

Neither carries the inbound payload, headers, or credential material (SR-1) — only the subscription id, dedup key, attempt counter, outcome, and the resulting `runId`.

## §D — The `openwop-trigger-bridge` profile

A derived profile (`profiles.md` §`openwop-trigger-bridge`) — a predicate over discovery, not a wire field. A host satisfies it when it advertises `triggerBridge.supported`, has a `deadLetter` sink for exhausted deliveries, and has at least one durable inbound source (`queueBus`, `webhooks.durable`, or `scheduling`). The OR is intentional — a queue-only durable-inbound host is legitimately in the profile. The derivation lands in `conformance/src/lib/profiles.ts`.

## §E — Channels stay extensions (the Non-Goal, made explicit)

This document does **not** standardize Slack/Discord/email/SMS message formats. A vendor channel connector (`vendor.slack.*` nodes, the CLI relay-gateway) stays a host/vendor extension; to participate in the profile it MUST *bridge into a uniform trigger subscription* — register a `TriggerSubscription`, emit the §C delivery events, and set the trigger→run `causationId`. The channel's *wire format* is its own; its *bridge* is openwop's.

## §F — `paused` semantics

Pausing a webhook stops delivery. Pausing a *schedule* **skips** ticks (no catch-up); resume starts fresh (honoring the RFC 0052 §B missed-tick "skip" policy, not queue-and-replay).

## Open spec gaps

- The behavioral delivery scenario (dedup → retry → dead-letter → causation), the `GET /v1/trigger-subscriptions` read surface + per-source management in OpenAPI, and the reference-host durable-delivery state machine land at `Active → Accepted`; the always-on `trigger-bridge-shape.test.ts` + the profile predicate + the subscription schema + the two events ship now.
- A net-new unified `Trigger` primitive was rejected (it would duplicate RFC 0052/0053/0017) — this is a *profile* that composes them.
