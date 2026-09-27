# Headers

> **Status: Stable.** Generated from `api/v2/openapi.yaml` by `scripts/derive-v2-api.py`; do not edit.

## Why this exists

Every non-standard header is named `OpenWOP-<Name>`, and every header is declared in OpenAPI. These tables are generated from that declaration, so they list all of them: a header not listed here is not part of the protocol.

Standard headers keep their standard names: `Idempotency-Key`, `ETag`, `If-None-Match`, `Last-Event-ID`, `Retry-After`, `Authorization`.

## Request headers

| Header | Operations | Meaning |
| --- | --- | --- |
| `Accept-Language` | 1 | BCP-47 preference list; authoritative for locale selection (i18n.md). A malformed value MUST NOT produce a 400. |
| `Idempotency-Key` | 15 | Per-mutation idempotency token (`idempotency.md` Layer 1). The server caches `(tenantId, endpoint, key)` → response for ≥24h. A duplicate request returns the cached response with `OpenWOP-Idempotent-Replay: true`. |
| `If-None-Match` | 2 | Conditional request on the discovery document (capabilities.md §1) and the run snapshot (runs.md §Snapshot). A value matching the `ETag` the host sent MUST yield `304 Not Modified` with no body. The 304 carries `OpenWOP-Version` like every response (versioning.md §1.4). |
| `Last-Event-ID` | 1 | Resume from sequence after this ID. |
| `OpenWOP-Client-Version` | 55 | The protocol version the client implements (versioning.md §1.5). Compared with `minClientVersion` on major.minor. A malformed value is treated as absent and MUST NOT produce a 400. Never selects a contract. |
| `OpenWOP-Dedup` | 1 | When set, the host's cross-host claim system rejects a duplicate `(tenantId, scopeId)` pair with `409 Conflict`. |
| `OpenWOP-Force-Engine-Version` | 1 | Test keys only. The server emits this run's events as if it ran the given engine version, which must be within `Capabilities.testing.forceEngineVersionRange`. Servers MUST reject it on production API keys with `403 force_engine_version_forbidden`. |
| `OpenWOP-Version` | 55 | Selects one of the host's listed major.minor versions. Absent, the host uses its `preferredVersion`; an unlisted value is 406 protocol_version_unsupported. |

## Response headers

| Header | Operations | Meaning |
| --- | --- | --- |
| `Cache-Control` | 2 | Standard HTTP caching directive (RFC 9111), set per operation: public content-page delivery, and prompt templates (immutable semantics when the version was pinned); see each operation. |
| `Content-Encoding` | 1 | Present only when the host negotiated compression from `Accept-Encoding`; pairs with `Vary: Accept-Encoding`. The decoded body is byte-identical to the identity body. |
| `Content-Language` | 1 | The BCP-47 locale actually used (equals the response `locale`). |
| `ETag` | 3 | Standard HTTP validator (RFC 9110 §8.8.3). The obligation is per operation: MUST on the discovery document (capabilities.md §1), SHOULD on the run snapshot (runs.md §Snapshot), a content hash on a prompt template (getPromptTemplate); see each operation. |
| `Location` | 1 | Canonical URI of the new template. |
| `OpenWOP-Idempotent-Replay` | 1 | Set when the response was served from the idempotency cache. |
| `OpenWOP-Version` | 55 | The contract that produced this response. It MUST equal the one used. |
| `Retry-After` | 1 | Seconds until the active claim is stale-eligible. |
| `WWW-Authenticate` | 48 | A `Bearer` challenge. On a host with an oauth2 or oidc lane it carries `resource_metadata` and `error="invalid_token"`. Never sent on a non-disclosure 404. |

## Webhook delivery headers

Declared in `webhooks.md`, not in OpenAPI, because the host is the client:

- `OpenWOP-Webhook-Id`, `OpenWOP-Event-Type`, `OpenWOP-Timestamp`, `OpenWOP-Signature`, `OpenWOP-Signature-Algorithm`.
- On a subscription that opted into Standard Webhooks (webhooks.md): that standard's `webhook-id`, `webhook-timestamp` and `webhook-signature`, under their standard names.
- During the v1 overlap only: the `X-openwop-*` family, emitted beside them and removed at v1 end-of-support.

## Removed in v2

These header names are not part of v2: `Capabilities-Etag` (use the standard `ETag`/`If-None-Match` pair), `X-Dedup`, `X-Force-Engine-Version`, `X-Pack-Sha256`, `X-Pack-Signing-Method`, `X-openwop-*` (webhooks), `openwop-Webhook-Signature`.

*Sources: RFC 0165, RFC 0171, RFC 0172, RFC 0201.*
