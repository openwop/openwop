# openwop Spec v1 — Auth Profiles

> **Status: FINAL v1 (2026-05-10).** Optional production-auth annex for hosts that need stronger authentication than the baseline API-key contract in `auth.md`. This document is additive: it defines profile claims and conformance expectations without changing any required v1 endpoint, header, or error shape. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

`auth.md` defines the minimum interoperable contract: bearer API keys, canonical error envelopes, tenant isolation, scopes, and audit expectations. Production deployments often need OAuth2, key rotation, or mTLS, but those choices should not fragment the base protocol.

Auth profiles give operators a shared vocabulary for those stronger modes. A client can say "I need `openwop-auth-oauth2`" while a smaller host can remain v1-conformant with the baseline API-key flow.

Auth profiles are **documentation and conformance claims**. They are not new required discovery fields. A host MAY advertise supporting details in `/.well-known/openwop` under `extensions.auth` or host documentation; clients MUST tolerate absence.

---

## Profile catalog

### `openwop-auth-api-key-rotation`

The host supports rolling API keys without interrupting in-flight runs.

**Requirements:**

- A new key can be issued before the old key is revoked.
- During the rotation grace window, both keys authenticate the same principal and tenant.
- The host documents the minimum grace window. Production-profile hosts SHOULD support at least 24 hours.
- Revoked keys return the canonical `401 invalid_token` or `403 insufficient_scope` envelope from `auth.md`.
- Audit logs distinguish `key.created`, `key.used`, and `key.revoked` events without storing raw key material.

**Conformance gaps to close:** add rotation fixtures that verify old+new key overlap, revocation, and redaction in error bodies.

### `openwop-auth-oauth2-client-credentials`

The host accepts OAuth2 client-credentials access tokens for machine-to-machine clients.

**Requirements:**

- The token issuer, audience, and accepted signing algorithms are documented.
- The token maps to the same `tenant`, `principal`, and `scopes` concepts defined in `auth.md`.
- Missing, expired, malformed, wrong-audience, and insufficient-scope tokens use the canonical error envelope.
- Token introspection, if used, is an implementation detail; clients only depend on bearer-token semantics.
- Scope strings for OpenWOP operations remain the operation scopes in `auth.md`, even when encoded inside OAuth claims.

**Conformance gaps to close:** add negative token-shape cases and a positive token fixture for hosts that publish test issuer metadata.

### `openwop-auth-mtls`

The host requires mutual TLS in addition to bearer authentication.

**Requirements:**

- Client certificates authenticate a transport principal, not a replacement for operation scopes.
- Certificate subject or SAN mapping to tenants is documented.
- Failed client-certificate validation is surfaced as `401 invalid_token` or a transport-layer TLS failure. Hosts SHOULD document which behavior clients will observe.
- Certificate rotation follows the same overlap principle as API-key rotation.

**Conformance gaps to close:** add a harness-level mTLS mode for deployments that expose test certificates.

### `openwop-auth-oidc-user-bearer`

The host accepts OpenID Connect (OIDC) user-bearer tokens as an alternative to API keys for endpoints scoped to a human caller. Used in deployments that front the OpenWOP host with an SSO IdP (Okta, Auth0, Entra ID, Google Workspace, etc.) and want end-user attribution on `runs:create` / `approvals:respond` calls.

This is distinct from `openwop-auth-oauth2-client-credentials` (which authenticates a *service*, not a user): the OIDC flow surfaces a verified human identity to the host, suitable for audit and HITL attribution.

**Requirements:**

- The host MUST accept `Authorization: Bearer <id-token-or-access-token>` and verify it against the configured OIDC issuer(s).
- The host MUST verify the standard OIDC ID-token claims: `iss`, `aud`, `exp`, `iat`, and signature against the issuer's JWKS.
- The host MUST map the verified `sub` (subject) claim to an internal user identity, then resolve that identity to a tenant per the host's user-to-tenant policy.
- The host MUST enforce openwop scopes (`runs:create`, `approvals:respond`, etc.) on top of the OIDC identity — bearing a valid token is not sufficient; the principal must also hold the relevant scope (via group claims, role mapping, or host-side ACL).
- The host SHOULD respect `aud` restrictions and reject tokens whose audience does not include the host's configured audience identifier.
- The host MUST surface OIDC-specific failure modes via the canonical envelope: `unauthenticated` for invalid signature / expired token / wrong issuer; `forbidden` for token-valid-but-scope-insufficient; `key_revoked` for tokens whose `sub` has been disabled in the IdP.
- Token caching: hosts SHOULD honor the IdP's `exp` claim and MAY re-introspect the token at intervals not exceeding `min(exp - now, 5 minutes)` to detect IdP-side revocation.

**Optional features hosts MAY support:**

- **PKCE-protected authorization code flow** for browser-based clients fetching the bearer token client-side.
- **Refresh-token rotation** at the IdP — opaque to openwop; openwop only sees the current valid bearer.
- **Group → scope mapping** declared in host configuration (e.g., `groups: ["openwop:approvers"] → scopes: ["approvals:respond"]`).

**Discovery shape:**

```json
{
  "extensions": {
    "auth": {
      "profiles": ["openwop-auth-oidc-user-bearer", ...],
      "oidc": {
        "issuers": ["https://accounts.example.com/"],
        "audience": "https://openwop.example.com",
        "supportedScopeMapping": "group-claim",
        "introspectionIntervalSeconds": 300
      }
    }
  }
}
```

**Threat model considerations** (see `SECURITY/threat-model-auth-profiles.md`):

- Token theft via XSS or compromised client storage — OpenWOP hosts MUST NOT log bearer tokens; redaction harness covers `Authorization` header.
- IdP compromise — the host is at the IdP's mercy for identity assertions; hosts SHOULD support multiple issuers so an emergency cutover doesn't require code changes.
- Long-lived `sub` impersonation after employee departure — hosts SHOULD honor IdP revocation within the `introspectionIntervalSeconds` window.

**Conformance gaps to close:** add a harness that exercises a synthetic OIDC issuer (e.g., `mockoon` or local JWT signer) so the suite can verify token-validation behavior without depending on a real IdP. Suite version 1.18.0+ candidate.

---

## Discovery guidance

Because the base v1 discovery schema is intentionally stable, auth-profile metadata belongs under an extension namespace:

```json
{
  "extensions": {
    "auth": {
      "profiles": ["openwop-auth-api-key-rotation", "openwop-auth-oauth2-client-credentials", "openwop-auth-oidc-user-bearer"],
      "oauth2": {
        "issuer": "https://issuer.example.com/",
        "audience": "https://api.example.com/openwop"
      },
      "rotation": {
        "minGraceSeconds": 86400
      }
    }
  }
}
```

This extension is advisory. A host passes an auth profile only by satisfying the documented behavior and the corresponding conformance scenarios.

---

## Audit-log integrity (annex)

For hosts that must defend their audit log against tampering by privileged insiders or post-compromise attackers, this annex defines an optional integrity profile: **`openwop-audit-log-integrity`**.

### Threat model

The protocol's existing `auth.md` defines how hosts authenticate callers and authorize operations. It does NOT define what guarantees the host gives that the recorded audit history (who called what, when) cannot be silently rewritten after the fact. A compromised admin, a buggy migration, or a malicious operator could quietly mutate the log; without integrity protection, the rewrite is undetectable.

Real customers (regulated industries, public-sector deployments) require provable append-only logs.

### Profile shape

A host advertising the profile MUST:

1. **Append-only storage.** The audit-log backend MUST reject in-place updates and deletes of past entries. New events MAY be appended; existing events MUST NOT be mutated. Hosts SHOULD enforce this at the storage layer (e.g., immutable object-store buckets, append-only tables) rather than only at the application layer.

2. **Hash chain.** Each audit-log entry MUST carry a `prevHash` field that is the SHA-256 of the prior entry's canonical JSON serialization (RFC 8785 JCS). The genesis entry has `prevHash: null`. Verifiers re-compute the chain and detect any mid-history mutation.

3. **Periodic anchoring.** At intervals declared by the host (RECOMMENDED: every 1000 entries or every 5 minutes, whichever is sooner), the host MUST emit a signed checkpoint:

   ```json
   {
     "checkpoint": "string (host-issued id)",
     "atSequence": "integer (audit-log sequence at checkpoint)",
     "merkleRoot": "string (hex, SHA-256 of all entries up to atSequence)",
     "signature": "string (Ed25519 signature over the merkleRoot, by the host's audit-signing key)",
     "ts": "ISO 8601 timestamp"
   }
   ```

   Checkpoints SHOULD be exported to an out-of-band store (operator-managed, separate trust boundary). Verifiers compare the live chain against the last anchored checkpoint to detect rewinds.

4. **Verification endpoint.** Hosts MUST expose `GET /v1/audit/verify?fromSeq=&toSeq=` (auth: `audit:read` scope, REQUIRED-when-profile-claimed) that returns:

   ```json
   {
     "fromSeq": 0,
     "toSeq": 12000,
     "chainValid": true,
     "checkpoints": [{ "checkpoint": "...", "atSequence": 1000, "merkleRoot": "...", "signature": "..." }],
     "anomalies": []
   }
   ```

   When `chainValid: false`, `anomalies` carries one entry per detected break (`{ atSeq, expectedPrevHash, actualPrevHash }`).

### Key management

The audit-signing Ed25519 key:

- MUST be distinct from any signing key used for other surfaces (webhooks, node packs).
- SHOULD be hardware-backed (HSM, KMS) where regulatory requirements demand it.
- Rotation: hosts MAY rotate by issuing a new key and dual-signing checkpoints during a grace period. Old checkpoints remain verifiable under the retired key.

### Capability advertisement

```json
{
  "capabilities": {
    "auth": {
      "profiles": ["openwop-audit-log-integrity", ...],
      "auditLogIntegrity": {
        "hashChain": true,
        "checkpointSignatureAlgorithm": "ed25519",
        "checkpointPublicKey": "MCowBQYDK2VwAyEA...",
        "checkpointIntervalEntries": 1000,
        "checkpointIntervalSeconds": 300
      }
    }
  }
}
```

### Conformance

A host claims the profile by:

- Advertising `capabilities.auth.profiles` includes `openwop-audit-log-integrity`.
- Passing the suite scenarios `audit-log-chain.test.ts`, `audit-log-tamper-detection.test.ts`, `audit-log-checkpoint-signature.test.ts` (suite version 1.17.0+).

The profile is **strongly RECOMMENDED** as a precondition for any host commissioning an external security review (Track 9 in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`): the review's value depends on the log being trustworthy.

## Public-release checklist

- Publish supported auth profiles in the host README or compatibility page.
- Document token/key issuance, revocation, and emergency disable procedures.
- Verify all auth failures use the canonical error envelope and never echo credentials.
- Run the conformance suite with auth-profile scenarios enabled for each claimed profile.
- Include the suite version and profile pass result in `INTEROP-MATRIX.md`.

