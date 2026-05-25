# openwop Spec v1 — Authentication and Authorization

> **Status: Stable · v1.1 (2026-04-27).** Comprehensive coverage of the bearer-token auth model, scope vocabulary, and the canonical 401/403 error envelope (now backed by `schemas/error-envelope.schema.json` per JS5). Not yet final: OAuth 2.0, mTLS, key rotation, and webhook HMAC remain in "Open spec gaps" — but the stable surface (API key + scopes + error envelope) is comprehensive enough for SDK + conformance authoring. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).
>
> **Status legend** (used across all spec/v1/*.md). Full policy at [/governance/spec-status/](/governance/spec-status/):
> - **Stable** — frozen wire surface under v1.x. Required fields, event payloads, endpoint contracts, and package names cannot change without a v2.
> - **Stabilizing** — comprehensive coverage; required-field set and endpoint shapes locked, but optional fields and behavior coverage are still landing additively.
> - **Draft** — open comment window. Section headings and broad shape are stable, but field schemas and event payloads MAY shift on each weekly RFC roll-up.
> - **Experimental** — sketched coverage of an in-flight surface. Implementers SHOULD pin only to what is explicitly written; assume gaps and breaking shape changes inside v1.x. Hosts MUST NOT advertise an Experimental capability via `/.well-known/openwop` outside of an explicit opt-in profile.
>
> Earlier revisions of this corpus used **FINAL**, **STUB**, **DRAFT**, **OUTLINE** as legend labels. The four-tier vocabulary above is the canonical replacement; **Stable ↔ FINAL** is the only direct synonym.

---

## Scope

This document specifies how OpenWOP-compliant servers authenticate and authorize callers of the protocol's wire-level surfaces (REST, MCP, A2A, SSE). It does NOT prescribe identity-provider semantics; an implementation MAY use any identity provider (Firebase Auth, OAuth 2.0, mTLS, etc.) for human callers, and MUST use the API-key surface defined here for machine callers.

## Authentication models

An OpenWOP-compliant server MUST support **at least one** of the following authentication models. It MAY support multiple in parallel.

### 1. API keys (machine callers)

REQUIRED for any server that exposes the openwop wire surface to non-human callers.

- The server MUST accept the API key in the `Authorization` HTTP header using the `Bearer` scheme: `Authorization: Bearer <key>`.
- The server MUST reject requests missing or malformed `Authorization` headers with HTTP `401 Unauthorized`.
- The server MUST validate the key against persisted records and reject unknown, revoked, or expired keys with HTTP `401 Unauthorized`.
- The server MUST verify the key carries the scope required for the requested operation (see "Scopes" below) and reject scope-insufficient requests with HTTP `403 Forbidden`.
- API keys MUST be stored hashed at rest; comparison MUST use a constant-time function (e.g., bcrypt). Plaintext storage is FORBIDDEN.

#### Key format

The spec does not prescribe the visible prefix; reference implementations are encouraged to use a short, recognizable prefix that distinguishes:
- Live keys from sandbox/test keys (e.g., `live_` vs `test_`)
- The implementation's own keys from those of other systems (e.g., a vendor identifier)

Example schemes from real and hypothetical hosts:

- **Steward's reference host** — two-prefix scheme distinguishing live and sandbox keys, bcrypt-hashed, stored under a host-private collection.
- **Hypothetical `acme.example` host** — single `acme_` prefix with embedded environment hint (`acme_prod_`, `acme_staging_`), Argon2id-hashed, stored in a managed secrets vault.

Hosts MAY use any scheme they prefer; the prefix is purely operational.

#### Scopes

An OpenWOP-compliant server MUST support the following scope vocabulary at minimum:

| Scope | Allows |
|---|---|
| `manifest:read` | Read workflow / canvas-type / endpoint manifests |
| `runs:create` | Create new runs |
| `runs:read` | Read run state and event stream |
| `runs:cancel` | Cancel an in-flight run |
| `artifacts:read` | Read artifacts produced by runs |
| `webhooks:manage` | Register/unregister webhook subscriptions |
| `approvals:respond` | Respond to HITL approval gates |
| `packs:publish` | Publish new versions of node-packs to the registry (see `registry-operations.md`) |
| `packs:yank` | Mark a published node-pack version yanked (advisory; existing pins keep resolving) |
| `packs:yank-revert` | Reinstate a yanked node-pack version (super-admin) |
| `audit:read` | Verify audit-log integrity via `GET /v1/audit/verify`. Gated on the `openwop-audit-log-integrity` profile per `auth-profiles.md`. |

A server MAY define additional scopes for non-protocol surfaces (e.g., `canvas-types:list`, `projects:list` for platform-level keys). Such extensions MUST NOT shadow the names above.

A key MAY hold any subset of scopes. The server MUST enforce scope checks at the endpoint level, not at the resource level — i.e., `runs:cancel` does not imply `runs:read`.

### 2. User-bearer tokens (human callers)

OPTIONAL. Servers that expose admin/management surfaces (CLIs, dashboards) typically accept user-bearer tokens issued by an identity provider.

- The server MUST validate the token against the issuing provider before authorizing any operation.
- User tokens MAY map to a richer permission model than API keys (e.g., role-based access control over multiple scope dimensions).
- User tokens MUST NOT bypass workspace/tenant isolation.

Implementation examples include OAuth/OIDC identity providers, managed identity platforms, or mTLS front doors that map the authenticated principal to workspace memberships and role flags.

## Authorization

Beyond scope checks on API keys, an OpenWOP-compliant server MUST enforce:

1. **Tenant isolation.** A caller authenticated for tenant A MUST NOT be able to read or mutate any resource scoped to tenant B. The server MUST verify resource-tenant binding inside the same transaction or query that fetches the resource. (See `idempotency.md` for the run-claim transactional check.)

2. **Scope-resource match.** Even if a key carries `runs:read`, the server MUST verify that the specific run the caller is requesting belongs to a tenant the key is authorized for.

3. **Test-mode segregation.** If the server distinguishes live and test keys (recommended), it MUST NOT permit a test key to read or mutate live data, and vice versa. Resources created by test keys MUST be marked as such.

## Error response shape

Auth failures use the standard JSON-RPC 2.0 error shape on JSON-RPC transports, and the following on REST:

```json
{
  "error": "<short_code>",
  "message": "<human-readable>",
  "scopeRequired": "<scope>"  // present on 403 only
}
```

Codes:
- `unauthenticated` (401) — no credential or invalid credential
- `forbidden` (403) — credential valid but lacks required scope or fails resource binding
- `key_expired` (401)
- `key_revoked` (401)

## Rate limiting

An OpenWOP-compliant server SHOULD apply per-key rate limits and SHOULD return:

- HTTP `429 Too Many Requests`
- `Retry-After` header (seconds)
- Body: `{ error: "rate_limited", message, details: { window, limit, current, retryAfterSeconds } }`

Rate-limit decisions MUST be made before scope checks (so a flooded key can be throttled even on endpoints it lacks scope for).

## Audit

An OpenWOP-compliant server SHOULD log every authenticated request with at minimum: keyId, scope used, request method+path, timestamp, response status, latency. Logs MUST NOT include the API key value or any credential material.

---

## Open spec gaps

| # | Gap | Owner |
|---|---|---|
| A1 | ✅ Closed as optional profile in `auth-profiles.md`: OAuth2 client-credentials flow. | conformance minor |
| A2 | ✅ Closed as optional profile in `auth-profiles.md`: mTLS deployment profile. | conformance minor |
| A3 | ✅ Closed as optional profile in `auth-profiles.md`: API-key rotation/grace-period semantics. | conformance minor |
| A4 | Webhook HMAC is now specified in `webhooks.md`; remaining work is shared auth-profile conformance across REST and webhook verification examples | conformance minor |
| A5 | ✅ Closed as optional capability `host.oauth` (RFC 0047): OAuth 2.0 **authorization-code + refresh** for a node/connector acquiring a third-party token on a user's behalf. Distinct from A1 (client-credentials = host auth); 0047 is third-party delegation — acquired tokens stored as `host.credentials` (RFC 0046) entries, resolved into the node sandbox only. | conformance minor |

## References

- `idempotency.md` — idempotency contract for mutating operations
- `rest-endpoints.md` — endpoint catalog with per-route scope requirements
- `auth-profiles.md` — optional production auth profiles for rotation, OAuth2, and mTLS
- `SECURITY/threat-model-auth-profiles.md` — auth-profile threat model
