# RFC 0230: Inbound webhook ingest contract — Standard Webhooks signing, `webhook-id` identity, response shape

| Field             | Value |
| ----------------- | ----- |
| **RFC**           | 0230 |
| **Title**         | Inbound webhook ingest contract |
| **Status**        | `Active` |
| **Author(s)**     | openwop-app steward session (on behalf of the maintainer) |
| **Created**       | 2026-09-30 |
| **Updated**       | 2026-09-30 — **`Draft → Active` by STEWARD OVERRIDE of RFC 0147 §A.6** (comment window waived, not run; register row `not-reviewed`). §A.6 applies on four counts: idempotency (`webhook-id` dedup), external effects (an ingest starts a run), authentication (the signature replaces an OpenWOP credential on `ingestUrl`) and a certification floor's contract (`openwop.floor.trigger-bridge-delivery`). The maintainer chose the override explicitly after that finding and the three open security questions were put to them. The evidence gate is not waived: `Accepted` still needs a host passing the §Conformance path in strict mode on a production cut, and the RFC 0156 §B review is owed. |
| **Affects**       | `spec/v1/trigger-bridge.md` §F.2 / §F.4; `spec/v2/core/webhooks.md` §Inbound triggers; `schemas/capabilities.schema.json` (`triggerBridge.ingestion`); `schemas/v2/…` capability mirror; conformance `trigger-bridge-delivery.test.ts` (public path) |
| **Compatibility** | `additive` per `COMPATIBILITY.md`: every rule binds only a host that advertises the new `inboundSigning` facet |
| **Supersedes**    | — |
| **Superseded by** | — |

> **RFC 0147 §A.6.** This RFC affects **idempotency** (inbound dedup), **external effects** (an accepted ingest starts a run), **authentication** (the signature authenticates the sender), and the contract of a **certification floor** (`openwop.floor.trigger-bridge-delivery`). It is a high-risk RFC: the full public comment window applies, and a bootstrap waiver MUST NOT shorten it. Only an explicit steward override recorded in `MAINTAINERS.md` could.

## Summary

`trigger-bridge.md` §F.2 hands a webhook subscriber a `binding.ingestUrl` and, once, a secret. It never says what a sender POSTs there, how the post is authenticated, what makes two posts the same event, or what the host answers. So no suite can drive an inbound delivery portably. Every existing scenario POSTs a host test seam instead, and `openwop.floor.trigger-bridge-delivery` is unwitnessable on any production host, which correctly withholds seams. This RFC pins the sender-facing contract for a host that opts in:

- **Signing:** Standard Webhooks signing, reusing RFC 0201's wording.
- **Authentication:** the signature authenticates the sender, with no OpenWOP credential.
- **Identity:** `webhook-id` is the inbound event identity that dedup keys on.
- **Response:** a small response shape.

## Motivation

- **Measured.** On app.openwop.dev's certification cuts (b29427fef, 2273db9c6), `openwop.floor.trigger-bridge-delivery` records `executed-fail` with "host advertises openwop-trigger-bridge but the event-log seam is absent". The host implements §B/§C. The suite has no normative way to deliver an event to it.
- **The three gaps**, each of which blocks a portable witness:
  1. **Identity.** §C-1/§F.4 dedup on a `dedupKey` = hash(subscriptionId + inbound event id), but "inbound event id" is undefined for `webhook`/`form`. Two hosts can key it differently, and a suite cannot know what makes two posts the same event.
  2. **Authentication.** §F.2 returns a secret once but does not say how a sender uses it. openwop-app's ingest route today requires an OpenWOP API credential (`runs:create`), which a third-party sender (GitHub, Stripe, a form service) does not have.
  3. **Response.** Nothing says what the ingest answers. openwop-app answers `200` / `422` with `{ outcome, runId?, reason? }`; another host may answer differently. A suite that needs the started `runId` (for causation) has nowhere normative to read it.

## Proposal

### A. Opt-in facet

A host MAY advertise `capabilities.triggerBridge.ingestion.inboundSigning`: an array of scheme ids, of which this RFC defines exactly one, `"standard-webhooks-1"`. The v2 mirror is under the `triggerBridge` record, `ingestion.inboundSigning`. Every rule below binds only a host whose `inboundSigning` lists `standard-webhooks-1`, and only for `webhook` subscriptions. `email`/`form`/`stream`/`change` are unchanged.

```diff
 "ingestion": { "type": "object", "properties": {
   "externalSources": { … },
+  "inboundSigning": {
+    "type": "array", "items": { "type": "string", "enum": ["standard-webhooks-1"] },
+    "uniqueItems": true,
+    "description": "RFC 0230. Sender-facing ingest schemes this host implements for `webhook` subscriptions."
+  },
```

### B. Registration

For a `webhook` registration on such a host, the `201` response's `binding` MUST carry `signingSecret`, a `whsec_`-prefixed Standard Webhooks secret, exactly once, beside `ingestUrl` and `secretFingerprint`. Re-reading the subscription MUST NOT return it (SR-1, unchanged). `ingestUrl` MUST be an absolute `https` URL, or a path resolvable against the discovery base.

### C. The ingest request

- **Body.** A sender POSTs the raw event body to `ingestUrl` with the three Standard Webhooks headers: `webhook-id`, `webhook-timestamp` (Unix seconds), and `webhook-signature` (space-separated `v1,<base64(HMAC-SHA256(key, "{webhook-id}.{webhook-timestamp}.{rawBody}"))>` entries, `key` = base64-decode of the secret after `whsec_`). This is RFC 0201's construction, applied inbound.
- **Authentication is the signature.** The host MUST NOT require an OpenWOP credential (bearer, API key or session) on `ingestUrl`. The route MUST be reachable by a sender holding only the secret.
- **Verification**, under the subscription's `verification.mode`:
  - `required`: a missing or invalid signature, or a `webhook-timestamp` more than 300 seconds from the host's clock, MUST NOT start a run. It is the §F.2 `signature-invalid` dead-letter (unchanged).
  - `best-effort`: the host delivers and stamps `TriggerEvent.verified` accordingly.
  - `none`: the host does not verify.
- **Identity.** The inbound event identity is `webhook-id`. It MUST match `^[A-Za-z0-9_-]{16,128}$` (RFC 0201). With `dedupEnabled`, the host MUST derive `dedupKey` from `(subscriptionId, webhook-id)`, host-opaque as §F.4 already requires. A post whose `webhook-id` repeats one already delivered within the §C-1 retention window MUST start no new run.
- **A sender cannot change a subscription's state (§C.1).** `ingestUrl` needs no OpenWOP credential, so anyone who learns it can post to it. A verification failure, a malformed post or any other ingest refusal MUST NOT transition the subscription out of `active`, and MUST NOT emit `trigger.subscription.state.changed`. Only the dead-lettered `trigger.delivery.attempted` for that post is recorded. Otherwise one unauthenticated post with a garbage signature would disable a working integration. On an opted-in host this refines §F.2's `state.changed.reason: signature-invalid`, which predates an uncredentialed ingest: that reason applies to the delivery, not to the subscription's state.

### D. The ingest response

| Outcome | Status | Body |
| --- | --- | --- |
| Delivered: a run was started | `202` | `{ "outcome": "delivered", "runId": "<id>" }` |
| Dedup no-op: `webhook-id` seen within retention | `200` | `{ "outcome": "duplicate", "runId": "<prior id>" }` (§F.4 "returning the prior runId") |
| Verification failure under `required` | `401` | the error envelope with `error: "signature_invalid"`, and no `runId`. The **delivery** is dead-lettered (§F.2); the **subscription's state MUST NOT change** (§C.1). |
| Subscription not `active` (`paused` / `dead-lettered` / `failed`) | `409` | the error envelope with `error: "subscription_not_active"` |

`runId` is tenant-bound on the v2 wire (identity.md §5). The body carries no inbound content (SR-1).

### E. v2

`spec/v2/core/webhooks.md` §Inbound triggers gains the same rules as a bulleted block under "On an `active` subscription", with the facet advertised on the v2 `triggerBridge` record.

## Compatibility

**Additive.** Every rule binds only a host advertising `inboundSigning: ["standard-webhooks-1"]`. No host advertises it today, so no existing conformance pass changes. A host that never opts in is untouched, and its `openwop.floor.trigger-bridge-delivery` stays seam-witnessed.

**Migration for openwop-app** (the only host known to serve a public ingest route), before it may advertise the facet:

1. **Authentication.** Drop the `runs:create` credential requirement on `…/ingest` in favour of signature authentication.
2. **Body.** Accept the raw body plus `webhook-*` headers in place of the wrapped `coerceIngress` body. The wrapped form MAY stay on the seam.
3. **Response.** Answer `202` / `200` / `401` / `409` per §D in place of `200` / `422`.
4. **Dedup.** Key dedup on `webhook-id`.
5. **Registration.** Return the secret as `whsec_…` under `signingSecret` (it already returns `signingSecret`).

Until then it simply does not advertise the facet.

## Conformance

The existing `trigger-bridge-delivery.test.ts` keeps its seam path as the primary witness. When the seams are absent AND the host advertises `inboundSigning: ["standard-webhooks-1"]`, each leg runs a **normative-surface path**, noting `observed: normative-surface path` on its row:

- **Leg 1, dedup.** Register a webhook subscription (`verification.mode: none`) and POST twice with the same `webhook-id`. The first answers `202` with a `runId`; the second answers `200 {outcome: "duplicate", runId}` with the same `runId`.
- **Leg 2, dead-letter.** Register with `verification.mode: required` and POST with a bad `webhook-signature`: `401 signature_invalid`, no `runId`. `GET /v1/trigger-subscriptions/{id}` still shows `state: active` (§C.1). A correctly signed post afterwards answers `202` with a `runId`, proving the bad post did not disable the subscription.
- **Leg 3, causation.** POST a signed event and read `runId` from the `202`. On `GET /v1/runs/{runId}/events/poll`: `run.started.causationId` is present, and equals the `trigger.delivery.attempted{delivered}` event's id when that event is on the run's log. The delivered event is content-free.

The run-less terminal events (the dead-lettered `trigger.delivery.attempted`, `trigger.subscription.state.changed`) are not on any run's log, so their content-freeness stays seam-witnessed. That becomes its own requirement id, not a qualifier on a passing row (RFC 0174 §B.1). Dedup likewise becomes its own requirement id, and **both remain in the floor**.

### Falsifiability

| Requirement | Observable | Who can cause it | Verdict |
| --- | --- | --- | --- |
| §C no OpenWOP credential on ingest — `openwop.requirement.0083.trigger-delivery.dedup` (every signed post is sent without `Authorization`) | the ingest answers without `Authorization` | the suite | witnessable — executed-pass required on a host bundle |
| §C `required` + bad signature → no run — `openwop.requirement.0083.trigger-delivery.dead-letter` | `401 signature_invalid`, no `runId` | the suite | witnessable — executed-pass required on a host bundle |
| §C.1 a refused post leaves the subscription `active` — `openwop.requirement.0083.trigger-delivery.dead-letter` | `GET` shows `active`; a signed post next answers `202` | the suite | witnessable — executed-pass required on a host bundle |
| §C timestamp skew > 300 s → no run — `openwop.requirement.0230.stale-timestamp-refused` | as above, with a stale `webhook-timestamp` | the suite | witnessable — executed-pass required on a host bundle |
| §C dedup on `webhook-id` — `openwop.requirement.0083.trigger-delivery.dedup` | second post `200 duplicate` with the same `runId` | the suite | witnessable — executed-pass required on a host bundle |
| §D `202` + `runId` on delivery — `openwop.requirement.0083.trigger-delivery.causation` | status + body | the suite | witnessable — executed-pass required on a host bundle |
| §D `409` on a non-active subscription | status + envelope | nobody: no wire surface or seam makes a subscription non-active (corrected 2026-10-03; this row said "pause via the existing operator surface", and none exists) | unwitnessable — a pause or resume surface would make it witnessable (RFC 0232 §Decisions 3; gap G3) |
| §B `signingSecret` once, never on re-read — `openwop.requirement.0230.signing-secret-once` | absent on `GET` | the suite | witnessable — executed-pass required on a host bundle |

## Alternatives considered

1. **Keep the ingest host-defined; witness dedup via seams only.** This is today's position. The floor stays unwitnessable on every production host, forever. Rejected.
2. **Let the suite send a per-host "event id" header named in discovery.** This moves the portability problem into discovery without fixing it, and a real sender still has no standard to follow. Standard Webhooks is what senders already emit.
3. **Authenticate the ingest with OpenWOP credentials.** A third-party sender has no such credential. That is the gap openwop-app's route shows.

## Unresolved questions

*Decided at the `Active` flip. See §Decisions.*

1. Should `form` ingest adopt the same signing? This RFC leaves `form` alone because a browser form cannot sign.
2. Is 300 s the right skew bound? It is Standard Webhooks' recommended tolerance; RFC 0201's outbound rule uses ±5 min.
3. Should `401` for a verification failure instead be `202` (accepted, dead-lettered), so the sender cannot probe signatures? `401` is chosen because the sender is the secret holder and a silent accept hides misconfiguration.

## Decisions (2026-09-30, at the `Active` flip)

Each question is decided per the RFC's own lean. Each stays open to the RFC 0156 §B review.

1. **`form` signing: not in scope.** `form` ingest is unchanged. A browser-submitted form cannot hold the secret, so signing it would be decorative; `form-origin` verification (RFC 0099) remains its authenticity check.
2. **Skew bound: 300 seconds.** This is Standard Webhooks' recommended tolerance and matches the ±5 minute window `webhooks.md` already uses outbound. A tighter bound would convict hosts with ordinary clock drift.
3. **Bad signature under `required`: `401 signature_invalid`, and the delivery is dead-lettered.** Both happen; they are not alternatives. The sender is the secret holder, so a visible refusal surfaces a misconfiguration that a silent `202` would hide. The §F.2 dead-letter still records the attempt. Signature probing is bounded by the secret's entropy, not by hiding the status.

## Implementation notes (non-normative)

- openwop-app gains the facet only after the migration above. The conformance scenario change lands in the same PR as, or after, this RFC reaching `Active`.
- Until then `openwop.floor.trigger-bridge-delivery` keeps one honest red row on production hosts (dedup, seam-absent). It does not narrow.

## Acceptance criteria

- [x] `Active` (2026-09-30): comment window waived by steward override of RFC 0147 §A.6 (see Updated). The §B–§D contract, the capability facet (v1 + v2) and the `trigger-bridge.md` §F.6 / v2 `webhooks.md` text land together.
- [x] `trigger-bridge.md` §F.2 / §F.4 and v2 `webhooks.md` §Inbound triggers text merged. *(#1824: §F.6 and the §F.2 refused-event correction; v2 `webhooks.md` §Inbound triggers names `inboundSigning`.)*
- [x] `capabilities` schemas (v1 and v2) carry `ingestion.inboundSigning`. *(#1824.)*
- [x] `trigger-bridge-delivery.test.ts` gains the normative-surface path, with dedup and run-less-event content-freeness split into their own requirement ids and kept in the floor. *(#1827, suite 2.45.3: four ids under `openwop.requirement.0083.trigger-delivery.*`; the file is still in the `openwop-trigger-bridge` floor.)*
- [x] Sabotage-proven on the non-seam path *(#1827: measured on openwop-app with the RFC 0230 route on and the seams off; each sabotaged build failed only its own leg, recorded in `conformance/CHANGELOG.md` 2.45.3)*:
  - two runs on a duplicate `webhook-id` → fail;
  - a run on a bad signature, or a subscription left non-`active` by it → fail;
  - a missing `causationId` → fail.
- [ ] A host (openwop-app) advertises the facet and passes the path in strict mode on a production cut.
- [x] CHANGELOG entries. *(`CHANGELOG.md` and `conformance/CHANGELOG.md`, 2.45.3.)*

## References

- RFC 0083 (durable trigger bridge), RFC 0099 (external-event ingestion), RFC 0201 (Standard Webhooks, outbound), RFC 0147 §A.6, RFC 0174 §B.1.
- Standard Webhooks 1.0.0.
- app.openwop.dev certification bundles for b29427fef and 2273db9c6 (major 1, `openwop.floor.trigger-bridge-delivery`).
