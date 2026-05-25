# RFC 0047: host.oauth — OAuth 2.0 authorization flows for connectors

| Field | Value |
|---|---|
| **RFC** | 0047 |
| **Title** | `host.oauth` capability — the host performs the OAuth 2.0 authorization-code + refresh dance on a user's behalf and persists the result as a `host.credentials` entry, so a connector pack declares only *which provider + scopes* it needs, not *how* the token is obtained |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-05-25 (Draft → Active: MyndHyve non-steward implementation landed — advertise + behavioral seams shipped per `docs/openwop-adoption/0045-0054-cohort-summary.md` (MyndHyve, 2026-05-25). Active → Accepted is gated on the published `@openwop/openwop-conformance@1.6.0` conformance run against `api.myndhyve.ai/workflow-runtime` reporting pass, per `RFCS/0001` §"Promotion to Accepted".) |
| **Affects** | `schemas/capabilities.schema.json` (additive `host.oauth` block) · `schemas/node-pack-manifest.schema.json` (additive node `auth` declaration) · `spec/v1/auth.md` (closes the OAuth authorization-code "Open spec gap") · `spec/v1/host-capabilities.md` (new §host.oauth) · `schemas/run-event-payloads.schema.json` (additive `connector.authorized` / `connector.auth_expired` events) · `SECURITY/invariants.yaml` (token redaction folded into `credential-payload-redaction`) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add an optional `host.oauth` capability for the **third-party token acquisition** the connector layer needs: the host performs the OAuth 2.0 authorization-code grant on a user's behalf, persists the resulting token as a `host.credentials` (RFC 0046) entry, refreshes it transparently, and resolves it into a node sandbox as a bearer token. A connector pack declares `auth: { type: 'oauth2', provider, scopes[] }` and never touches the dance itself. Two additive, redaction-safe events (`connector.authorized` / `connector.auth_expired`) make the lifecycle observable without ever emitting token material.

## Motivation

RFC 0010 specifies OAuth2 **client-credentials** + OIDC **user-bearer** — but those answer *"who is the caller of this host?"*. They say nothing about *"what third-party token does a node hold on a user's behalf?"*. `spec/v1/auth.md` carries an explicit Open-spec-gap row for the OAuth 2.0 **authorization-code** flow; until it is closed, every host hand-rolls the entire dance and connector packs cannot declare their OAuth needs portably.

MyndHyve hits this on every connector: `users/{uid}/connectors` and Campaign Studio integrations (Slack, Google Calendar, Gmail, payment providers) all require authorization-code + refresh. Today that is bespoke host code with no conformance backing, and a Slack-post pack only runs on MyndHyve because the token-acquisition surface it depends on is not in the wire contract. Hoisting the dance to the host — and persisting the result in the RFC 0046 vault — makes Slack/Google/etc. connector packs portable.

## Proposal

### §A — `capabilities.schema.json`: `oauth` block (additive)

> **Wire-path note — the advertised path is top-level `capabilities.oauth`.** Like `capabilities.credentials` (RFC 0046) and `capabilities.fs` / `capabilities.queueBus`, this capability is advertised at **top level**, not nested under a `host` key (the `§host.oauth` naming is prose convention). An earlier draft showed the block nested under `host`; the implemented and normative path — used by the §C MUST clauses and `host-capabilities.md` §host.oauth — is `capabilities.oauth.*`.

```diff
   "properties": {
     "credentials": { ... },
+    "oauth": {
+      "type": "object",
+      "description": "RFC 0047. Host performs OAuth 2.0 grants on a user's behalf, stores the token as a capabilities.credentials entry (RFC 0046), refreshes it transparently, and resolves it into the node sandbox as a bearer token. Token material NEVER crosses the wire (SECURITY invariant `credential-payload-redaction`).",
+      "properties": {
+        "supported": { "type": "boolean" },
+        "grants": {
+          "type": "array",
+          "items": { "type": "string", "enum": ["authorization_code", "client_credentials", "refresh_token"] },
+          "uniqueItems": true
+        },
+        "providers": {
+          "type": "array",
+          "items": {
+            "type": "object",
+            "required": ["id"],
+            "properties": {
+              "id": { "type": "string", "minLength": 1, "description": "Stable provider id, e.g. `slack`, `google`." },
+              "authUrl": { "type": "string", "format": "uri" },
+              "tokenUrl": { "type": "string", "format": "uri" },
+              "scopesSupported": { "type": "array", "items": { "type": "string" } }
+            },
+            "additionalProperties": false
+          }
+        }
+      },
+      "required": ["supported"],
+      "additionalProperties": false
+    }
   }
```

### §B — Connector-auth declaration in the pack manifest (additive)

A node (or the connector block of RFC 0045) declares its OAuth need, never the secret:

```json
"auth": {
  "type": "oauth2",
  "provider": "slack",
  "scopes": ["chat:write", "channels:read"]
}
```

The host matches `provider` against an advertised `capabilities.oauth.providers[].id` and refuses to register the pack if the provider or a requested scope is not advertised (`oauth_provider_unsupported` / `oauth_scope_unsupported`).

### §C — Token lifecycle (normative, when `capabilities.oauth.supported: true`)

A host advertising `capabilities.oauth.supported: true` MUST:

1. Perform the advertised grant(s). For `authorization_code`, drive the redirect/callback exchange host-side; the protocol does **not** put the authorization-code, the redirect URI, or the `state` parameter into any run-visible surface.
2. Persist the acquired access + refresh tokens as a `host.credentials` (RFC 0046) entry at scope `user` or `workspace`. The node receives a **resolved bearer token in-sandbox only** — never in `inputs`, variables, events, debug bundles, or replay state (the RFC 0046 `credential-payload-redaction` invariant covers it).
3. Refresh expired access tokens host-side using the stored refresh token, transparently to the node. On refresh failure (revoked / expired refresh token), emit `connector.auth_expired` and fail the node with `connector_auth_expired`.

### §D — Events (additive, redaction-safe)

Add to `run-event-payloads.schema.json`:

- `connector.authorized` → `{ provider, credentialRef, scopes }` — emitted when a token is first acquired or re-authorized. Carries the **reference**, never the token.
- `connector.auth_expired` → `{ provider, credentialRef, reason }` — emitted when refresh fails terminally.

Both MUST be free of token material; they are covered by the RFC 0046 redaction invariant (no new invariant row needed).

### §E — `auth.md` gap closure

The Open-spec-gap row for OAuth 2.0 authorization-code flips to "Closed as optional capability `host.oauth` (RFC 0047)", parallel to how Gap A1 (client-credentials) was closed as the `openwop-auth-oauth2-client-credentials` profile. `host.oauth` composes with RFC 0010 without overlap: **0010 is host authentication (who is the caller); 0047 is third-party delegation (what token does this node hold).**

## Compatibility

**Additive.** New optional capability block; new optional manifest `auth` declaration; two new event types consumers can ignore; no new required fields. Hosts without `capabilities.oauth.supported` ignore the block; connector packs declaring `auth: { type: 'oauth2' }` refuse to register on them. No existing v1 conformance pass is invalidated.

**Depends on RFC 0046** for token storage and the redaction invariant.

## Conformance

- **`oauth-capability-shape.test.ts`** — `host.oauth` block validates; declared `grants`/`providers` well-formed. (Always runs.)
- **`oauth-authcode-roundtrip.test.ts`** — against a synthetic provider fixture, drive the authorization-code grant; assert a `host.credentials` entry is created and `connector.authorized` carries the ref (not the token). (Gated on `capabilities.oauth.supported` ∧ `grants` includes `authorization_code`.)
- **`oauth-refresh.test.ts`** — expire the access token; assert transparent refresh; assert `connector.auth_expired` on terminal refresh failure. (Gated on `grants` includes `refresh_token`.)
- **`oauth-token-redaction.test.ts`** — adversarial: assert no token material in any event, debug bundle, or replay state (reuses the RFC 0046 redaction harness). (Gated.)

New fixture: a synthetic OAuth provider (deterministic authorize + token + refresh endpoints) in `conformance/fixtures/`, catalogued in `fixtures.md`.

## Alternatives considered

1. **Extend RFC 0010's OAuth2 profile to cover authorization-code.** Rejected — 0010 models the host's *own* authentication. Conflating "who is calling me" with "what delegated token does a node carry" muddles two distinct trust relationships and two distinct token lifecycles.
2. **Let connector packs carry their own OAuth client code (client id/secret) and run the dance in-sandbox.** Rejected — that puts client secrets and redirect handling inside untrusted pack code, defeats central refresh, and makes the token-acquisition surface uncertifiable. The host is the right trust boundary.
3. **Do nothing; keep OAuth host-private.** Rejected — connector packs stay host-locked, which is the exact portability failure Tier 1 exists to fix.

## Unresolved questions

1. **PKCE advertisement.** Should `host.oauth` advertise PKCE support per-provider? Most modern providers require it; a future minor may add `providers[].pkce: bool`. Deferred until a conformance fixture needs the distinction.
2. **Device-code grant.** CLI/edge connectors may want the device-authorization grant. Add to the `grants` enum when an adopter pulls.
3. **Per-scope incremental authorization.** Re-prompting for additional scopes on an existing connector. Deferred — App-layer UX until pulled.

## Implementation notes (non-normative)

- Schema diffs (§A, §B, §D) land on `Active` promotion with the conformance scenarios.
- Reference-adopter target: MyndHyve advertises its existing provider catalog under `host.oauth.providers`, routes connector OAuth through the contract, and stores tokens in the RFC 0046 vault.

## Acceptance criteria

- [x] Spec text merged (this file).
- [x] `oauth` block (top-level, per the schema convention) in `capabilities.schema.json`.
- [x] Node `auth` declaration (`NodeAuth` $def) in `node-pack-manifest.schema.json`.
- [x] `connector.authorized` / `connector.auth_expired` in `run-event-payloads.schema.json`.
- [x] `auth.md` Open-spec-gap row flipped to closed (row A5).
- [x] `spec/v1/host-capabilities.md` §host.oauth section.
- [~] Conformance scenarios — 2 of 4 landed: `oauth-capability-shape.test.ts` (shape, always runs) + `oauth-connector-redaction.test.ts` (token-material redaction, capability-gated, `POST /v1/host/sample/oauth/connector-echo` seam soft-skips). The behavioral authcode-roundtrip + refresh scenarios (+ synthetic-provider fixture) are deferred until a host wires the seam. Token redaction reuses the RFC 0046 `credential-payload-redaction` invariant (no new invariant).
- [x] CHANGELOG entry under `[Unreleased]`.
- [ ] A non-steward host advertises `host.oauth` and passes the authcode + refresh + redaction scenarios.

**Implementation note (2026-05-25):** Spec + schema + the two shape/redaction scenarios landed on `main`. Per the schema convention the capability is advertised at top-level `capabilities.oauth` (prose name stays `§host.oauth`). Depends on RFC 0046 (token storage + redaction invariant), already on `main`. Status stays `Draft` pending maintainer promotion + a non-steward host implementation.

## References

- [`RFCS/0046-host-credentials-capability.md`](./0046-host-credentials-capability.md) — token storage + the redaction invariant this RFC reuses (hard dependency).
- [`RFCS/0010-auth-profile-conformance.md`](./0010-auth-profile-conformance.md) — `openwop-auth-oauth2-client-credentials` (host auth, distinct from this RFC's delegation model).
- [`spec/v1/auth.md`](../spec/v1/auth.md) §"Open spec gaps" — the authorization-code gap this RFC closes.
- [`RFCS/0045-connector-pack-manifest-action-model.md`](./0045-connector-pack-manifest-action-model.md) — the connector manifest that consumes the §B `auth` declaration.
- OAuth 2.0 Authorization Framework (RFC 6749), §4.1 (authorization code), §6 (refresh).
