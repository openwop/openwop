# Headers

> **Status: Stable.** Generated from `api/v2/openapi.yaml` by `scripts/derive-v2-api.py`; do not edit.

## Why this exists

Every non-standard header is named `OpenWOP-<Name>`, and every header is declared in OpenAPI. These tables are generated from that declaration, so they list all of them: a header not listed here is not part of the protocol.

Standard headers keep their standard names: `Idempotency-Key`, `ETag`, `If-None-Match`, `Last-Event-ID`, `Retry-After`, `Authorization`.

## Request headers

| Header | Operations | Meaning |
| --- | --- | --- |
| `Accept-Language` | 1 | BCP-47 preference list; authoritative for locale selection (i18n.md). A malformed value MUST NOT 400. |
| `Idempotency-Key` | 15 | Per-mutation idempotency token (see `idempotency.md` Layer 1). Server caches `(tenantId, endpoint, key)` → response for ≥24h. Duplicate requests return the cached response with header `openwop-Idempotent-Replay: true`. |
| `If-None-Match` | 2 | Standard conditional request against any resource that carries an `ETag` — the discovery document (capabilities.md §1) and the run snapshot (runs.md §Snapshot): a matching value MUST yield `304 Not Modified` with no body, and the 304 carries `OpenWOP-Version` like every response (versioning.md §1.4). |
| `Last-Event-ID` | 1 | Resume from sequence after this ID. |
| `OpenWOP-Dedup` | 1 | When set, server cross-host claim system rejects duplicate `(tenantId, scopeId)` pairs with `409 Conflict`. |
| `OpenWOP-Force-Engine-Version` | 1 | **Test-keys-only.** When set, the server emits events for this run AS IF it were running the specified engine version (must be within the server's advertised `Capabilities.testing.forceEngineVersionRange`). Used by the conformance suite to verify version-negotiation fold-best-effort tolerance across the spec's forward-compat matrix. Servers MUST reject on production API keys with `403 force_engine_version_forbidden`. |
| `OpenWOP-Version` | 55 | Selects a listed major.minor; absent ⇒ the host's `preferredVersion`; unlisted ⇒ 406 protocol_version_unsupported. |

## Response headers

| Header | Operations | Meaning |
| --- | --- | --- |
| `Cache-Control` | 2 |  |
| `Content-Encoding` | 1 | Present only when the host negotiated compression from `Accept-Encoding`; pairs with `Vary: Accept-Encoding`. The decoded body is byte-identical to the identity body. |
| `Content-Language` | 1 | The BCP-47 locale actually used (equals the response `locale`). |
| `ETag` | 3 | Standard HTTP validator (RFC 9110 §8.8.3). The obligation is per operation: MUST on the discovery document (capabilities.md §1), SHOULD on the run snapshot (runs.md §Snapshot), a content hash on a prompt template (getPromptTemplate); see each operation. |
| `Location` | 1 | Canonical URI of the new template. |
| `OpenWOP-Idempotent-Replay` | 1 | Set when the response was served from the idempotency cache. |
| `OpenWOP-Version` | 55 | The contract that produced this response; MUST equal the one used. |
| `Retry-After` | 1 | Seconds until the active claim is stale-eligible. |
| `WWW-Authenticate` | 48 | `Bearer` challenge; `resource_metadata` and `error="invalid_token"` on a host with an oauth2/oidc lane. Never on a non-disclosure 404. |

## Webhook delivery headers

Declared in `webhooks.md`, not in OpenAPI, because the host is the client:

- `OpenWOP-Webhook-Id`, `OpenWOP-Event-Type`, `OpenWOP-Timestamp`, `OpenWOP-Signature`, `OpenWOP-Signature-Algorithm`.
- On a subscription that opted into Standard Webhooks (webhooks.md): that standard's `webhook-id`, `webhook-timestamp` and `webhook-signature`, under their standard names.
- During the v1 overlap only: the `X-openwop-*` family, emitted beside them and removed at v1 end-of-support.

## Removed in v2

These header names are not part of v2: `Capabilities-Etag` (use the standard `ETag`/`If-None-Match` pair), `X-Dedup`, `X-Force-Engine-Version`, `X-Pack-Sha256`, `X-Pack-Signing-Method`, `X-openwop-*` (webhooks), `openwop-Webhook-Signature`.

*Sources: RFC 0165, RFC 0171, RFC 0172, RFC 0201.*
