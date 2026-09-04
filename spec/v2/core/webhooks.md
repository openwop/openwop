# Webhooks

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0165 §C.1, 0173 §B, 0176 §D.2, 0171 §A.4.**

## Why this exists

Polling a run for progress is inefficient, and SSE cannot reach systems that need server-to-server delivery. A client registers a URL and an event filter once; the host POSTs matching events, signed, as they happen. In v2 durable delivery binds with the surface — a signed event that may be dropped is not a delivery contract.

## Surfaces

A host that advertises `webhooks` (capabilities.md) serves `registerWebhook` (`POST /webhooks`) and `unregisterWebhook` (`DELETE /webhooks/{webhookId}`) from `api/v2/openapi.yaml`. The facet (`spec/v2/facets/webhooks.schema.json`) is `{ signatureAlgorithms[] }`, which MUST list `"v1"`; there is no `durable` field.

| Operation | Request | Response |
| --- | --- | --- |
| `registerWebhook` | `{ url, events[], secret?, tags? }`; `url` MUST be `https://`; `events[]` MUST be non-empty v2 event type names (events.md) | `201 { webhookId }` |
| `unregisterWebhook` | path `webhookId` | `204`; `404` when unknown; `403` when the caller is outside the subscription's tenant |

A subscription MUST receive only events from runs within its tenant scope; cross-tenant delivery is a protocol violation whatever the filter says (invariant `webhook-cross-tenant-isolation`). `tags` narrows delivery to runs whose options carry an overlapping tag.

## Delivery

The delivery envelope is generated from the same payload definition as the event itself and the CloudEvents mapping — one source, three renderings (RFC 0171 §A.4). The body is `{ runId, workspaceId?, event }` where `event` is the verbatim run event (events.md), and it MUST validate against `schemas/v2/webhook-delivery.schema.json`. `workspaceId` is present exactly when `RunSnapshot.owner.workspace` is (`identity.md` §1) — a host MUST NOT substitute its tenant id for an absent workspace.

The envelope's `runId` is tenant-bound (`identity.md` §5), like every other rendering of a v2 `runId`. An outbound emission is not a response to a versioned request, so nothing in the request cycle supplies the form — the grammar does. **A host that projects on responses and not on emissions hands the subscriber an identifier the client has never seen**, and the failure is silent: the subscriber's correlation matches nothing, with no error, no `4xx` and no log line. Until 2026-09-04 the nested `event.runId` was bound by `run-event.schema.json` while the envelope's own was carried by this paragraph alone, which is how a real host shipped the split.

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

### Dual emission through the overlap

A host advertising both majors MUST send, on every delivery, the `X-openwop-*` family alongside the `OpenWOP-*` family with identical values (RFC 0165 §C.1, RFC 0176 §D.2). A v2 receiver MUST accept a delivery carrying only the `X-openwop-*` family under scheme `v1`, verifying the same bytes. This adds no signature scheme. Per-subscription secrets are unchanged across the cut; deliveries queued before the cut are drained under their own retry policy with the payload they were serialized with (persistence.md). The `X-openwop-*` family is removed on its register date.

## Durability

Durable delivery is an obligation of the `webhooks` surface (RFC 0173 §B; security-defaults.md). A host MUST:

- retry a failed attempt per its advertised `retryPolicy` (`maxAttempts`, `backoff ∈ none | fixed | exponential`) with backoff between attempts;
- route a delivery whose retries are exhausted to the dead-letter sink, inspectable for `retentionDays`, rather than drop it;
- deliver each matching event at least once; a receiver MAY observe the same event more than once.

Best-effort delivery is not a conforming mode. A `3xx` response is a delivery failure and is retried under the same policy. The `webhook-durable-delivery` scenario observes retry then dead-letter (conformance.md).

## Replay

A host MUST NOT deliver events a `replay` fork re-emits as fixed history; replay-ness is read from the run, never from the event type (replay.md). A `branch` fork's events are new facts and are delivered.

## Egress

At registration a host MUST reject (`400 webhook_url_rejected`) non-`https://` URLs, RFC 1918 and loopback and link-local ranges, IPv6 ULA, cloud metadata hosts, and `localhost`. At delivery time a host MUST re-resolve the hostname, validate every resolved address against the same denied ranges plus its own denylist, connect to the validated address without re-resolving, and refuse to follow redirects (invariant `webhook-delivery-egress-revalidation`, reference-impl tier).

See also: events.md, replay.md, persistence.md, security-defaults.md.
