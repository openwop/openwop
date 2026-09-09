# OpenWOP Spec v1 — Durable Trigger + Channel Bridge

> **Status: Stable · v1.x — reached `Accepted` via [RFC 0083](../../RFCS/0083-durable-trigger-and-channel-bridge-profile.md) (2026-05-31).** Additive v1.x extension — not part of the v1.0 conformance gate. Lands the `triggerBridge` capability + the opt-in `webhooks.durable` mode, the `TriggerSubscription` record + four-state machine, the content-free `trigger.subscription.state.changed` / `trigger.delivery.attempted` events, and the derived `openwop-trigger-bridge` profile. The behavioral delivery scenario, the subscription-management OpenAPI surface, and the reference-host durable-delivery implementation land at `Active → Accepted`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

openwop has the _pieces_ of durable inbound work — scheduling (RFC 0052), dead-letter sinks (RFC 0053), a queue bus (RFC 0017), webhooks (`webhooks.md`), cross-host causation (RFC 0040), and 15 trigger node shapes (`core.openwop.triggers`) — but **no uniform contract that ties them together**. Webhooks are _signed but best-effort_ (a circuit breaker, no durable retry); trigger fan-out is not wired; there is no subscription state machine, no delivery-attempt/dedup model, and no explicit trigger→run causation. An operator can't see "this subscription is failing / dead-lettered" and a client can't reason about at-least-once inbound delivery portably.

This document composes those primitives into one **profile**, additively. It changes no existing primitive — the best-effort webhook contract is preserved as the default; durability is a strictly additional opt-in.

## §A — The `triggerBridge` capability + opt-in durable webhooks

A host advertises `capabilities.triggerBridge` (`supported` + optional `subscriptionStates`/`dedup`/`retryPolicy`/`sources`). Webhook durability is the additive opt-in `capabilities.webhooks.durable`: absent or `false` ⇒ the existing `webhooks.md` best-effort contract (circuit breaker, no durable retry) is **unchanged**; `true` ⇒ webhook delivery participates in the §C durable model. The best-effort default is **not** relaxed.

## §B — Subscription states

A [`TriggerSubscription`](../../schemas/trigger-subscription.schema.json) is a durable record (a webhook registration, a schedule, a queue consumer) with a standardized `state`:

| State           | Meaning                                                                      | Entered by                |
| --------------- | ---------------------------------------------------------------------------- | ------------------------- |
| `active`        | accepting + delivering inbound events                                        | create / resume           |
| `paused`        | retained but not delivering (operator-held)                                  | pause                     |
| `failed`        | delivery failing past policy (the `webhooks.md` circuit-breaker generalized) | repeated delivery failure |
| `dead-lettered` | terminal failure; deliveries routed to the RFC 0053 sink                     | retry exhaustion          |

The record carries `subscriptionId`, `source`, `state`, `dedupEnabled`, the `retryPolicy`, and (for webhooks) the existing `(webhookId, secretFingerprint)` register keys — **unchanged**, with the state machine layered over them. `failed` → `dead-lettered` reuses RFC 0053's `deadLetter` sink + `retentionDays`.

## §C — Delivery model: attempts, dedup, retry, causation

When an inbound event arrives on an `active` subscription, the host:

1. **De-duplicates** by `dedupKey` (a caller- or host-derived stable key). When `triggerBridge.dedup` is advertised, a repeat `dedupKey` within the retention window MUST be a no-op returning the prior `runId` — at-least-once becomes effectively-once (the `idempotency.md` Layer-1 model applied to inbound triggers; dedup retention reuses the Layer-1 ≥24h floor with an optional override).
2. **Attempts delivery**, recording each attempt; on failure, retries per `retryPolicy` (backoff, `maxAttempts`); on exhaustion, transitions the subscription/delivery to `dead-lettered` (RFC 0053). For `webhooks.durable: true`, this replaces the best-effort circuit-breaker-then-drop.
3. **Links causation:** the run started by a successful delivery MUST carry the delivery's id as `causationId` on its `run.started` (reusing RFC 0040's `causationId` + optional `causationHostId` for cross-host inbound), so "which delivery (and which attempt) started this run" is answerable via the existing `/ancestry` endpoint. A `dead-lettered` delivery starts no run; the `trigger.delivery.attempted { outcome: "dead-lettered" }` event is the terminal record (no `runId`) and the RFC 0053 sink holds the delivery.

Two **content-free** events ([`run-event-payloads.schema.json`](../../schemas/run-event-payloads.schema.json)):

| Event                                | Payload (content-free)                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `trigger.subscription.state.changed` | `{ subscriptionId, source, fromState, toState, reason? }`                                          |
| `trigger.delivery.attempted`         | `{ subscriptionId, dedupKey, attempt, outcome: "delivered"\|"retrying"\|"dead-lettered", runId? }` |

Neither carries the inbound payload, headers, or credential material (SR-1) — only the subscription id, dedup key, attempt counter, outcome, and the resulting `runId`. Content-freeness MUSTs: `state.changed.reason` is a **closed enum** (`retry-exhausted`/`operator-paused`/`signature-invalid`/`backpressure`/`source-removed`/`provenance-unevaluable`) — a free-form reason would let a host spill an inbound URL/header into it; `delivery.attempted.dedupKey` MUST be a **host-opaque** key (e.g. `hash(subscriptionId + inbound-event-id)`) that does NOT embed inbound body/path/header content in cleartext; and a `TriggerSubscription.secretFingerprint` MUST be a **salted/host-keyed, truncated** one-way digest (≤32 chars, never a raw secret or a full unsalted `SHA256(secret)` — a brute-force oracle). A source listed in `capabilities.triggerBridge.sources[]` MUST actually be driven through the four-state machine + emit the two `trigger.*` events (no over-claiming a feature that isn't a durable subscription).

## §D — The `openwop-trigger-bridge` profile

A derived profile (`profiles.md` §`openwop-trigger-bridge`) — a predicate over discovery, not a wire field. A host satisfies it when it advertises `triggerBridge.supported`, has a `deadLetter` sink for exhausted deliveries, and has at least one durable inbound source (`queueBus`, `webhooks.durable`, or `scheduling`). The OR is intentional — a queue-only durable-inbound host is legitimately in the profile. The derivation lands in `conformance/src/lib/profiles.ts`.

## §E — Channels stay extensions (the Non-Goal, made explicit)

This document does **not** standardize Slack/Discord/email/SMS message formats. A vendor channel connector (`vendor.slack.*` nodes, the CLI relay-gateway) stays a host/vendor extension; to participate in the profile it MUST _bridge into a uniform trigger subscription_ — register a `TriggerSubscription`, emit the §C delivery events, and set the trigger→run `causationId`. The channel's _wire format_ is its own; its _bridge_ is openwop's.

## §F — External-event ingestion (RFC 0099)

> **Status: additive over §A–§E (2026-06-14, [RFC 0099](../../RFCS/0099-external-event-trigger-ingestion.md) `Active`).** Extends the bridge so the `webhook` / `email` / `form` sources can deliver an **externally-originated** event → start a run. Schedule + queue + in-app ingestion (§A–§E) is unchanged. Gated on `capabilities.triggerBridge.ingestion`; a host that omits it externally-ingests nothing (today's behavior).

### §F.1 — The `TriggerEvent` envelope

When an external event is delivered to an `active` subscription and starts a run, the host normalizes it into a **`TriggerEvent`** (`trigger-event.schema.json`) and hands it to the run as `ctx.triggerData`. This is an **in-run** payload — it MUST NOT appear on the durable event log; the `trigger.delivery.attempted` event stays content-free (§C, generalized). A `TriggerEvent` MUST carry exactly the per-source sub-object matching its `source` and MUST NOT carry the others. `contentTrust` MUST be `"untrusted"`: content reaching an LLM node MUST be wrapped per `threat-model-prompt-injection.md` §UNTRUSTED, and a `TriggerEvent` MUST NOT directly advance a HITL approval gate (the `prompt-injection-mcp-no-approval` invariant generalizes — an external sender cannot vote on the host's approvals). `webhook.headers` MUST be a host-curated allowlist; the host MUST NOT pass through `Authorization`, `Cookie`, `Proxy-Authorization`, or any header carrying credential material. An attachment/file is handed to the run as an `AttachmentRef.ref` — a host-internal opaque handle, NEVER an external URL the run is expected to fetch itself (§F.4).

### §F.2 — The subscription-registration contract

An external-event subscription is created with a **`TriggerSubscriptionRegistration`** request (`trigger-subscription-registration.schema.json`), served by the additive `POST /v1/trigger-subscriptions`. This is the portable create surface RFC 0083 UQ1 left per-source. It binds a `source` to a `workflowId` (which MUST resolve under the caller's RFC 0048 owner triple — a registration MUST NOT bind a workflow the caller cannot start, RFC 0049) with a `dedupEnabled` config and a `verification` policy. The host MUST verify per the `verification.mode` BEFORE delivery and stamp `TriggerEvent.verified`; an event failing a `required` verification MUST NOT start a run — it transitions `trigger.delivery.attempted{outcome:'dead-lettered'}` with `trigger.subscription.state.changed.reason:'signature-invalid'`. The **response** carries the created `TriggerSubscription` (§B) plus a source-specific `binding`: for `webhook`, `{ ingestUrl, secretFingerprint }`; for `email`, `{ ingestAddress }`; for `form`, `{ ingestUrl }`. The binding secret/URL is returned **once** at creation — re-reading the subscription returns the fingerprint, never the secret (SR-1).

### §F.3 — The `triggerBridge.ingestion` capability

A host advertises `capabilities.triggerBridge.ingestion` (`externalSources[]` + optional `maxBodyBytes` / `verification[]` / `registrationEndpoint`). `externalSources[]` is the honesty gate: a source listed there MUST actually accept an externally-originated event, normalize it to a `TriggerEvent` (§F.1), and start a run. A consumer MUST tolerate any subset; absent `ingestion` ⇒ the host does not externally-ingest.

### §F.4 — SSRF + replay safety

The external-event ingestion path is a network ingress and a replay-injection vector. Two SECURITY invariants (`SECURITY/invariants.yaml`):

- **`trigger-ingestion-ssrf`** — ANY host-side fetch the ingestion path performs (webhook verification callback, email-attachment resolution, form file-upload retrieval) MUST go through the RFC 0076 §B SSRF guard (`assertPublicUrl` / `httpClient.safeFetch`): no fetch to a private/link-local/loopback address, with the `maxResponseBodyBytes` cap. The host MUST NOT hand the run an external URL to fetch itself — `AttachmentRef.ref` is a host-internal handle.
- **`trigger-ingestion-content-redaction`** — the inbound body, headers, email content, and form fields MUST NOT appear on any `run.*` / `trigger.*` durable event payload (§C content-freeness, generalized to external sources). The content lives ONLY in `ctx.triggerData` (the in-run `TriggerEvent`, never event-logged) and the run's own variables (SR-1 redaction applies). `dedupKey` MUST be host-opaque and MUST NOT embed inbound body/header content in cleartext.

**Replay determinism.** A delivered `TriggerEvent` is cached in the run's start payload (the run's input snapshot), exactly as RFC 0006 §C requires for nondeterministic inputs. At replay the host MUST replay the cached `TriggerEvent`, MUST NOT re-accept or re-fetch the external event, and a re-delivery of the same `dedupKey` within the retention window is a no-op returning the prior `runId` (§C-1).

### §F.5 — Streaming & CDC sources (RFC 0127)

> **Status: additive over §F (2026-07-06, [RFC 0127](../../RFCS/0127-streaming-and-cdc-trigger-sources.md) `Active`).** Two further externally-originated sources: **`stream`** (a message consumed from a streaming broker — Kafka / Kinesis / Pub-Sub) and **`change`** (a change-data-capture record from a warehouse/database changelog). Both are OPTIONAL: a host that consumes neither omits them from `sources[]` / `ingestion.externalSources[]` (the §D "any one durable source" floor is unchanged).

Both sources reuse §F.1–§F.4 verbatim — the `TriggerEvent` envelope, the SSRF guard, the
content-free `trigger.*` events, and the §C-1 ≥24h dedup floor; only the `source` vocabulary and
two per-source sub-objects grow:

- A `stream` event carries a `stream` sub-object (`topic` / `partition` / `offset` / `key` /
  `message`); its dedup key SHOULD derive from `(topic, partition, offset)` and MUST be stable
  across redelivery of the same broker message, however derived.
- A `change` event carries a `change` sub-object in which **`op` (`"insert" | "update" |
  "delete"`) is REQUIRED** — one `change` source with an operation discriminator, not per-verb
  sources (RFC 0127 resolved Q1). Its dedup key SHOULD derive from `(table, changelog-id)`.
- **Direction inverts:** unlike `webhook`/`email`/`form`, the host is the *consumer* — there is
  no inbound ingest URL. A §F.2 registration for `stream`/`change` returns an **empty `binding`**
  (`{}`); the broker/warehouse *connection* is a credential-brokered egress (RFC 0095), never a
  wire field. Any fetch the ingestion path performs (e.g. resolving a schema-registry reference)
  MUST pass the §F.4 SSRF guard.
- **No delivery-guarantee advertisement.** The wire promises the §C-1 dedup floor, not
  at-least-once/exactly-once semantics — a `deliveryGuarantee` claim would be unfalsifiable by a
  conformance run (RFC 0127 resolved Q2).

## §G — `paused` semantics

Pausing a webhook stops delivery. Pausing a _schedule_ **skips** ticks (no catch-up); resume starts fresh (honoring the RFC 0052 §B missed-tick "skip" policy, not queue-and-replay).

## Open spec gaps

> **Absorbed into `spec/v1/gaps.json` (RFC 0174 §E.3, 2026-09-03).** The 2 row(s) this table carried are now `openwop.gap.spec.trigger-bridge.<local>` entries with a disposition and a witness class, one namespace with every RFC register (RFC 0166 §B). The table is retired; do not add rows here.

