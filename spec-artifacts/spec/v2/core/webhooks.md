# Webhooks

> **Status: Stable · RFC 0165 §C.1, 0173 §B, 0176 §D.2, 0171 §A.4, 0215.**
> **Normative home:** `webhooks`.

## Why this exists

A client registers a URL and an event filter once; the host POSTs matching events, signed, as they happen. In v2 durable delivery binds with the surface — a signed event that may be dropped is not a delivery contract.

## Surfaces

A host that advertises `webhooks` (capabilities.md) serves `registerWebhook` (`POST /webhooks`) and `unregisterWebhook` (`DELETE /webhooks/{webhookId}`) from `api/v2/openapi.yaml`. The facet (`spec/v2/facets/webhooks.schema.json`) is `{ signatureAlgorithms[] }`, which MUST list `"v1"`; there is no `durable` field.

| Operation | Request | Response |
| --- | --- | --- |
| `registerWebhook` | `{ url, events[], secret?, tags?, signatureAlgorithms? }`; `url` MUST be `https://`; `events[]` MUST be non-empty v2 event type names (events.md) | `201 { webhookId }` |
| `unregisterWebhook` | path `webhookId` | `204`; `404` when unknown; `403` when the caller is outside the subscription's tenant |

A `204` from `unregisterWebhook` ends the subscription's deliveries, including retries already scheduled (§Durability; RFC 0215 §B).

A subscription MUST receive only events from runs within its tenant scope; cross-tenant delivery is a protocol violation whatever the filter says (invariant `webhook-cross-tenant-isolation`). `tags` narrows delivery to runs whose options carry an overlapping tag.

## Delivery

The delivery envelope is generated from the event's payload definition (events.md §Payloads). The body is `{ runId, workspaceId?, event }` where `event` is the verbatim run event (events.md), and it MUST validate against `schemas/v2/webhook-delivery.schema.json`. `workspaceId` is present exactly when `RunSnapshot.owner.workspace` is (`identity.md` §1) — a host MUST NOT substitute its tenant id for an absent workspace.

The envelope's `runId` MUST use the tenant-bound v2 form defined by
`identity.md` §5, matching the nested event and every response representation.
This requirement applies to outbound delivery even though no versioned request
exists at delivery time.

### Headers

| Header | Value |
| --- | --- |
| `OpenWOP-Webhook-Id` | the subscription id |
| `OpenWOP-Event-Type` | the v2 event type |
| `OpenWOP-Timestamp` | Unix seconds at signing |
| `OpenWOP-Signature` | `sha256={hex}`, HMAC-SHA256 over the signed bytes |
| `OpenWOP-Signature-Algorithm` | `v1` |

A host MUST send all five on every delivery. The signed bytes are `{timestamp}.{rawBody}`, where `rawBody` is the exact bytes delivered. Scheme `v1` is HMAC-SHA256 with the subscription secret (`hs256`).

### Verification

A subscriber MUST verify before acting: reject a timestamp more than ±5 minutes from its clock; compute `HMAC-SHA256({timestamp}.{rawBody}, secret)`; compare in constant time. A subscriber MUST reject an unrecognized `OpenWOP-Signature-Algorithm` value. Subscribers SHOULD track `(OpenWOP-Webhook-Id, runId, sequence)` for at-least-once deduplication. A host MUST NOT log the secret.

### Standard Webhooks

`standard-webhooks-1` names the symmetric scheme of Standard Webhooks 1.0.0 (RFC 0201). Its in-header `v1,` token is that standard's, not the OpenWOP scheme id `v1`; neither is read as the other, and `OpenWOP-Signature-Algorithm` stays `v1`.

**Opt-in.** A subscription carries the scheme only when `registerWebhook` sends `signatureAlgorithms` listing it and `v1`, with a `secret` of the form `whsec_<base64 of 24–64 bytes>`; otherwise, or when the host does not advertise the id, `400 validation_error`. The `201` echoes the applied list. Every other subscription is unchanged.

**Endpoint verification.** Before answering `201`, the host MUST send the request of `schemas/v2/webhook-verification.schema.json` to `url` under §Egress, signed as below, and MUST refuse `400 webhook_endpoint_unverified`, persisting nothing, unless a `2xx` arrives within 10 s whose JSON `challenge` equals the one sent. A host MUST NOT verify a subscription that did not opt in.

**Delivery.** Each delivery to an opted-in subscription adds `webhook-id`, `webhook-timestamp` (equal to `OpenWOP-Timestamp`) and `webhook-signature`: space-separated `v1,<base64 HMAC-SHA256>` entries over `{webhook-id}.{webhook-timestamp}.{rawBody}`, keyed by the decoded secret. `webhook-id` matches `^[A-Za-z0-9_-]{16,128}$`, MUST be identical on every attempt of one `(webhookId, runId, sequence)` and MUST differ across them.

**Rotation.** A host advertising `webhooks.secretRotation` serves `rotateWebhookSecret`. For `overlapSeconds` after a rotation, `webhook-signature` MUST carry one entry per secret and `OpenWOP-Signature` stays on the previous secret; afterwards only the new secret signs.

### Dual emission through the overlap

A host advertising both majors MUST send, on every delivery, the `X-openwop-*` family alongside the `OpenWOP-*` family with identical values (RFC 0165 §C.1, RFC 0176 §D.2). A v2 receiver MUST accept a delivery carrying only the `X-openwop-*` family under scheme `v1`, verifying the same bytes. This adds no signature scheme. Per-subscription secrets are unchanged across the cut; deliveries queued before the cut are drained under their own retry policy with the payload they were serialized with (persistence.md). The `X-openwop-*` family is removed on its register date.

## Durability

Durable delivery is an obligation of the `webhooks` surface (RFC 0173 §B; security-defaults.md). A host MUST:

- retry a failed attempt per its advertised `retryPolicy` (`maxAttempts`, `backoff ∈ none | fixed | exponential`) with backoff between attempts;
- route a delivery whose retries are exhausted to the dead-letter sink, rather than drop it. A host advertising `webhooks.deadLetter` MUST serve `GET /webhooks/{webhookId}/dead-letters` (RFC 0188), and that record MUST NOT carry the delivered body, the delivery headers, or the subscription secret — a dead-letter read names a delivery, it does not replay one. This sink is the DELIVERY sink; the `deadLetter` family (RFC 0053) is the RUN sink and is a different thing;
- deliver each matching event at least once; a receiver MAY observe the same event more than once;
- not make the start of an attempt to one subscription wait for an attempt to a *different* subscription to finish (answered, failed, or timed out): one subscription's slow or dead receiver MUST NOT delay another subscription's deliveries (invariant `webhook-delivery-isolation`, RFC 0215 §A.1). The rule is about when an attempt starts, not how soon after an event it must start, and it names no mechanism: a lane per subscription, a concurrent pool or asynchronous I/O all meet it, and a sequential loop over a batch does not;
- sustain that while at least **8** subscriptions have attempts outstanding that their receivers have not answered (RFC 0215 §A.2). A host MAY bound concurrent attempts beyond that, and SHOULD NOT let one tenant's unanswered attempts occupy capacity another tenant's deliveries need (§A.3);
- after `unregisterWebhook` answers `204`, not start any further attempt for that subscription, including attempts already scheduled for retry (invariant `webhook-unregister-stops-delivery`, RFC 0215 §B). An attempt whose request the host had begun sending before the `204` MAY complete. The unregister does not oblige the host to route that subscription's undelivered events to the dead-letter sink: the exhaustion rule above governs deliveries of a live subscription;
- dead-letter a `payload_unprojectable` delivery (events.md §Era-2) on the first attempt, never retry it.

Best-effort delivery is not a conforming mode. A `3xx` response is a delivery failure, retried under the same policy. `webhook-durable-delivery` witnesses it.

## Replay

A host MUST NOT deliver events a `replay` fork re-emits as fixed history; replay-ness is read from the run, never from the event type (replay.md). A `branch` fork's events are new facts and are delivered.

## Egress

At registration a host MUST reject (`400 webhook_url_rejected`) non-`https://` URLs, RFC 1918 and loopback and link-local ranges, IPv6 ULA, cloud metadata hosts, and `localhost`. At delivery time a host MUST re-resolve the hostname, validate every resolved address against the same denied ranges plus its own denylist, connect to the validated address without re-resolving, and refuse to follow redirects (invariant `webhook-delivery-egress-revalidation`, reference-impl tier). An IPv4-mapped IPv6 address (`::ffff:0:0/96`) MUST be judged by the IPv4 address it embeds, whatever its spelling. An address embedding IPv4 in another standard translation form (IPv4-compatible `::/96`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`) SHOULD be judged the same way, and those prefixes SHOULD NOT be denied wholesale. A host SHOULD refuse every destination the IANA special-purpose address registries mark not globally reachable (RFC 0196 §B). These delivery-time rules bind an A2A push identically (interop.md §"A2A push delivery").

See also: events.md, replay.md, persistence.md, security-defaults.md.
