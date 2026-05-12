# Threat Model: Auth Profiles

> **Scope:** Optional production-auth profiles in `spec/v1/auth-profiles.md`: API-key rotation, OAuth2 client credentials, and mTLS. Covers profile-specific failure modes layered on top of the baseline bearer-token contract in `spec/v1/auth.md`.
> **Last updated:** 2026-05-10
> **Companion artifacts:** `spec/v1/auth.md` · `spec/v1/auth-profiles.md` · `spec/v1/webhooks.md` · `SECURITY/threat-model-secret-leakage.md`.

## 1. Why this model

The baseline OpenWOP auth contract is intentionally small: bearer credentials, scopes, tenant isolation, canonical error envelopes, and no credential echo. Production hosts commonly add OAuth2, key rotation, or mTLS. Those profiles improve security only if they do not introduce downgrade paths, authorization oracles, or confusing overlap windows.

This model captures the threats profile implementers should account for before claiming an auth profile publicly.

## 2. Trust boundaries

```
[Client / CI / agent]
        │ bearer key, OAuth2 token, or mTLS cert
        ▼
[OpenWOP host auth layer]
        │ principal, tenant, scopes
        ▼
[OpenWOP operation authorization]
        │ run / webhook / artifact / pack operation
        ▼
[Event log, audit log, error envelope]
```

Trust transitions:

- **T1: Credential issuance to client storage.** A key, token, or certificate is issued outside the protocol and stored by the caller.
- **T2: Client to host.** Credentials cross the wire and are validated before any operation-specific logic.
- **T3: Host auth to operation authorization.** The validated principal maps to OpenWOP scopes and tenant/project boundaries.
- **T4: Host to observable surfaces.** Failures, audit events, and logs must describe the outcome without exposing credential material.

## 3. Adversaries

| ID | Adversary | Capability |
|---|---|---|
| A1 | Stolen old API key holder | Uses a key during or after rotation. Scenario coverage: `auth-api-key-rotation.test.ts` (overlap + canary-redaction). |
| A2 | Token substitution attacker | Presents a valid OAuth2 token for the wrong audience, issuer, or tenant. Scenario coverage: `auth-oauth2-client-credentials.test.ts` (wrong-aud / harness-minted negative cases) + `auth-oidc-user-bearer.test.ts` (wrong-iss / wrong-aud). |
| A3 | Scope-confusion attacker | Obtains a token with unrelated identity-provider scopes and attempts OpenWOP operations. Scenario coverage: `auth-oidc-user-bearer.test.ts` (scope-insufficient → 403). |
| A4 | mTLS downgrade attacker | Connects through a proxy path that strips client-certificate enforcement. Scenario coverage: `auth-mtls.test.ts` (when `mtls.required: true`, bearer-only request MUST fail). |
| A5 | Enumeration attacker | Uses error differences to learn whether a tenant, key id, certificate subject, or client id exists. |
| A6 | Log reader | Reads auth failures, audit logs, or traces but cannot read the credential store directly. |
| A7 | OIDC IdP impersonation via key spoofing | Presents a token whose JWS header references a `kid` that is not in the issuer's published JWKS, betting on the host accepting the token without resolving the kid. Scenario coverage: `auth-oidc-user-bearer.test.ts` (unknown-kid → 401). |

## 4. STRIDE per profile

### 4.1 API-key rotation

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | Old key remains accepted forever after a rotation event | Hosts document and enforce a bounded grace window; revoked keys fail with canonical `401` or `403`. |
| Repudiation | Operator cannot tell which key version was used | Audit events include key id or fingerprint, never raw key material. |
| Information disclosure | Rotation failure echoes the raw key or full fingerprint | Error envelopes and logs use redaction rules from `threat-model-secret-leakage.md`. |
| Denial of service | New key activation immediately invalidates long-running clients | Hosts support overlap windows and document emergency revoke behavior separately. |

### 4.2 OAuth2 client credentials

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | Token from a different issuer or audience is accepted | Hosts pin issuer and audience per `auth-profiles.md`. |
| Elevation of privilege | Identity-provider scopes are treated as OpenWOP scopes without mapping | Hosts map OAuth claims to OpenWOP operation scopes explicitly. |
| Information disclosure | Token introspection failure reveals client existence | Error envelopes remain canonical and do not distinguish unknown client from invalid token unless host policy documents that behavior. |
| Tampering | Weak or unexpected signing algorithm is accepted | Accepted algorithms are documented and pinned. |

### 4.3 mTLS

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | Certificate subject maps to the wrong tenant | Subject/SAN mapping rules are documented and tested. |
| Downgrade | A proxy path reaches the OpenWOP host without verified client certificate metadata | mTLS enforcement lives at the trusted edge or the host rejects missing verified certificate context. |
| Repudiation | Certificate rotations cannot be audited | Audit events include certificate fingerprint, not the certificate body or private key. |
| Denial of service | Certificate rollover has no overlap period | mTLS profile follows the same overlap principle as API-key rotation. |

### 4.4 OIDC user-bearer

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | Token signed with a key whose `kid` is not published in the issuer's JWKS | Hosts MUST fetch the issuer's JWKS, resolve the `kid` from the JWT header, and reject when no key matches. Verified by `auth-oidc-user-bearer.test.ts` unknown-kid case. |
| Tampering | Token claims modified after signing | Standard JWS verification (signature over header + payload). Verified by `auth-oidc-user-bearer.test.ts` end-to-end probe. |
| Repudiation | Operator cannot tell which IdP issued the verified principal | Audit events include the verified `iss` and `sub` claims, never the raw token. |
| Information disclosure | Token contents are logged at the application layer | `threat-model-secret-leakage.md` redaction harness covers `Authorization` headers; bearer tokens MUST NOT appear in event logs or error responses. |
| Elevation of privilege | Token bearer claims OpenWOP scopes the IdP did not grant | Hosts derive scopes from a documented mapping (`group-claim` / `scope-claim` / `host-acl`); token-valid-but-scope-insufficient returns 403, not 401. Verified by `auth-oidc-user-bearer.test.ts` scope-insufficient case (gated on `group-claim` hosts). |
| Denial of service | Long-cached tokens prevent timely IdP revocation | Hosts re-introspect at most `min(exp - now, introspectionIntervalSeconds)` per `auth-profiles.md`; default 300s. |

## 5. Webhook relationship

Webhook HMAC signing is not a replacement for caller authentication. It authenticates host-to-subscriber deliveries after a subscription already exists. Auth profiles govern who may register or unregister subscriptions; `webhooks.md` governs how deliveries are signed and verified.

During key rotation, existing webhook delivery secrets are unaffected unless the host documents a coupled rotation policy. Operators SHOULD avoid tying API-key rotation to webhook-secret rotation unless they can coordinate receiver updates.

## 6. Residual risks

- **Identity-provider compromise.** OAuth2 profiles depend on the issuer. If the issuer is compromised, OpenWOP cannot distinguish forged-but-valid tokens from legitimate ones.
- **Proxy misconfiguration.** mTLS often terminates before the application. Hosts must treat untrusted forwarded certificate headers as attacker-controlled.
- **Client storage leakage.** Local credential storage is client-specific; host-side profile semantics cannot prevent a client from leaking its own key.

## 7. Verification

The public conformance suite verifies the baseline API-key contract plus capability-shape + negative-case coverage for each production-auth profile, shipped 2026-05-11 under RFC 0010 (`@openwop/openwop-conformance` 1.X.0):

- **API-key rotation** — `auth-api-key-rotation.test.ts`. Capability shape; two-key overlap when `OPENWOP_TEST_SECONDARY_API_KEY` is supplied; canary-redaction on invalid-bearer rejection.
- **OAuth2 client credentials** — `auth-oauth2-client-credentials.test.ts`. Capability shape; malformed-JWT 401; harness-minted negative cases (wrong-aud / expired / alg-spoofed) gated on `OPENWOP_TEST_OAUTH_ISSUER_TRUSTED`; operator-supplied positive token gated on `OPENWOP_TEST_OAUTH_TOKEN`.
- **OIDC user-bearer** — `auth-oidc-user-bearer.test.ts` + synthetic OIDC issuer harness at `conformance/src/lib/oidc-issuer.ts` (RS256 + ES256 via node:crypto stdlib). Capability shape; six harness-driven validation cases (wrong-iss / wrong-aud / expired / unknown-kid / valid-token-yields-201-or-403 / scope-insufficient → 403) gated on `OPENWOP_TEST_OIDC_ISSUER_URL`.
- **mTLS** — `auth-mtls.test.ts`. Capability shape always; behavior gated on `OPENWOP_TEST_MTLS=1` plus operator-supplied cert paths (`OPENWOP_TEST_MTLS_CLIENT_CERT_PATH`, `OPENWOP_TEST_MTLS_CLIENT_KEY_PATH`).

All four scenarios use `behaviorGate(profileName, advertised)`; `OPENWOP_REQUIRE_BEHAVIOR=true` converts capability-shape-only skips into hard failures.

Until those scenarios ship, a host claiming an auth profile SHOULD publish its own test evidence and operational runbook.
