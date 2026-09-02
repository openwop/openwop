# OpenWOP Spec v1 — Auth Profiles

> **Status: Stable · v1.1 (2026-05-10; conformance-reference hygiene 2026-06-02).** Optional production-auth annex for hosts that need stronger authentication than the baseline API-key contract in `auth.md`. This document is additive: it defines profile claims and conformance expectations without changing any required v1 endpoint, header, or error shape. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

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
- Revoked keys return the canonical `401 key_revoked` (or `403 forbidden` when the credential is valid but lacks the required scope) envelope from `auth.md` §"Error response shape".
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
- Failed client-certificate validation is surfaced as `401 unauthenticated` or a transport-layer TLS failure. Hosts SHOULD document which behavior clients will observe.
- Certificate rotation follows the same overlap principle as API-key rotation.

**Conformance gaps to close:** add a harness-level mTLS mode for deployments that expose test certificates.

### `openwop-auth-oidc-user-bearer`

The host accepts OpenID Connect (OIDC) user-bearer tokens as an alternative to API keys for endpoints scoped to a human caller. Used in deployments that front the OpenWOP host with an SSO IdP (Okta, Auth0, Entra ID, Google Workspace, etc.) and want end-user attribution on `runs:create` / `approvals:respond` calls.

This is distinct from `openwop-auth-oauth2-client-credentials` (which authenticates a _service_, not a user): the OIDC flow surfaces a verified human identity to the host, suitable for audit and HITL attribution.

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

### `openwop-auth-saml` (RFC 0050)

The host validates SAML 2.0 assertions from an enterprise IdP and maps the asserted subject + attributes onto an RFC 0048 `principal` (and, where present, group attributes onto RFC 0049 roles). For deployments whose enterprise SSO is SAML rather than OIDC. Composes with — and is distinct from — `openwop-auth-oidc-user-bearer`: SAML's assertion/signature model (XML-DSig) differs structurally from OIDC's JWT bearer.

**Requirements:**

- The host MUST validate the assertion's XML signature against the IdP's configured certificate. Unsigned assertions MUST be rejected.
- The host MUST reject `alg:none` / absent-algorithm assertions (mirroring the OIDC `alg:none` rejection), and MUST reject XML signature-wrapping — the signed element MUST be the same element whose contents are consumed.
- The host MUST enforce the assertion validity window (`NotBefore` / `NotOnOrAfter`); assertions outside the window MUST be rejected.
- The host MUST map asserted attributes onto an RFC 0048 `principal` (opaque, non-PII per `auth.md` §"Identity claims") and, where group attributes are present, onto RFC 0049 roles.
- The host MUST surface failures via the canonical envelope: `unauthenticated` for bad/absent signature, `alg:none`, expired/not-yet-valid windows, or wrapping; `forbidden` for assertion-valid-but-scope-insufficient.

**Discovery shape:** `capabilities.auth.profiles[]` includes `openwop-auth-saml`.

**Conformance gaps to close:** a synthetic SAML IdP harness (deterministic signed assertions + the negative variants below) so the suite can verify validation without a real IdP. Until it ships, `auth-saml-profile.test.ts` verifies the advertisement shape and gates the assertion-validation behavior (1 positive + ≥6 negatives: bad signature, `alg:none`, absent signature, `NotOnOrAfter` expiry, `NotBefore` not-yet-valid, signature-wrapping) on an operator-supplied synthetic IdP.

---

### `openwop-auth-scim` (RFC 0050)

The host exposes SCIM 2.0 provisioning endpoints (`/scim/v2/Users`, `/scim/v2/Groups`) that sync external IdP users/groups onto RFC 0048 principals + RFC 0049 roles, so enterprise lifecycle (joiner/mover/leaver) flows through the standard provisioning protocol rather than bespoke host APIs.

**Requirements:**

- The host MUST expose `/scim/v2/Users` and `/scim/v2/Groups` and, on provisioning operations, upsert RFC 0048 principals and RFC 0049 roles: `POST`/`PUT`/`PATCH /Users` ⇒ principal create/update; `POST`/`PUT`/`PATCH /Groups` ⇒ role-membership sync (a SCIM group maps to an RFC 0049 role).
- The host MUST treat `DELETE /Users/{id}` (or `active: false`) as a **deactivation**: a deactivated principal's subsequent authorization decisions MUST deny (fail-closed, composing with RFC 0049 §C).
- The host MUST authenticate SCIM requests (bearer token per the IdP's SCIM client config) and MUST NOT expose provisioning to unauthenticated callers.

**Discovery shape:** `capabilities.auth.profiles[]` includes `openwop-auth-scim`.

**Conformance gaps to close:** a synthetic SCIM client harness; until it ships, `auth-scim-profile.test.ts` verifies the advertisement shape and gates the user+group provisioning roundtrip (→ principal/role assertion; deactivate ⇒ subsequent deny) on an operator-supplied SCIM endpoint.

---

### `openwop-auth-ldap` (RFC 0050, optional)

An optional directory-bind variant for hosts with on-prem LDAP/Active Directory: bind-and-search authentication mapping a DN onto an RFC 0048 `principal` and LDAP groups onto RFC 0049 roles. **Lower priority** than SAML/SCIM — included for completeness; most enterprise demand is SAML/SCIM. A host advertising `openwop-auth-ldap` MUST map the bound DN to an opaque, non-PII `principal` and enforce openwop scopes on top of directory-group membership.

**Discovery shape:** `capabilities.auth.profiles[]` includes `openwop-auth-ldap`.

---

### Subject linking (SAML ⟷ SCIM) — RFC 0159

`openwop-auth-saml` (authentication) and `openwop-auth-scim` (provisioning) are independent lanes: SCIM `active:false`/`DELETE` deactivates *its* provisioned principal, and SAML validates an assertion onto *its* principal, but nothing ties the two to the same human. On a host advertising **both** profiles this leaves a leaver gap — a person deactivated over SCIM can still authenticate over SAML, because the two lanes map to structurally different RFC 0048 principals. This subsection closes that gap as an **opt-in** obligation, discoverable via `capabilities.auth.subjectLinking`.

The obligations below apply to a host that advertises `openwop-auth-saml` **and** `openwop-auth-scim` **and** sets `capabilities.auth.subjectLinking: true`.

**Requirements:**

- The host MUST maintain a **subject link** between the RFC 0048 `principal` produced by SAML assertion validation and the `principal` produced by SCIM provisioning when both denote the same human. The link key MUST be an **opaque, IdP-asserted, stable** identifier — the SCIM resource `externalId` matched to the SAML persistent-format `NameID` (or a host-configured stable linking attribute asserted by the same IdP). The link MUST be scoped to a **single tenant**; the host MUST NOT link identities across tenants.
- The host MUST NOT use email, `userName`, display name, or any operator/user-mutable attribute as the link key. (A mutable/PII key lets a caller who can influence that attribute join — and inherit — another subject: an account-takeover join vector.)
- When SCIM deactivates a provisioned user (`DELETE /Users/{id}` or `PATCH` to `active:false`), the host MUST deny subsequent authorization decisions for the **linked** SAML identity as well, fail-closed (composing with RFC 0049 §C) — not only for the SCIM-provisioned principal. Equivalently: after a SCIM deactivation, a SAML assertion for the linked subject MUST NOT yield an authorized decision.
- If no opaque IdP-stable link key is available for a pair of identities (the IdP asserts no persistent `NameID` / no `externalId`), the host MUST NOT claim the combined leaver guarantee for those identities: it MUST either treat them as independent subjects (and not set `subjectLinking: true`) or fail closed on the SAML lane for the unlinkable subject. A host MUST NOT silently fall back to a mutable/PII key, and MUST NOT advertise `subjectLinking: true` while any admitted identity pair is joined on a non-conforming key.

The link is a **reference, not a merge**: the two durable subjects (`saml:…` and `scim:…`) remain distinct records — nothing rewrites a subject key already stamped on a run (which would break replay / `:fork`: the `owner` triple is echoed on `run.started` per RFC 0048 §C and read verbatim on fork per RFC 0006). Deactivation sets a link-scoped deny that the SAML decision path consults.

**Discovery shape:** `capabilities.auth.subjectLinking: true` (optional boolean; absent/false = the lanes are independent and the combined leaver guarantee is not claimed). A host MUST NOT set it true unless both `openwop-auth-saml` and `openwop-auth-scim` are in `capabilities.auth.profiles[]` and the obligations above hold.

#### Link-key-class declaration and same-IdP trust root — RFC 0163

RFC 0163 hardens the two obligations above that were, in RFC 0159, only partially witnessable: the "MUST NOT key on a mutable/PII attribute" (above) was a negative-existence property a suite cannot exhaustively falsify, and the acceptable stable-key set and the two lanes' trust-root relationship were left open. Both additions below apply to the same opt-in host (advertising both profiles with `capabilities.auth.subjectLinking: true`).

**Declarable, witnessable link-key class:**

- A host that advertises `capabilities.auth.subjectLinking: true` MUST also advertise `capabilities.auth.subjectLinkKey`, whose value MUST be one of the **closed enum** of allowed classes: `opaque-idp` (SCIM `externalId` ↔ persistent-format SAML `NameID` — the default pairing above) or `configured-immutable` (a host-configured attribute, asserted by the same IdP on both lanes, that satisfies the conjunctive predicate **opaque ∧ stable for the lifetime of the account ∧ never reassigned ∧ non-PII ∧ not influenceable by the user or a tenant operator** — e.g. a directory object id or an immutable-id claim). The enum names **classes**, not attributes: the specific attribute a `configured-immutable` host joins on stays host configuration; the promise about its class goes on the wire. Both classes name an opaque, IdP-asserted, stable, non-PII identifier. The co-requirement is also expressed in `capabilities.schema.json` as a conditional (`subjectLinking: true` ⇒ `subjectLinkKey` required), so a discovery document that claims linking without a class fails schema validation as well as the conformance scenario.
- A host MUST NOT advertise a `subjectLinkKey` it does not honour: the declared class MUST be the class the host actually joins on (advertise only what you honour, per RFC 0011 / RFC 0048 §D).
- The enum is **allowed-classes-only**. `email`, `userName`, `displayName`, and every mutable-or-PII attribute are absent from it by construction — a conforming discovery document cannot name one. This is the witness: the "MUST NOT use a mutable key" prohibition becomes "a host cannot *say* it uses one and stay conforming, and MUST honour what it says", which a conformance suite asserts positively (the declared class is a member of the safe set) rather than as an unfalsifiable negative.

**Same-IdP trust root (before a link may form):**

- The host MUST NOT form a subject link between a SAML-asserted principal and a SCIM-provisioned principal unless both lanes are fed by the **same IdP trust root**: the issuer of the SAML assertion MUST correspond to the same IdP that provisioned the SCIM resource. An opaque identifier that collides across two *different* IdPs MUST NOT join two principals. Correspondence is established by comparing the SAML assertion's `<saml:Issuer>` (the IdP entityID, which MUST lie inside the signed element) against the IdP entityID the host recorded for the SCIM connection when that connection was configured. The SCIM lane carries no issuer on the wire (it authenticates by bearer token), so the host MUST bind each SCIM client credential to exactly one IdP entityID at configuration time and MUST NOT infer it from the request.
- If the host cannot establish that the two lanes share an IdP trust root for a candidate pair, it MUST NOT form the link and MUST NOT claim the combined leaver guarantee for that pair on the strength of a cross-IdP identifier match (composing with the "fail closed absent a link key" requirement above). This same-IdP scoping composes with the same-**tenant** MUST: a link requires both same-tenant and same-IdP-trust-root.

**Discovery shape (RFC 0163):** `capabilities.auth.subjectLinkKey: "opaque-idp" | "configured-immutable"` (string, closed enum; schema-required whenever `subjectLinking` is `true`, absent otherwise — absence alongside `subjectLinking:true` or an out-of-enum value fails schema validation and is non-conforming).

**Conformance gaps to close:** `auth-subject-link.test.ts` (RFC 0159), gated on `capabilities.auth.subjectLinking`, verifies (positive) that a SCIM-provisioned user linked by `externalId` to a SAML persistent `NameID`, once SCIM-deactivated, yields a **denied** SAML decision; and (negative) that a link configured on a mutable key (email) never produces a cross-lane pass. `auth-subject-link-key-class.test.ts` (RFC 0163) verifies the `subjectLinkKey` advertisement unaided and, over a two-trust-root seam (`OPENWOP_TEST_SAML_IDP_URL` + `OPENWOP_TEST_SAML_IDP_URL_B` + `OPENWOP_TEST_SCIM_URL`), that a same-IdP pair links while a cross-IdP identifier collision does not. Both reuse the bundled synthetic SAML IdP (`conformance/src/lib/saml-idp.ts`, whose two-trust-root behaviour is proven server-free in `saml-idp.test.ts`) + a synthetic SCIM payload; the live paths are opt-in via the seams named above. Registered invariants: `subject-link-leaver-deny`, `subject-link-key-class-declared`, `subject-link-same-trust-root`.

---

## Discovery guidance

As of RFC 0010 (2026-05-11), auth-profile metadata has a **formal schema location** at `capabilities.auth.*` in `schemas/capabilities.schema.json`. Hosts SHOULD advertise auth-profile claims and metadata here. The `extensions.auth.*` location below remains valid for historical reasons; clients MUST prefer `capabilities.auth.*` when both are present.

**Preferred (RFC 0010, formal schema):**

```json
{
  "auth": {
    "profiles": ["openwop-auth-api-key-rotation", "openwop-auth-oauth2-client-credentials", "openwop-auth-oidc-user-bearer"],
    "rotation": { "supported": true, "minGraceSeconds": 86400 },
    "oauth2": {
      "supported": true,
      "issuer": "https://issuer.example.com/",
      "audience": "https://api.example.com/openwop",
      "supportedAlgorithms": ["RS256", "ES256"]
    }
  }
}
```

**Legacy (extension namespace; still valid):**

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

This advertisement is advisory. A host passes an auth profile only by satisfying the documented behavior and the corresponding conformance scenarios (`auth-api-key-rotation.test.ts`, `auth-oauth2-client-credentials.test.ts`, `auth-oidc-user-bearer.test.ts`, `auth-mtls.test.ts`).

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

<!-- normative-example: audit-verify-result.schema.json -->
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
```

### Conformance

A host claims the profile by:

- Advertising `capabilities.auth.profiles` includes `openwop-audit-log-integrity`.
- Passing the black-box suite scenario `audit-log-integrity.test.ts` — profile-shape, `GET /v1/audit/verify` returning `{chainValid, checkpoints, anomalies}`, the `checkpointsValid` chain re-walk, and at least one signed checkpoint with a non-empty signature.
- Tamper detection — mutating an entry or forging a checkpoint signature and asserting `chainValid: false` — requires admin access to the audit store, so it is covered **host-internally** (`examples/hosts/{sqlite,postgres}/test/audit-tamper.test.ts`) rather than by the black-box suite.
- Cross-host re-anchoring — an out-of-band verifier checking an exported checkpoint bundle's Ed25519 signatures independently of the host — is exercised by the standalone `scripts/verify-audit-checkpoints.mjs` against the export producer `examples/hosts/postgres/src/audit-export.ts` (round-trip in `examples/hosts/postgres/test/audit-checkpoint-export.test.ts`; the verifier is regression-guarded in `openwop:check` against the committed sample bundles in `conformance/audit-export-samples/`).

The profile is **strongly RECOMMENDED** as a precondition for any host commissioning an external security review (Track 9 in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`): the review's value depends on the log being trustworthy.

## Public-release checklist

- Publish supported auth profiles in the host README or compatibility page.
- Document token/key issuance, revocation, and emergency disable procedures.
- Verify all auth failures use the canonical error envelope and never echo credentials.
- Run the conformance suite with auth-profile scenarios enabled for each claimed profile.
- Include the suite version and profile pass result in `INTEROP-MATRIX.md`.
