# openwop Spec v1 — Capability Change Detection

> **Status: Stable · v1.1 (2026-05-10).** Additive discovery annex for detecting changes to `/.well-known/openwop` and for documenting scoped capability views. This document does not change the required v1 capability payload. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

Clients negotiate against `GET /.well-known/openwop` before creating runs. That payload can change when a host enables a node pack, changes optional profile support, rotates provider policy, or exposes tenant-specific features.

The base discovery endpoint remains public and cacheable. This annex defines a small, backward-compatible way for clients and conformance tools to detect meaningful changes without polling the entire payload aggressively or leaking private tenant features into the public document.

---

## `Capabilities-Etag`

A host MAY include a `Capabilities-Etag` response header on `GET /.well-known/openwop`.

```http
GET /.well-known/openwop

HTTP/1.1 200 OK
Cache-Control: public, max-age=300
Capabilities-Etag: "cap_2026-05-10T14:00Z_7"
Content-Type: application/json
```

The value is an opaque validator. Clients MUST treat it as an uninterpreted string and MUST NOT derive semantics from its format.

When present, the header MUST change whenever a previously returned capability payload would no longer be a safe basis for negotiation. Examples:

- `protocolVersion`, `engineVersion`, or `eventLogSchemaVersion` changes.
- Supported envelopes, node types, transports, fixtures, profiles, or optional capability blocks change.
- Limits or accepted `configurable` keys change.
- Provider policy, secret-resolution support, or runtime capabilities change.

The header SHOULD NOT change for implementation metadata that does not affect client behavior, such as request counters or deployment instance IDs.

---

## Cache validators

Hosts MAY also expose standard HTTP `ETag` and `Last-Modified` headers. If both `ETag` and `Capabilities-Etag` are present, `ETag` describes byte-for-byte response caching while `Capabilities-Etag` describes protocol negotiation safety.

Clients SHOULD prefer `Capabilities-Etag` when deciding whether to re-run capability negotiation.

Clients MAY send `If-None-Match` for normal HTTP caching. Hosts that support conditional requests SHOULD return `304 Not Modified` when the byte payload is unchanged.

---

## Scoped capability views

The canonical public endpoint remains unauthenticated:

```http
GET /.well-known/openwop
```

The public payload MUST NOT reveal private tenant features, secret names, provider keys, or premium-only capabilities that would disclose customer configuration.

Hosts that need authenticated or tenant-scoped capability details MAY expose one of these additive patterns:

- The same endpoint with `Authorization: Bearer ...`, returning a narrowed or enriched view for the caller.
- A host-extension endpoint such as `GET /v1/capabilities` with normal API-key auth.
- An extension block in the public payload that points to host documentation for scoped discovery.

If an authenticated view differs from the public view, it MUST still satisfy the base `capabilities.schema.json` shape. It MAY omit capabilities the caller cannot use, and it MAY include optional fields that are hidden from the public payload.

Hosts MUST NOT let scoped discovery become an authorization oracle. A caller should learn only about capabilities it is allowed to use.

---

## Non-HTTP composition

OpenWOP v1 uses REST + SSE as the canonical transport. Hosts that expose OpenWOP through MCP, A2A, gRPC, or another composition layer SHOULD provide an equivalent discovery handoff:

1. A way to retrieve the canonical capability payload or a URL to it.
2. A way to retrieve the current `Capabilities-Etag` value when supported.
3. A statement of which operations are transport-native and which delegate to REST.

For MCP and A2A integrations, the integration docs remain normative for role separation: MCP exposes tools/resources/prompts; A2A exchanges agent tasks; OpenWOP owns durable workflow execution and event history.

---

## Client behavior

A long-running client SHOULD:

1. Fetch capabilities at startup.
2. Store the returned `Capabilities-Etag`, if present.
3. Re-check on a bounded interval or before starting a run that depends on optional features.
4. Re-run negotiation when the value changes.

If the value changes while a run is active, the client MUST NOT assume the active run's event-log or engine version has changed. Per-run versioning remains governed by `version-negotiation.md`.

---

## Conformance expectations

Conformance should add optional discovery scenarios:

- If `Capabilities-Etag` is present, it is a non-empty string.
- Repeated discovery calls without host changes return the same value within the cache window.
- Public discovery never requires authentication.
- Auth-scoped discovery, when advertised, returns a valid capability shape and does not expose capabilities outside the caller's authorization.

