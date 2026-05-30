# RFC 0083: Durable Trigger + Channel Bridge Profile

| Field | Value |
|---|---|
| **RFC** | 0083 |
| **Title** | Define an `openwop-trigger-bridge` profile that composes the existing scheduling (RFC 0052), dead-letter (RFC 0053), queue-bus (RFC 0017), webhook, and cross-host-causation (RFC 0040) primitives into a uniform durable inbound-work contract — standardizing trigger-subscription states (active / paused / failed / dead-lettered), a delivery-attempt + dedup-key + retry-policy model, an opt-in durable-webhook mode, and an explicit trigger-to-run causation link — while keeping individual channels (Slack / email / SMS) as host/vendor extensions |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-29 |
| **Updated** | 2026-05-30 (`Draft → Active` — steward acceptance, comment window waived per `GOVERNANCE.md` single-maintainer lazy consensus after MyndHyve (non-steward) wire-shape review; wire shapes now locked. All 5 Unresolved questions resolved as proposed: UQ1 unified `GET /v1/trigger-subscriptions` read surface + per-source management (don't move `POST /v1/webhooks`); UQ2 dedup reuses the `idempotency.md` Layer-1 ≥24h floor + optional override; UQ3 the profile accepts any one durable source (the OR is intentional — a queue-only host is legitimately in-profile); UQ4 a dead-lettered delivery's `trigger.delivery.attempted{outcome:"dead-lettered"}` is the terminal record (no run), the RFC 0053 sink holds it; UQ5 `paused` skips ticks (no catch-up), resume fresh (RFC 0052 §B missed-tick "skip"). NEW `spec/v1/trigger-bridge.md` + `schemas/trigger-subscription.schema.json` + `capabilities.{triggerBridge, webhooks.durable}` + the two content-free `trigger.*` events + the derived `openwop-trigger-bridge` profile (`profiles.md` + `profiles.ts`) + `webhooks.md` §"Durable delivery (opt-in)" + `trigger-bridge-shape.test.ts` landed. The behavioral delivery scenario, the subscription-management OpenAPI/AsyncAPI surface, and the reference-host durable-delivery implementation deferred to `Active → Accepted`.) |
| **Affects** | NEW `spec/v1/trigger-bridge.md` (the profile + the subscription/delivery contract) · NEW `schemas/trigger-subscription.schema.json` (the durable subscription record) · `schemas/run-event.schema.json` (additive `RunEventType`: `trigger.subscription.state.changed` / `trigger.delivery.attempted`) · `schemas/run-event-payloads.schema.json` (the two content-free payloads) · `schemas/capabilities.schema.json` (additive optional `triggerBridge` block + additive optional `webhooks.durable`) · `spec/v1/profiles.md` (derived `openwop-trigger-bridge` profile) · `conformance/src/lib/profiles.ts` (the derivation predicate) · `spec/v1/webhooks.md` (additive §"Durable delivery (opt-in)") · `api/openapi.yaml` (additive subscription-management + delivery-inspection endpoints) · `api/asyncapi.yaml` · `CHANGELOG.md` · `INTEROP-MATRIX.md` · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop has the *pieces* of durable inbound work — scheduling (RFC 0052), dead-letter sinks (RFC 0053), a queue bus (RFC 0017), webhooks (`webhooks.md`), cross-host causation (RFC 0040), and 15 trigger node shapes (`core.openwop.triggers`) — but **no uniform contract that ties them together**. The live platform symptom: webhooks are *signed but best-effort* (a 4-failure circuit breaker, no durable retry), trigger fan-out is *not wired*, and there is **no subscription state machine, no delivery-attempt/dedup-key model, and no explicit trigger→run causation** — so an operator can't see "this webhook subscription is failing / dead-lettered" and a client can't reason about at-least-once inbound delivery portably. This RFC **composes the existing primitives into one profile, additively**: it defines a `triggerBridge` capability + a derived **`openwop-trigger-bridge`** profile, standardizes the four **subscription states** (active / paused / failed / dead-lettered), a **delivery model** (per-attempt tracking, a `dedupKey` for at-least-once de-duplication, a `retryPolicy` with backoff, dead-letter on exhaustion reusing RFC 0053), an **opt-in durable-webhook mode** (`webhooks.durable: true` — leaving the existing best-effort default unchanged), and an explicit **trigger-to-run causation** link (the delivered trigger's `causationId` on the resulting `run.started`, reusing RFC 0040). Individual channels (Slack / Discord / email / SMS) **stay host/vendor extensions** per the Non-Goals — only their *bridge into an openwop run* is uniform. No existing primitive is changed; the profile is a reading over them plus the subscription/delivery contract and the two new content-free events.

## Motivation

`docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0083" frames it: *the demo has webhooks and messaging pieces, but discovery says full trigger fan-out is not wired; agent platforms need durable inbound work from webhooks, schedules, chat messages, forms, email, and external systems.* Three concrete gaps:

1. **No subscription state machine.** A trigger subscription (a webhook registration, a schedule, a queue consumer) is either implicitly working or implicitly not — there is no advertised `active` / `paused` / `failed` / `dead-lettered` vocabulary. `webhooks.md` has a circuit-breaker that marks a subscription `failed` after 100 failures in 7 days, but that state isn't a portable, inspectable, resumable contract, and schedules/queues have no equivalent at all.
2. **Best-effort-only delivery + no dedup.** `webhooks.md` is explicitly *best-effort* (5s per-attempt timeout, circuit breaker, no durable retry). For an agent platform doing real inbound work (a webhook that must reliably start a run), there is no *durable* delivery option, no *delivery-attempt* record, and no *dedup key* to make at-least-once delivery idempotent (`idempotency.md` covers HTTP request idempotency + activity invocation idempotency, but not *inbound trigger* de-duplication).
3. **No trigger→run causation.** When a trigger fires a run, nothing on the wire links the run back to the subscription/delivery that caused it. RFC 0040 standardized *cross-host* causation (`causationId` + `causationHostId` + `/ancestry`) but no one wired the *trigger→run* edge, so "which webhook delivery started this run, and was it a retry?" is unanswerable.

The spec is the right place because *durable inbound work* is a cross-host interop + operability concern: a Mission Control showing inbound trigger health, a builder with real trigger nodes, and a client depending on at-least-once webhook delivery all need one agreed contract. This is a **profile** (per `profiles.md` §"Adding a profile") — it composes existing capabilities into a named, derivable target rather than inventing a parallel trigger stack. The per-channel connectors (Slack/email) stay vendor extensions (the explicit Non-Goal); the *bridge* is what this standardizes.

## Proposal

### §A — The `triggerBridge` capability + opt-in durable webhooks

```jsonc
"triggerBridge": {
  "supported": true,
  "subscriptionStates": ["active","paused","failed","dead-lettered"],
  "dedup": true,                          // host de-duplicates by dedupKey
  "retryPolicy": { "maxAttempts": 8, "backoff": "exponential" },
  "sources": ["webhook","schedule","queue","email","form"]   // which trigger sources bridge uniformly
},
"webhooks": { "supported": true, "signatureAlgorithms": ["v1"], "durable": true }  // NEW optional `durable`
```

`webhooks.durable` is an **additive opt-in**: absent or `false` ⇒ the existing `webhooks.md` best-effort contract (circuit breaker, no durable retry) is unchanged; `true` ⇒ webhook delivery participates in the §C durable model (subscription states + retry policy + dead-letter). The best-effort default is **not** relaxed — durability is a strictly additional mode a host opts into.

### §B — Subscription states (standardized, `trigger-subscription.schema.json`)

A **trigger subscription** is a durable record (a webhook registration, a schedule, a queue consumer) with a standardized `state`:

| State | Meaning | Entered by |
|---|---|---|
| `active` | accepting + delivering inbound events | create / resume |
| `paused` | retained but not delivering (operator-held) | pause |
| `failed` | delivery failing past policy (the `webhooks.md` circuit-breaker generalized) | repeated delivery failure |
| `dead-lettered` | terminal failure; deliveries routed to the RFC 0053 sink | retry exhaustion |

The record carries `subscriptionId`, `source` (`webhook`/`schedule`/`queue`/…), `state`, `dedupEnabled`, the `retryPolicy`, and (for webhooks) the existing `(webhookId, secretFingerprint)` register keys (`webhooks.md`) — **unchanged**, with the state machine layered over them. `failed` → `dead-lettered` reuses RFC 0053's `deadLetter` sink + `retentionDays` (a dead-lettered *delivery* is fork/inspect-eligible exactly like a dead-lettered run).

### §C — Delivery model: attempts, dedup, retry, causation

When an inbound event arrives on an `active` subscription, the host:

1. **De-duplicates** by `dedupKey` (a caller- or host-derived stable key; when `triggerBridge.dedup` is advertised, a repeat `dedupKey` within the retention window is a no-op returning the prior `runId` — at-least-once becomes effectively-once, the `idempotency.md` Layer-1 model applied to inbound triggers).
2. **Attempts delivery**, recording each attempt; on failure, retries per `retryPolicy` (backoff, `maxAttempts`); on exhaustion, transitions the subscription/delivery to `dead-lettered` (RFC 0053) — for `webhooks.durable: true`, this replaces the best-effort circuit-breaker-then-drop.
3. **Links causation:** the run started by a successful delivery carries the delivery's id as `causationId` on its `run.started` (reusing RFC 0040's `causationId` + optional `causationHostId` for cross-host inbound), so "which delivery (and which attempt) started this run" is answerable via the existing `/ancestry` endpoint.

Two **content-free** events (additive `RunEventType`):

| Event | Payload (content-free) |
|---|---|
| `trigger.subscription.state.changed` | `{ subscriptionId, source, fromState, toState, reason? }` |
| `trigger.delivery.attempted` | `{ subscriptionId, dedupKey, attempt, outcome: "delivered"\|"retrying"\|"dead-lettered", runId? }` |

Neither carries the inbound payload, headers, or credential material (SR-1) — only the subscription id, dedup key, attempt counter, outcome, and the resulting `runId`.

### §D — The `openwop-trigger-bridge` profile (derived; `profiles.md`)

A derived profile (per `profiles.md` — a predicate over discovery, not a wire field). Its predicate composes the constituent primitives:

```
openwop-trigger-bridge(c) :=
     openwop-core(c)
  && c.triggerBridge != null && c.triggerBridge.supported === true
  && c.deadLetter != null && c.deadLetter.supported === true          // RFC 0053 sink for exhaustion
  && (   (c.queueBus != null && c.queueBus.supported === true)        // a durable inbound source…
       || (c.webhooks != null && c.webhooks.durable === true)
       || (c.scheduling != null && c.scheduling.supported === true) )
```

A host in the profile advertises the bridge, has a dead-letter sink for exhausted deliveries, and has at least one durable inbound source (queue, durable webhooks, or scheduling). The runtime conformance scenarios (gated on the profile tag) verify the state machine + dedup + causation behavior; the predicate proves the host advertises the contract. The derivation lands in `conformance/src/lib/profiles.ts` in the same PR as the §Active wire surface (the `profiles.md` §"Adding a profile" process).

### §E — Channels stay extensions (the Non-Goal, made explicit)

Per the recommendation's Non-Goals: this RFC does **not** standardize Slack/Discord/email/SMS message formats. A vendor channel connector (e.g. `vendor.slack.*` nodes, the CLI relay-gateway) remains a host/vendor extension; what it MUST do to participate in the profile is *bridge into a uniform trigger subscription* — register a `trigger-subscription`, emit the §C delivery events, and set the trigger→run `causationId`. The channel's *wire format* is its own; its *bridge* is openwop's.

### Examples

**Positive.** A host advertising `triggerBridge.supported`, `deadLetter.supported`, `webhooks.durable:true` → satisfies `openwop-trigger-bridge`. An inbound webhook with `dedupKey:"evt-9f3"` on an `active` subscription → `trigger.delivery.attempted{attempt:1,outcome:"delivered",runId:"run_x"}`, and `run_x`'s `run.started` carries `causationId` = the delivery id; a duplicate `evt-9f3` within retention → no-op returning `run_x` (dedup). A flapping endpoint → attempts 1–8 emit `trigger.delivery.attempted{outcome:"retrying"}`, then `trigger.subscription.state.changed{toState:"dead-lettered"}` + a final `{outcome:"dead-lettered"}`, the delivery landing in the RFC 0053 sink (inspectable for `retentionDays`).

**Negative (profile).** A host with `triggerBridge.supported` but no `deadLetter` → fails the predicate (no sink for exhaustion). **Negative (best-effort unchanged).** A host omitting `webhooks.durable` → its webhooks behave exactly as `webhooks.md` best-effort today (no regression). **Negative (schema).** A `trigger.delivery.attempted` payload carrying the inbound body fails validation (`additionalProperties:false`, content-free).

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). A new subscription-record schema; a new optional `triggerBridge` capability block; an additive optional `webhooks.durable` flag (absent ⇒ the existing best-effort contract, **explicitly unchanged** — §A); two additive content-free `RunEventType` values (consumers tolerate unknowns per §2.1); a derived profile (additive per `profiles.md` §"Adding a profile" — a new profile MUST NOT cause a previously-passing host to fail an existing profile, and this one doesn't); additive subscription-management endpoints; additive §sections in `webhooks.md` + `profiles.md`. **No existing primitive (RFC 0052/0053/0017, `webhooks.md`, RFC 0040) is changed — they are composed, not modified; the best-effort webhook contract is preserved as the default; no `MUST` is relaxed.** The trigger→run `causationId` reuses RFC 0040's existing field (no new envelope id-space). No conformance pass is invalidated. Adding the two event types does not bump `eventLogSchemaVersion` (RFC 0008 §K / 0058 precedent).

## Conformance

- **New scenarios:**
  - **`trigger-bridge-shape.test.ts`** (always-on, server-free): the subscription record + the two `trigger.*` payloads validate; the four-state vocabulary is stable; the profile predicate derives correctly on representative payloads; negatives (content-bearing payload; profile predicate false when `deadLetter` absent).
  - **`trigger-bridge-delivery.test.ts`** (gated on the `openwop-trigger-bridge` profile, via `describe.runIf`): an `active` subscription de-duplicates by `dedupKey`, retries per policy, transitions to `dead-lettered` on exhaustion (RFC 0053 sink), and the delivered run's `run.started` carries the delivery `causationId` (resolvable via `/ancestry`). Soft-skips when the profile is unsatisfied.
- **Profile gating** per `profiles.md` (the scenarios tag `openwop-trigger-bridge`; the runner's `--profile` filter applies) + `conformance/coverage.md`. The derivation lands in `profiles.ts`.
- **Reference host.** Deferred (files at `Draft`). The capability + profile predicate + subscription schema + events ship at `Draft → Active`; the delivery scenario soft-skips until a reference host wires durable delivery + the state machine.

## Alternatives considered

1. **A net-new unified trigger stack (one `Trigger` primitive replacing scheduling/webhooks/queue).** Rejected — it would duplicate three Accepted RFCs (0052/0053/0017) + `webhooks.md` and break every host that implements them. The recommendation explicitly says *compose existing primitives into a profile*; that's what a profile is for.
2. **Make webhook durability mandatory (change `webhooks.md` best-effort → durable).** Rejected — that's a breaking change to an existing `MUST`-bearing contract (`COMPATIBILITY.md` §2.2) and invalidates every current webhook host's conformance. The opt-in `webhooks.durable` (§A) gets durability additively.
3. **Reuse `idempotency.md` Layer-1 keys as the dedup key (no new `dedupKey`).** Partially adopted — the dedup *model* is the `idempotency.md` Layer-1 model (§C-1), but the *inbound trigger* dedup key is caller/source-derived (a webhook event id, a message id), distinct from an HTTP `Idempotency-Key` header on a client request. The RFC reuses the *semantics*, names a trigger-scoped key.
4. **Standardize the channel formats too (Slack/email payloads).** Rejected — the explicit Non-Goal. Channels stay vendor extensions; only the bridge is uniform (§E).
5. **Do nothing.** Rejected — Wave 4 "make it operational" needs durable triggers + signed durable webhooks; the live platform's "trigger fan-out not wired" is a real gap, and at-least-once inbound delivery has no portable contract today.

## Unresolved questions

**All five resolved at `Draft → Active` (2026-05-30) as proposed below — recorded in `Updated:`.** Retained for the rationale trail:

1. **Subscription management as endpoints vs nodes.** Webhooks register via `POST /v1/webhooks` (`webhooks.md`); schedules/queues are trigger *nodes*. Does the subscription state machine get a unified `GET/PATCH /v1/trigger-subscriptions/{id}` surface, or does each source keep its own management path with the *state vocabulary* unified? Proposed: a unified read surface (`GET /v1/trigger-subscriptions`) + per-source management (don't move `POST /v1/webhooks`). Confirm against `rest-endpoints.md`.
2. **`dedupKey` retention window.** Tie to `idempotency.md` Layer-1 retention (≥24h), or a separate `triggerBridge.dedupRetention`? Proposed: reuse the Layer-1 ≥24h floor with an optional override. Confirm.
3. **Profile predicate strictness.** Should the profile require `webhooks.durable` specifically, or accept any one durable source (queue / durable-webhooks / scheduling)? Proposed: any one (§D) — a queue-only durable-inbound host is legitimately in the profile. Confirm the OR is right.
4. **Causation on dead-lettered (no run).** A dead-lettered delivery starts no run — where does its causation chain terminate? Proposed: the `trigger.delivery.attempted{outcome:"dead-lettered"}` event is the terminal record (no `runId`); the RFC 0053 sink holds the delivery. Confirm.
5. **`paused` semantics for schedules vs webhooks.** Pausing a webhook stops delivery; pausing a *schedule* — does it skip ticks or queue them (the RFC 0052 missed-tick policy)? Proposed: `paused` skips (no catch-up); resume starts fresh. Confirm against RFC 0052 §B missed-tick policy.

## Implementation notes (non-normative)

- **Sequencing.** Pure composition over RFC 0052 (Accepted — scheduling), RFC 0053 (Accepted — dead-letter), RFC 0017 (Accepted — queue bus), `webhooks.md` (the durable opt-in), RFC 0040 (Accepted — causation), `idempotency.md` (the dedup model), and the `core.openwop.triggers` pack (15 trigger shapes). First of Wave 4, independent of RFC 0084. Adds a subscription schema + two content-free events + a capability + a derived profile; changes no existing primitive.
- **Reference host.** Wiring is: a durable subscription store with the four-state machine, a delivery loop with dedup + retry + dead-letter routing, the trigger→run `causationId` stamp, and the durable-webhook mode (the existing best-effort path stays for non-durable hosts). The `core.openwop.triggers` nodes forward `ctx.triggerData` as today; the bridge wraps them.
- **Demo impact** (out of scope): real trigger nodes (webhook/schedule/form/chat/email) in the builder; Mission Control inbound trigger health + failed-delivery view.
- **Expected effort:** S–M for the schema + profile predicate + capability + shape conformance; M–L for the reference durable-delivery + state-machine implementation.

## Acceptance criteria

Checklist for `Active → Accepted` (files at `Draft`):

- [ ] `spec/v1/trigger-bridge.md`: §A capability + durable-webhook opt-in, §B subscription states, §C delivery model (attempts/dedup/retry/causation), §D profile predicate, §E channels-stay-extensions.
- [ ] `trigger-subscription.schema.json`; additive `triggerBridge` + `webhooks.durable` on `capabilities.schema.json`; two `trigger.*` RunEventTypes + payloads; `webhooks.md` §"Durable delivery (opt-in)".
- [ ] `openwop-trigger-bridge` predicate in `spec/v1/profiles.md` + `conformance/src/lib/profiles.ts`.
- [ ] Subscription read surface + delivery inspection in `openapi.yaml`; channels in `asyncapi.yaml`.
- [ ] Conformance: `trigger-bridge-shape.test.ts` (always-on) + `trigger-bridge-delivery.test.ts` (profile-gated) + fixture + `coverage.md`.
- [ ] CHANGELOG entry + INTEROP-MATRIX row (the new profile column).
- [ ] All five Unresolved questions resolved (recorded in `Updated:`).
- [ ] Reference host wires durable delivery + the state machine + passes the profile-gated scenario, OR the RFC explicitly defers reference-host implementation.

## References

- `docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0083" + §Non-Goals — the source recommendation + the channels-stay-extensions constraint.
- [`RFCS/0052-scheduling-and-time-based-triggers.md`](./0052-scheduling-and-time-based-triggers.md) — the `scheduling` capability (advertised at the document root per RFC 0073; the RFC's prose calls it `host.scheduling`) + the missed-tick policy (UQ #5).
- [`RFCS/0053-dead-letter-routing-and-failure-sinks.md`](./0053-dead-letter-routing-and-failure-sinks.md) — the `deadLetter` sink exhausted deliveries route to (§B/§C).
- [`RFCS/0017-host-queue-bus-capability.md`](./0017-host-queue-bus-capability.md) — the `queueBus` capability (a durable inbound source, §D) + cross-tenant isolation.
- [`RFCS/0040-multi-agent-cross-host-causation.md`](./0040-multi-agent-cross-host-causation.md) — the `causationId`/`causationHostId` + `/ancestry` the trigger→run edge reuses (§C-3).
- [`spec/v1/webhooks.md`](../spec/v1/webhooks.md) — the best-effort delivery contract the `webhooks.durable` opt-in extends (preserved as default).
- [`spec/v1/idempotency.md`](../spec/v1/idempotency.md) — the Layer-1 dedup model the `dedupKey` reuses (§C-1, UQ #2).
- [`spec/v1/profiles.md`](../spec/v1/profiles.md) §"Adding a profile" — the derived-profile machinery + the append-only rule.
- [`COMPATIBILITY.md`](../COMPATIBILITY.md) §2.1 — additive-change discipline.
