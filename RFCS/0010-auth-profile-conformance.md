# RFC 0010: Auth-Profile Conformance

| Field | Value |
|---|---|
| **RFC** | 0010 |
| **Title** | Auth-Profile Conformance |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-11 |
| **Updated** | 2026-05-12 (Draft → Active; bootstrap-phase steward decision per `CONTRIBUTING.md` §"Bootstrap-phase notes" — the standard 7-day additive comment window was waived because no non-steward maintainer is yet listed in `MAINTAINERS.md`. The four unresolved questions remain open and may be revisited as additive sub-RFCs without breaking v1 wire compatibility. Same precedent as RFC 0009.) |
| **Affects** | `spec/v1/auth-profiles.md`, `schemas/capabilities.schema.json`, `conformance/src/scenarios/` (3 new + 1 opt-in), `conformance/src/lib/oidc-issuer.ts` (new harness), `conformance/coverage.md`, `INTEROP-MATRIX.md`, `SECURITY/threat-model-auth-profiles.md`, optionally `examples/hosts/sqlite/` or `postgres/` (reference implementation) |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Convert the four production-auth profiles in `spec/v1/auth-profiles.md` (`openwop-auth-api-key-rotation`, `openwop-auth-oauth2-client-credentials`, `openwop-auth-oidc-user-bearer`, `openwop-auth-mtls`) from prose-only claims into mechanically verified capability advertisements + conformance scenarios. Formalize `capabilities.auth` as a top-level schema block with `profiles[]` and per-profile metadata sub-blocks. Add three new conformance scenarios for the routinely-tested profiles plus one opt-in scenario for mTLS where cert provisioning is operator-environmental. Ship a synthetic OIDC issuer harness under `conformance/src/lib/oidc-issuer.ts` so OIDC validation can be exercised without depending on a real IdP.

## Motivation

`auth-profiles.md` defines four profiles for hosts that need stronger authentication than the baseline API-key bearer contract in `auth.md`. As of 2026-05-11:

- The profile prose is FINAL v1 and every profile has a "Conformance gaps to close" line. None of those gaps are closed.
- `conformance/src/scenarios/auth.test.ts` exercises only the baseline (missing credential → 401; invalid credential → 401). It does not cover rotation grace windows, OAuth2 token shapes, OIDC issuer validation, or mTLS.
- The Postgres reference host advertises `openwop-audit-log-integrity` (which lives under the same `capabilities.auth` namespace these new profiles will occupy) but no host advertises any of the four production-auth profiles, because there is no published conformance evidence to point at.
- The external security review tracked in `SECURITY/external-audit-engagement.md` (per `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 9) needs mechanically-verified auth surface before vendor outreach is credible — "we have prose for auth profiles" is weaker than "the conformance suite asserts rotation grace, OAuth shapes, OIDC issuer validation, and mTLS handling."

This RFC ships four artifacts as one coherent additive landing because the profiles share infrastructure (the `capabilities.auth` namespace, the canonical-envelope assertion pattern, threat-model overlap, and INTEROP-MATRIX advertisement). One consolidated RFC keeps the comment window shared; splitting into four parallel RFCs would multiply maintainer overhead without adding review fidelity. If a specific profile turns out to need a follow-up wire-shape decision, additive sub-RFCs remain possible.

## Proposal

### §A Capability shape

Add a top-level `capabilities.auth` block to `schemas/capabilities.schema.json`. The block is optional in v1; absence preserves the baseline auth contract. `additionalProperties: true` is preserved so the existing informal `auth.profiles[]` + `auth.auditLogIntegrity` shape (used by `audit-log-integrity.test.ts`) continues to work and is not blocked by this RFC.

Schema diff (relative to `schemas/capabilities.schema.json`):

```diff
   "properties": {
     ...
     "production": { ... },          // RFC 0009
+    "auth": {
+      "type": "object",
+      "description": "Auth-profile advertisement (auth-profiles.md). Optional in v1; absence preserves the baseline bearer-token contract from auth.md. RFC 0010 formalized this block; `additionalProperties: true` permits existing informal usages (auth.profiles[], auth.auditLogIntegrity from the audit-log-integrity profile) to continue alongside the formal sub-blocks.",
+      "properties": {
+        "profiles": {
+          "type": "array",
+          "items": { "type": "string", "minLength": 1 },
+          "uniqueItems": true,
+          "description": "Auth profiles the host claims. Canonical ids: `openwop-audit-log-integrity` (auth-profiles.md §Audit-log integrity), `openwop-auth-api-key-rotation`, `openwop-auth-oauth2-client-credentials`, `openwop-auth-oidc-user-bearer`, `openwop-auth-mtls`. Clients SHOULD tolerate unknown profile ids."
+        },
+        "rotation": {
+          "type": "object",
+          "description": "API-key rotation advertisement (auth-profiles.md §`openwop-auth-api-key-rotation`).",
+          "properties": {
+            "supported": { "type": "boolean" },
+            "minGraceSeconds": {
+              "type": "integer",
+              "minimum": 0,
+              "description": "Minimum rotation grace window in seconds. auth-profiles.md SHOULDs production-profile hosts to ≥ 86400 (24h). The scenario tolerates any non-negative value but flags < 86400 in behavior mode."
+            }
+          },
+          "additionalProperties": false
+        },
+        "oauth2": {
+          "type": "object",
+          "description": "OAuth2 client-credentials advertisement (auth-profiles.md §`openwop-auth-oauth2-client-credentials`).",
+          "properties": {
+            "supported": { "type": "boolean" },
+            "issuer": {
+              "type": "string",
+              "format": "uri",
+              "description": "Token issuer URL the host trusts. Tokens MUST carry a matching `iss` claim."
+            },
+            "audience": {
+              "type": "string",
+              "description": "Audience the host requires. Tokens MUST carry a matching `aud` claim."
+            },
+            "supportedAlgorithms": {
+              "type": "array",
+              "items": { "type": "string", "minLength": 1 },
+              "uniqueItems": true,
+              "description": "JWS signing algorithms the host accepts (canonical: RS256, ES256). Hosts MUST reject tokens signed with algorithms outside this list."
+            }
+          },
+          "additionalProperties": false
+        },
+        "oidc": {
+          "type": "object",
+          "description": "OIDC user-bearer advertisement (auth-profiles.md §`openwop-auth-oidc-user-bearer`).",
+          "properties": {
+            "supported": { "type": "boolean" },
+            "issuers": {
+              "type": "array",
+              "items": { "type": "string", "format": "uri" },
+              "minItems": 1,
+              "uniqueItems": true,
+              "description": "Trusted OIDC issuer URLs. The host accepts tokens whose `iss` claim matches any entry."
+            },
+            "audience": {
+              "type": "string",
+              "description": "Audience identifier the host requires in OIDC tokens."
+            },
+            "supportedScopeMapping": {
+              "type": "string",
+              "enum": ["group-claim", "scope-claim", "host-acl"],
+              "description": "How the host derives openwop scopes from the OIDC token. `group-claim`: from `groups` claim via host config. `scope-claim`: from `scope` claim directly. `host-acl`: from a host-side mapping table (sub → scope)."
+            },
+            "introspectionIntervalSeconds": {
+              "type": "integer",
+              "minimum": 0,
+              "description": "Maximum interval at which the host SHOULD re-introspect a cached token to detect IdP revocation. auth-profiles.md recommends `min(exp - now, 300)`."
+            }
+          },
+          "additionalProperties": false
+        },
+        "mtls": {
+          "type": "object",
+          "description": "mTLS advertisement (auth-profiles.md §`openwop-auth-mtls`).",
+          "properties": {
+            "supported": { "type": "boolean" },
+            "required": {
+              "type": "boolean",
+              "description": "When `true`, the host rejects bearer-only requests. When `false`, mTLS is optional and complements bearer auth."
+            },
+            "subjectMapping": {
+              "type": "string",
+              "enum": ["cn", "san-dns", "san-uri"],
+              "description": "How the host derives the transport principal from the client certificate. `cn`: subject CN. `san-dns`: subjectAltName DNS entry. `san-uri`: subjectAltName URI entry."
+            }
+          },
+          "additionalProperties": false
+        }
+      },
+      "additionalProperties": true
+    }
   }
```

`auth-profiles.md` §"Discovery guidance" currently advertises this metadata under `extensions.auth.*`. RFC 0010 promotes it to `capabilities.auth.*` (matching the audit-log-integrity precedent). The `extensions.auth.*` location remains valid for hosts that haven't migrated; clients SHOULD prefer `capabilities.auth.*` when both are present. This is a non-breaking documentation update to `auth-profiles.md`.

### §B Scenario: `auth-api-key-rotation.test.ts`

Asserts the rotation contract from `auth-profiles.md` §`openwop-auth-api-key-rotation`.

- **Gating:** `behaviorGate('openwop-auth-api-key-rotation', capabilities.auth.profiles.includes('openwop-auth-api-key-rotation') && capabilities.auth.rotation?.supported === true)`.
- **Setup:** operator supplies a primary API key via `OPENWOP_API_KEY` (already required for the suite) and a secondary key via `OPENWOP_TEST_SECONDARY_API_KEY`. The two keys MUST map to the same principal + tenant (the rotation invariant).
- **Assertions:**
  1. Both keys authenticate `POST /v1/runs` with the same fixture (`conformance-noop`); both return 201; both run-snapshots show the same `tenant` and `principal` (when audit surface is present).
  2. When `capabilities.auth.rotation.minGraceSeconds` is advertised, it is an integer ≥ 0; behavior-mode warns if < 86400 per `auth-profiles.md` SHOULD.
  3. An invalid bearer (synthetic canary, not either real key) returns `401 invalid_token` per the canonical envelope; the response body does NOT echo the canary in any field (redaction MUST hold even on rotation-profile hosts).
- **Soft-skip:** when `OPENWOP_TEST_SECONDARY_API_KEY` is unset, the overlap assertion soft-skips; capability shape still asserts.

### §C Scenario: `auth-oauth2-client-credentials.test.ts`

Asserts the OAuth2-CC contract from `auth-profiles.md` §`openwop-auth-oauth2-client-credentials`.

- **Gating:** `behaviorGate('openwop-auth-oauth2-client-credentials', capabilities.auth.profiles.includes('openwop-auth-oauth2-client-credentials') && capabilities.auth.oauth2?.supported === true)`.
- **Positive case:** operator supplies a valid token via `OPENWOP_TEST_OAUTH_TOKEN`. The scenario submits `Authorization: Bearer <token>` to `POST /v1/runs`; expects 201 + canonical RunSnapshot.
- **Negative cases (no operator setup required):**
  1. Malformed JWT (e.g., `Bearer not.a.real.jwt`) → 401 `invalid_token`.
  2. Token signed with HS256 (or any algorithm NOT in `supportedAlgorithms`) → 401.
  3. Token with wrong `aud` claim (synthetic via the OIDC issuer harness from §E) → 401 with `details.reason` SHOULD indicate audience mismatch.
  4. Token with valid signature but expired `exp` → 401.
- **Capability shape:** when `oauth2.issuer` is advertised, it MUST be a valid URI; `audience` MUST be a non-empty string; `supportedAlgorithms` MUST be a non-empty array.
- **Soft-skip:** when `OPENWOP_TEST_OAUTH_TOKEN` is unset, positive case soft-skips; negative cases still run.

### §D Scenario: `auth-oidc-user-bearer.test.ts`

Asserts the OIDC contract from `auth-profiles.md` §`openwop-auth-oidc-user-bearer`. Uses the synthetic OIDC issuer harness from §E so the suite can mint and present tokens with controlled claims.

- **Gating:** `behaviorGate('openwop-auth-oidc-user-bearer', capabilities.auth.profiles.includes('openwop-auth-oidc-user-bearer') && capabilities.auth.oidc?.supported === true)`.
- **Harness boot:** scenario boots a `SyntheticOIDCIssuer` in-process (per §E), publishes JWKS, mints tokens. The host MUST be pre-configured to trust the harness's issuer URL — operator wires this via `OPENWOP_TEST_OIDC_ISSUER_URL` and the host's config.
- **Assertions:**
  1. Token with valid signature + matching `iss`/`aud`/`exp`/`sub` → host returns 201 on `POST /v1/runs`; `sub` claim threads into the run's audit/principal surface (when discoverable).
  2. Token with valid signature + wrong `iss` → 401.
  3. Token with valid signature + wrong `aud` → 401 with `details.reason` indicating audience mismatch.
  4. Expired token (`exp` < now) → 401.
  5. Token signed with an unknown JWKS key (key id not published by the harness) → 401.
  6. Token-valid-but-scope-insufficient (e.g., minted with empty `groups` claim against a `group-claim` mapping host) → 403 `forbidden`.
- **Soft-skip:** when `OPENWOP_TEST_OIDC_ISSUER_URL` is unset, the scenario asserts only capability shape.

### §E Synthetic OIDC issuer harness — `conformance/src/lib/oidc-issuer.ts`

A minimal in-process OIDC issuer the conformance suite mints tokens against. Server-free; no external dependencies beyond `node:crypto`.

Interface:

```typescript
export interface SyntheticOIDCIssuerOptions {
  issuer: string;                      // base URL (caller supplies; not bound)
  audience: string;
  algorithm: 'RS256' | 'ES256';        // default RS256
  keyId?: string;                      // default 'openwop-conformance-key-1'
}

export interface MintedToken {
  token: string;                       // signed JWT
  claims: Record<string, unknown>;
}

export interface SyntheticOIDCIssuer {
  readonly issuer: string;
  readonly audience: string;
  readonly algorithm: 'RS256' | 'ES256';
  readonly jwksJson: string;           // serve at $issuer/.well-known/jwks.json
  readonly discoveryJson: string;      // serve at $issuer/.well-known/openid-configuration

  mint(claims: Record<string, unknown>, opts?: { expiresInSeconds?: number; keyId?: string }): MintedToken;
  rotateKey(): void;                   // generate a new signing key; jwksJson updates
}

export function createSyntheticOIDCIssuer(opts: SyntheticOIDCIssuerOptions): SyntheticOIDCIssuer;
```

The harness:
- Generates an RSA or EC keypair on construction via `node:crypto.generateKeyPairSync`.
- Serializes the public key as JWKS (`kty`, `kid`, `alg`, `n`+`e` for RSA, `crv`+`x`+`y` for EC).
- Mints tokens by signing the JWT header + payload with `node:crypto.sign`.
- The discovery + JWKS JSON strings are caller-served — the harness does NOT bind a port itself. Scenarios stand up a minimal HTTP server (via `node:http`) to publish them, or the host can be pre-configured with the harness's discovery document fed via env.

This is server-free: the harness runs inside the vitest worker process. Tokens are minted synchronously.

### §F Scenario: `auth-mtls.test.ts` (opt-in)

mTLS is environmental (cert provisioning, server config); the conformance scenario is opt-in following the `restart-during-run.test.ts` precedent.

- **Gating:** `RUN_THIS_SCENARIO = process.env.OPENWOP_TEST_MTLS === '1'`. When unset, scenario skips entirely (vitest `describe.skipIf`).
- **Operator setup:**
  - `OPENWOP_TEST_MTLS_CLIENT_CERT_PATH` — path to PEM-encoded client cert.
  - `OPENWOP_TEST_MTLS_CLIENT_KEY_PATH` — path to PEM-encoded client key.
  - `OPENWOP_TEST_MTLS_CA_PATH` — optional path to CA bundle for server-cert validation.
- **Assertions:**
  1. Request with valid client cert + valid bearer → 201 on `POST /v1/runs`.
  2. Request with invalid client cert → either 401 `invalid_token` envelope OR a transport-layer TLS failure (both are conformant per `auth-profiles.md` §`openwop-auth-mtls`; the scenario MAY assert either).
  3. When `capabilities.auth.mtls.required === true`, a bearer-only request (no client cert) MUST fail; the scenario submits a no-cert request and asserts non-2xx.
- **Capability shape:** the shape check runs unconditionally (cheap discovery probe); the behavior portion runs only under `OPENWOP_TEST_MTLS=1`.

### §G `SECURITY/threat-model-auth-profiles.md` updates

Add the rotation/OAuth/OIDC scenario-specific failure modes to the existing threat model:

- **A1 (Stolen old API key holder):** scenario coverage = rotation revocation assertion in §B (revoked-old-key returns 401, not a partial pass).
- **A2 (Token substitution attacker):** scenario coverage = `wrong-aud` + `wrong-iss` negative cases in §C + §D.
- **A3 (new): OIDC IdP impersonation via key spoofing.** Adversary presents a token signed with a key whose `kid` is not in the published JWKS. Scenario coverage = §D #5.
- **A4 (new): mTLS downgrade via missing-cert.** Adversary connects without a client cert to a host claiming `mtls.required: true`. Scenario coverage = §F #3.

The existing threat-model document already enumerates A1 + A2; this RFC adds the scenario-binding line for each and introduces A3 + A4.

### §H INTEROP-MATRIX guidance

`INTEROP-MATRIX.md` "Compatibility profile claim" column gains entries for each auth profile a host advertises. A host claiming `openwop-auth-oidc-user-bearer` lists it alongside `openwop-core` (or wherever profile order makes sense). The conformance link column records which auth-profile scenarios passed under `OPENWOP_REQUIRE_BEHAVIOR=true`.

Hosts that don't claim any production-auth profile remain v1-conformant via baseline auth.md — no advertisement needed.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1:

- New `capabilities.auth` block is optional; absence preserves v1.0 behavior.
- Sub-blocks each have their own `supported: boolean`; absence on a specific sub-block means the host doesn't claim that profile.
- `additionalProperties: true` on the `auth` block preserves the existing informal `auditLogIntegrity` advertisement (used by `audit-log-integrity.test.ts`).
- New scenarios are capability-gated; v1.0 hosts that don't advertise any auth profile skip cleanly.
- No new error codes; the canonical `401`/`403` envelopes are already-normated v1 wire shapes (`auth.md` §3).
- mTLS scenario is opt-in via env var, matching the `restart-during-run.test.ts` precedent.

## Conformance

Existing scenarios that cover this surface (de facto baseline): `auth.test.ts` (missing/invalid credential).

New scenarios required by this RFC:

1. `conformance/src/scenarios/auth-api-key-rotation.test.ts` — §B.
2. `conformance/src/scenarios/auth-oauth2-client-credentials.test.ts` — §C.
3. `conformance/src/scenarios/auth-oidc-user-bearer.test.ts` — §D.
4. `conformance/src/scenarios/auth-mtls.test.ts` — §F, opt-in.
5. `conformance/src/lib/oidc-issuer.ts` — §E (library, not a scenario).

All four scenarios use `behaviorGate(profileName, advertised)`; `OPENWOP_REQUIRE_BEHAVIOR=true` converts capability-shape-only skips into hard failures, matching the audit-log-integrity precedent.

## Alternatives considered

1. **Four separate RFCs (0010 rotation, 0011 OAuth2, 0012 OIDC, 0013 mTLS).** Rejected: the profiles share infrastructure (capability namespace, envelope assertion pattern, threat-model categories, INTEROP-MATRIX column) and one consolidated RFC keeps the comment window shared. Splitting multiplies maintainer overhead without adding review fidelity. If a specific profile turns out to need a wire-shape decision, an additive sub-RFC remains possible.

2. **Skip the synthetic OIDC issuer harness; require operators to wire a real IdP.** Rejected: the negative-case tokens (wrong aud, wrong iss, expired, unknown key) cannot be minted against a real IdP without IdP-admin tooling that varies per vendor. The synthetic harness keeps CI hermetic; real-IdP interop remains a separate (post-Active) operator step.

3. **Bake the auth advertisement into `extensions.auth.*` as `auth-profiles.md` currently shows.** Rejected: `extensions` is the catch-all for unschema'd metadata, but rotation/OAuth/OIDC/mTLS metadata is now stable enough to formalize. Promoting to `capabilities.auth.*` matches the audit-log-integrity precedent and gives the conformance scenarios a typed schema to gate against. The `extensions.auth.*` path remains valid (`additionalProperties: true` on the top-level capabilities object); clients SHOULD prefer `capabilities.auth.*` when both are present.

4. **Do nothing.** Rejected: `auth-profiles.md` has shipped four profiles for over six weeks (FINAL v1 since 2026-05-10) with zero conformance coverage and zero advertising hosts. Each day this gap stays open, the protocol's production-auth story is "trust the spec text" rather than "trust the suite."

## Unresolved questions

1. **Rotation overlap assertion granularity.** §B asserts both keys authenticate. Should the suite also assert audit-log-event distinguishability (`key.created` / `key.used` / `key.revoked` events per `auth-profiles.md`)? That requires audit-log surface a host MAY or MAY NOT expose; it could land as a §B addendum if the audit-log-integrity profile is co-advertised. Out of scope by default.

2. **OIDC harness key-rotation testing.** §E exposes `rotateKey()` but §D doesn't assert host-side behavior on rotation. Adding a "key rotated mid-flight; old tokens continue working through grace; new tokens use new key" scenario is valuable but doubles the harness setup. Defer to a sub-RFC.

3. **mTLS subject-mapping ambiguity.** §A advertises `subjectMapping: cn|san-dns|san-uri`. Real-world deployments often combine these (e.g., fall back from SAN to CN). Should the schema support an array of fallback rules, or stay single-valued? Out of scope; the schema is single-valued for now and hosts with complex mapping use `extensions.auth.*` for documentation.

4. **OAuth2-CC vs OIDC overlap.** A host accepting OIDC user-bearer tokens with the `client_credentials` grant flow is technically conformant to both profiles. Should `auth.profiles[]` allow simultaneous advertisement, and should §C + §D handle overlap explicitly? Current draft permits both advertisements; scenarios run independently. Worth a sentence in `auth-profiles.md` clarification but not blocking.

5. **Tighten `capabilities.auth.additionalProperties` to `false`.** The schema landed in §A intentionally uses `additionalProperties: true` on the `auth` block so the existing informal `auth.auditLogIntegrity` advertisement (from the audit-log-integrity profile, predating RFC 0010) continues to validate alongside the four formal sub-blocks defined here. A follow-up additive RFC SHOULD formalize `auditLogIntegrity` as a fifth sub-block schema (with `additionalProperties: false`) and tighten the parent `auth` block to `additionalProperties: false` at the same time. Until that lands, hosts MAY add arbitrary keys under `capabilities.auth.*` — that's a documentation surface for unenumerated future-profile metadata, not an extension point clients should depend on.

## Implementation notes (non-normative)

- Suite version bump: `@openwop/openwop-conformance` `1.X.0` (next available minor after the RFC 0009 wave). Per `ROADMAP.md` line 24, conformance minors don't modify the wire contract.
- No SDK changes required — none of the wire shapes are SDK-side; the schema diff is server-advertised.
- The OIDC issuer harness (§E) uses `node:crypto` and stdlib JWT signing; no new npm dependencies. The existing `audit-log-integrity` scenario uses Ed25519 from `node:crypto` so the precedent is established.
- Reference-host implementation: SQLite or Postgres can adopt one rotation profile end-to-end as the worked example (per `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 3 §"Conformance gaps to close"). Most realistic: SQLite advertises `openwop-auth-api-key-rotation` since it has a smaller surface than OIDC.

## Acceptance criteria

- [ ] `RFCS/0010-auth-profile-conformance.md` merged at `Status: Active` after the 7-day comment window (or waived per bootstrap-phase rule).
- [ ] `schemas/capabilities.schema.json` includes the `auth` block per §A.
- [ ] `conformance/src/scenarios/auth-api-key-rotation.test.ts` lands capability-gated.
- [ ] `conformance/src/scenarios/auth-oauth2-client-credentials.test.ts` lands capability-gated.
- [ ] `conformance/src/scenarios/auth-oidc-user-bearer.test.ts` lands capability-gated.
- [ ] `conformance/src/scenarios/auth-mtls.test.ts` lands opt-in via `OPENWOP_TEST_MTLS=1`.
- [ ] `conformance/src/lib/oidc-issuer.ts` lands as the synthetic harness per §E.
- [ ] `conformance/coverage.md` §"Capability-gated scenarios" lists the four scenarios under per-profile gating.
- [ ] `auth-profiles.md` updated to cross-reference the new `capabilities.auth.*` discovery path (additive note; `extensions.auth.*` remains valid).
- [ ] `SECURITY/threat-model-auth-profiles.md` adds A3 + A4 plus scenario-binding lines for A1 + A2.
- [ ] One reference host (SQLite or Postgres) implements at least `openwop-auth-api-key-rotation` and passes the scenario under `OPENWOP_REQUIRE_BEHAVIOR=true`.
- [ ] `INTEROP-MATRIX.md` reflects the host's profile claim.
- [ ] `CHANGELOG.md` entries for the Draft drop and the post-Active landing.

## References

- `spec/v1/auth-profiles.md` — the prose this RFC mechanizes.
- `spec/v1/auth.md` §3 — canonical 401/403 error envelope.
- `RFCS/0009-production-profile-conformance.md` — same-pattern precedent (profile advertisement + capability shape + scenarios + behavior-mode gate).
- `conformance/src/scenarios/audit-log-integrity.test.ts` — the existing `capabilities.auth.profiles[]` consumer; informs the schema shape.
- `SECURITY/threat-model-auth-profiles.md` — companion threat-model surface.
- `SECURITY/external-audit-engagement.md` — downstream consumer of this RFC's evidence.
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 3 — the planning context.
