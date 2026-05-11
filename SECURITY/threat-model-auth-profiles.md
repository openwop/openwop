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
| A1 | Stolen old API key holder | Uses a key during or after rotation. |
| A2 | Token substitution attacker | Presents a valid OAuth2 token for the wrong audience, issuer, or tenant. |
| A3 | Scope-confusion attacker | Obtains a token with unrelated identity-provider scopes and attempts OpenWOP operations. |
| A4 | mTLS downgrade attacker | Connects through a proxy path that strips client-certificate enforcement. |
| A5 | Enumeration attacker | Uses error differences to learn whether a tenant, key id, certificate subject, or client id exists. |
| A6 | Log reader | Reads auth failures, audit logs, or traces but cannot read the credential store directly. |

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

## 5. Webhook relationship

Webhook HMAC signing is not a replacement for caller authentication. It authenticates host-to-subscriber deliveries after a subscription already exists. Auth profiles govern who may register or unregister subscriptions; `webhooks.md` governs how deliveries are signed and verified.

During key rotation, existing webhook delivery secrets are unaffected unless the host documents a coupled rotation policy. Operators SHOULD avoid tying API-key rotation to webhook-secret rotation unless they can coordinate receiver updates.

## 6. Residual risks

- **Identity-provider compromise.** OAuth2 profiles depend on the issuer. If the issuer is compromised, OpenWOP cannot distinguish forged-but-valid tokens from legitimate ones.
- **Proxy misconfiguration.** mTLS often terminates before the application. Hosts must treat untrusted forwarded certificate headers as attacker-controlled.
- **Client storage leakage.** Local credential storage is client-specific; host-side profile semantics cannot prevent a client from leaking its own key.

## 7. Verification

The current public conformance suite verifies the baseline API-key contract. Auth-profile scenarios are intentionally profile-gated future work:

- API-key rotation overlap and revoke behavior.
- OAuth2 issuer/audience/scope mapping with a synthetic test issuer.
- mTLS positive and negative cases for hosts that expose test certificates.

Until those scenarios ship, a host claiming an auth profile SHOULD publish its own test evidence and operational runbook.
