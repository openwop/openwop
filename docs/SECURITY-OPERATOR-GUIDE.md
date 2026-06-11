# OpenWOP Security Operator Guide

> DOC-5 from `plans/openwop-protocol-gap-closure-plan.md`. Distills the security-relevant surfaces an operator deploys, in checklist form, without forcing them to read all five threat models first.

This page is the **operator-side** view of OpenWOP's security posture. It assumes you've decided to deploy a host (yours or a reference) and want to enable the security surfaces that match your environment.

For the threat-model background, see [`SECURITY.md`](../SECURITY.md) + the five docs under [`SECURITY/threat-model-*.md`](../SECURITY/). For the protocol-tier invariant catalog (with test references), see [`SECURITY/invariants.yaml`](../SECURITY/invariants.yaml). This page tells you which knobs to turn — not why they exist.

---

## Auth profile decisions

Pick the auth profiles you actually validate. Advertise nothing else.

| Profile                                                                  | When to enable                                | Operator action                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API-key bearer** (`openwop-core` baseline)                             | Always.                                       | Generate a strong key (≥256 bits); store in your secrets manager; pass via `OPENWOP_API_KEY`.                                                                                                           |
| **API-key rotation** (`openwop-auth-api-key-rotation`)                   | When you can't atomically rotate all clients. | Configure `OPENWOP_SECONDARY_API_KEY` during overlap; both keys authenticate; remove the secondary post-rotation. Hosts MUST use constant-time dual-candidate comparison (the Postgres reference does). |
| **OAuth2 client-credentials** (`openwop-auth-oauth2-client-credentials`) | When machine clients authenticate via an IdP. | `OPENWOP_OAUTH2_ISSUER_URL` + `OPENWOP_OAUTH2_AUDIENCE`. JWKS fetched lazily; cached 10 min; re-fetched on `kid` miss.                                                                                  |
| **OIDC user-bearer** (`openwop-auth-oidc-user-bearer`)                   | When end-users authenticate via an IdP.       | `OPENWOP_OIDC_ISSUER_URL` + `OPENWOP_OIDC_AUDIENCE`. Same JWKS handling as OAuth2.                                                                                                                      |
| **mTLS** (`openwop-auth-mtls`)                                           | When your transport terminates mTLS.          | `OPENWOP_MTLS_CERT_PATH` + `OPENWOP_MTLS_KEY_PATH` + optional `OPENWOP_MTLS_CA_PATH` + `OPENWOP_MTLS_REQUIRED=true`. Host listens on HTTPS with `node:https.createServer({ requestCert: true })`.       |

### Auth honesty signals

- **Canary redaction**: failed auth (401) MUST NOT echo the rejected token in `message` or `details`. Verified by `auth-api-key-rotation.test.ts` + the Postgres host's `test/auth-rotation-scoped.test.ts`.
- **alg: "none" rejection**: JWT validators MUST reject `alg: "none"` per `auth-profiles.md` §"openwop-auth-oauth2-client-credentials". Verified by `test/oauth2-oidc.test.ts`.
- **Constant-time comparison**: API-key + JWT validation MUST use constant-time comparison to prevent timing attacks. Reference impls use `node:crypto.timingSafeEqual`.

---

## BYOK + secret redaction

Per RFC 0004 §D (SR-1) and [`auth.md`](../spec/v1/auth.md) §"Secret resolution".

### What the host does

- Resolves caller-supplied `credentialRef` strings to plaintext **inside the host**.
- Persists the SHA-256 of the cleartext + a placeholder `[REDACTED:<id>]` substitution.
- Plaintext NEVER lands in: `runs.variables_json`, event payloads, debug bundles, OTel attributes (host-internal allowlist), audit log entries, or webhook deliveries.

### What the operator wires

- Configure your secret resolver to source from your secrets manager (KMS, Vault, etc.). The Postgres reference uses `resolveCanarySecret` as a stub — replace with a real backend.
- Set `OPENWOP_AI_POLICY_<PROVIDER>` per provider per [`spec/v1/host-capabilities.md`](../spec/v1/host-capabilities.md) §"aiProviders.policies":
  - `disabled` — no credentialRef resolution for this provider; reject calls.
  - `optional` — caller MAY supply credentialRef; cleartext fallback rejected at runtime.
  - `required` — caller MUST supply credentialRef; cleartext attempts rejected with `provider_policy_denied`.
  - `restricted` — credentialRef only AND the credential must match a host-allowlisted fingerprint.

### Memory compaction (RFC 0012 §D)

If you enable `OPENWOP_MEMORY_COMPACTION=true`, the host re-routes derived (compacted) entry content through the BYOK redaction harness BEFORE persistence. The reference impl's `applyCompactionRedaction` re-substitutes `[BYOK:...]` form-leaks + non-canonical `<REDACTED:...>` markers with the canonical `[REDACTED:carry-forward-<n>]`. **Skipping this carry-forward is a SECURITY invariant violation** (`memory-compaction-sr-1-carry-forward` per `SECURITY/invariants.yaml`).

---

## Webhook signing

Per [`spec/v1/webhooks.md`](../spec/v1/webhooks.md) §"Signature recipe".

### Wire shape

```text
HMAC = SHA-256(secret, timestamp + "." + rawBody)
Header: openwop-Webhook-Signature: v1=<hmac-hex>
Header: openwop-Webhook-Timestamp: <unix-seconds>
```

### Operator wiring

- Generate a host-managed signing secret; pass via `OPENWOP_WEBHOOK_SIGNING_SECRET`.
- Each subscription receives a per-subscription secret on `POST /v1/webhooks` (returned once, never again).
- Receivers verify HMAC, then verify `now - timestamp < window` (default 5 min) to defeat replay.
- Algorithm versioning: hosts MAY claim `capabilities.webhooks.signatureAlgorithms: ["v1"]`; older clients tolerate the absence-equals-v1 default.

### SDK helpers

SDK-3 closed 2026-05-15. All three reference SDKs ship typed register / unregister + HMAC verification helpers:

- **TypeScript:** `client.webhooks.register(body, opts?)` + `client.webhooks.unregister(id)` + `verifyWebhookSignature(secret, sigHeader, tsHeader, rawBody, opts?)` + `signWebhookDelivery(secret, ts, rawBody)`.
- **Python:** `client.webhooks_register(body, idempotency_key=...)` + `client.webhooks_unregister(id)` + `verify_webhook_signature(secret, sig_header, ts_header, raw_body, freshness_window_seconds=...)` + `sign_webhook_delivery(secret, ts, raw_body)`.
- **Go:** `client.RegisterWebhook(ctx, body, opts)` + `client.UnregisterWebhook(ctx, id)` + `VerifyWebhookSignature(secret, sigHeader, tsHeader, rawBody, opts)` + `SignWebhookDelivery(secret, ts, rawBody)`.

All three verification helpers use constant-time HMAC comparison + a configurable freshness window (default 5 minutes per spec) + reject malformed headers and tampered bodies. Receivers MUST pass the raw body bytes — re-serialized parsed JSON fails verification because the host signs exact bytes.

---

## Audit-log integrity (`openwop-audit-log-integrity`)

Per [`auth-profiles.md`](../spec/v1/auth-profiles.md) §"openwop-audit-log-integrity".

### What the host advertises

```json
"auth": {
  "auditLogIntegrity": {
    "hashChain": true,
    "checkpointSignatureAlgorithm": "ed25519",
    "checkpointPublicKey": "<base64 SPKI>",
    "checkpointIntervalEntries": 1000,
    "checkpointIntervalSeconds": 300
  }
}
```

### What the operator wires

- Configure `OPENWOP_AUDIT_KEY_DIR` pointing at a writable directory. The host generates + persists an Ed25519 keypair there on first boot.
- **Protect the private key** — possession of it lets a malicious admin forge checkpoint signatures. Production deployments SHOULD use a KMS-backed signer (the Postgres reference uses a file-backed key for simplicity).
- Verifiers re-fetch `checkpointPublicKey` from discovery before each verification (handles key rotation).
- Run `/v1/audit/verify?fromSeq=N&toSeq=M` to verify any slice of the chain.

### Threat surface

Admin with storage-write access but NOT signing-key access cannot forge a valid chain segment. Admin with both is out of scope — protect the key.

---

## mTLS deployment

Per [`auth-profiles.md`](../spec/v1/auth-profiles.md) §"openwop-auth-mtls".

### Operator wiring

```bash
export OPENWOP_MTLS_CERT_PATH=/etc/openwop/mtls/server.crt
export OPENWOP_MTLS_KEY_PATH=/etc/openwop/mtls/server.key
export OPENWOP_MTLS_CA_PATH=/etc/openwop/mtls/ca.bundle   # optional
export OPENWOP_MTLS_REQUIRED=true                          # default true
```

The host listens on HTTPS with `requestCert: true` + `rejectUnauthorized: OPENWOP_MTLS_REQUIRED !== 'false'`. Clients without a valid cert are rejected at the TLS handshake (transport-layer fail) when `MTLS_REQUIRED=true`.

### Subject mapping

The reference convention is `subjectMapping: 'cn'` — client cert Common Name is the transport principal. Production deployers SHOULD extend to SAN-based mapping by parsing `req.socket.getPeerCertificate()`. Don't claim the profile if your TLS terminator doesn't actually do client-cert verification (the strict-mode conformance scenario will fail you).

---

## MCP integration trust boundary

Per [`spec/v1/mcp-integration.md`](../spec/v1/mcp-integration.md) §"UNTRUSTED marker discipline".

### What it means

MCP tool servers are external — their responses are adversarial input. The OpenWOP host MUST tag MCP tool output with `contentTrust: 'untrusted'` so downstream LLM nodes treat it as user data, not as system-trusted instructions.

### Operator wiring

- Configure each MCP server via `OPENWOP_MCP_SERVER_<ID>=https://...`.
- The MCP-1 redaction invariant means tool arguments + content texts NEVER appear on event payloads — only the SHA-256. Verified by `mcp-toolcall-redaction.test.ts`.
- Downstream LLM nodes that consume MCP content SHOULD apply prompt-injection countermeasures per `threat-model-prompt-injection.md`.

---

## Node-pack supply chain

Per [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) + RFC 0008.

### What the host does

- At install time: validates the lockfile against `pack-lockfile.schema.json`, verifies SRI integrity against tarball bytes, detects version drift between lockfile pin and registry-served manifest, verifies the Ed25519 signature against the publisher's public key.
- Every failure mode is a typed `PackConsumerError` with a canonical code (`pack_integrity_mismatch`, `pack_signature_invalid`, etc.). Host fails closed in every case.
- At runtime (when a host executes WASM packs): enforces `memory.grow` cap + fuel + execution-time per RFC 0008 §G + §K. Reference loader in `examples/hosts/in-memory/src/wasm-loader.ts`.

### Operator wiring

- Pin your packs via a workspace lockfile (`examples/core-packs-lockfile/openwop-pack-lockfile.json` is the reference shape).
- For `vendor.openwop.rust-hello` and other WASM packs: configure `--max-memory=67108864` (or your host's equivalent) so the loader has a hard cap.
- For audited packs only: `core.openwop.{ai,http,mcp,triggers}` are built + signed in-tree but pending the external audit at `SECURITY/external-audit-engagement.md`. Don't deploy unaudited high-stakes packs to production.

---

## Daily-check list

Run these checks against your deployed host on a daily / per-deploy cadence:

| Check                                   | Surface                                                 | Failure mode                            |
| --------------------------------------- | ------------------------------------------------------- | --------------------------------------- |
| Discovery returns the expected profiles | `GET /.well-known/openwop`                              | Strict-mode conformance fails.          |
| BYOK roundtrip preserves redaction      | Host smoke (e.g., `byok-roundtrip.test.ts`)             | SR-1 violation.                         |
| Audit-log verify roundtrip              | `GET /v1/audit/verify`                                  | Chain tamper or signing-key compromise. |
| Webhook HMAC verification on receiver   | Receiver-side test                                      | Forged delivery accepted.               |
| Pack-consumer fail-closed               | Host smoke (PACK-1)                                     | Tampered tarball accepted.              |
| Strict-mode conformance                 | `OPENWOP_REQUIRE_BEHAVIOR=true npx openwop-conformance` | Honesty drift.                          |

---

## What this guide is NOT

- **Not a runtime security audit.** The external audit at `SECURITY/external-audit-engagement.md` is the formal review surface. This page is operator-side configuration, not threat-model coverage.
- **Not a substitute for `SECURITY.md`.** That doc carries the disclosure policy + embargo SLA + maintainer security contact. Read it.
- **Not a deployment runbook.** For the operational shape (production-profile claim), see [`docs/PRODUCTION-RUNBOOK.md`](./PRODUCTION-RUNBOOK.md).

---

## See also

- [`SECURITY.md`](../SECURITY.md) — disclosure policy + threat-model index.
- [`SECURITY/invariants.yaml`](../SECURITY/invariants.yaml) — protocol-tier MUST-NOTs with test references.
- [`docs/PRODUCTION-RUNBOOK.md`](./PRODUCTION-RUNBOOK.md) — operator playbook for the production claim.
- [`docs/PROFILE-DECISION-GUIDE.md`](./PROFILE-DECISION-GUIDE.md) — which profiles to claim.
- [`docs/IMPLEMENTATION-CERTIFICATION.md`](./IMPLEMENTATION-CERTIFICATION.md) — how to publish your evidence.
- [`docs/KNOWN-LIMITS.md`](./KNOWN-LIMITS.md) — what's not yet covered.
- [`spec/v1/auth.md`](../spec/v1/auth.md) + [`auth-profiles.md`](../spec/v1/auth-profiles.md) — normative auth surface.
- [`spec/v1/webhooks.md`](../spec/v1/webhooks.md) — HMAC signing recipe.
- [`spec/v1/mcp-integration.md`](../spec/v1/mcp-integration.md) — MCP trust-boundary discipline.
- [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) — pack signing + dependency resolution.
