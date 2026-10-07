# OpenWOP Security Operator Guide

> Informative. A checklist of the security surfaces an operator turns on when running an OpenWOP v2 host. It adds no obligation. The rules are in [`spec/v2/core/security-defaults.md`](../spec/v2/core/security-defaults.md) and the core documents it points at; the invariant catalog, with test references, is [`SECURITY/invariants.yaml`](../SECURITY/invariants.yaml).

This page says which knobs to turn, not why they exist. For the why, read [`SECURITY.md`](../SECURITY.md) and the threat models under [`SECURITY/`](../SECURITY/). Configuration names (environment variables, file paths) are host-specific; check your host's own documentation for them.

One principle runs through all of it: **advertising a surface binds its security behavior** (`security-defaults.md` §"The rule"). There is no discovery flag that turns the behavior off. If you cannot meet an obligation, do not advertise the surface.

---

## Authentication lanes

v2 has one binding pipeline for every lane: verify, bind, check audience, resolve, fail closed ([`identity.md`](../spec/v2/core/identity.md) §2). You advertise the lanes you actually run in `auth.lanes[]`, and each one carries its own trust root and revocation rule (§2.2).

| Lane | Enable when | What you must operate |
| --- | --- | --- |
| `api-key` | Always useful for machine clients. | A strong key (at least 256 bits) in a secrets manager. A revoked key is refused on the next request (`credential_revoked`). |
| `oauth2` | Machine clients get tokens from an identity provider. | The issuer and audience. Honor `exp` and re-check the issuer within the advertised revocation window, or run `exp-only` under an enforced token lifetime. |
| `oidc` | End users sign in through an identity provider. | As `oauth2`, keyed on `iss`. |
| `mtls` | Your transport terminates mutual TLS. | Client-certificate verification at the TLS terminator, plus CRL, OCSP or short-lived certificates. Do not advertise the lane if your terminator does not verify client certificates. |
| `saml`, `scim` | Enterprise single sign-on and provisioning. | If you advertise both, the leaver contract is mandatory (`identity.md` §3). |

An `oauth2` or `oidc` lane also obliges protected-resource metadata and auth challenges that do not act as an oracle (`identity.md` §2.5).

### Checks worth running

- A failed authentication (`401`) never echoes the rejected credential in `message` or `details`.
- JWT validation rejects `alg: "none"`.
- Key and token comparisons are constant-time.
- No credential the host received inbound is ever attached to an outbound request: A2A, MCP, webhook, callback, `httpClient` or connector (`security-defaults.md` §"Onward hops", invariant `inbound-credential-no-passthrough`).

---

## Secrets and BYOK

The rules are in [`host-services.md`](../spec/v2/core/host-services.md) §`secrets` and §`aiProviders`.

- Secrets resolve to opaque references. Raw key material never appears in any event, log, trace, prompt, error, export or screenshot. Test this before exposing BYOK.
- Wherever a resolved value could surface, the host writes `[REDACTED:<secretId>]` instead.
- If you run memory with compaction, derived content passes the same redaction as a fresh write (`host-services.md` §`memory`; invariant `memory-compaction-sr-1-carry-forward`).
- Back your secret resolver with a real secrets manager (KMS, Vault or similar).

### Provider policy

`aiProviders.policies` sets, per provider, how a caller's credential is treated (`host-services.md` §`aiProviders`):

| Mode | Effect |
| --- | --- |
| `disabled` | Every call to the provider is refused (`provider_disabled`). |
| `optional` | A caller may supply a `credentialRef`. |
| `required` | A call without a usable `credentialRef` is refused (`byok_required`, `byok_required_but_unresolved`). |
| `restricted` | A model outside the `allowedModels` globs is refused (`model_not_allowed`). An empty `restricted` policy fails closed. |

A refusal never echoes the policy. Document the precedence of your policy `scopes`.

---

## Webhook signing

The rules are in [`webhooks.md`](../spec/v2/core/webhooks.md) §"Delivery" and §"Durability".

Every delivery carries five headers: `OpenWOP-Webhook-Id`, `OpenWOP-Event-Type`, `OpenWOP-Timestamp`, `OpenWOP-Signature` and `OpenWOP-Signature-Algorithm`.

```text
signed bytes:  {timestamp}.{rawBody}
OpenWOP-Signature: sha256=<hex HMAC-SHA256(signed bytes, subscription secret)>
OpenWOP-Signature-Algorithm: v1
```

What the operator wires:

- Each subscription gets its own secret from `POST /webhooks`. The host never logs it.
- If you advertise `webhooks.secretRotation`, rotation overlaps old and new secrets for `overlapSeconds`.
- Subscriptions may opt in to Standard Webhooks signing (`standard-webhooks-1`) as well; see `webhooks.md` §"Standard Webhooks".
- Delivery is durable: retries with backoff, dead-letter on exhaustion, at least once. Best-effort delivery does not conform.

Tell your receivers to: reject a timestamp more than five minutes off, recompute the HMAC over the **raw** body bytes (re-serialized JSON will not verify), compare in constant time, reject an unknown algorithm value, and dedupe on `(OpenWOP-Webhook-Id, runId, sequence)`. The SDKs in [openwop/openwop-sdks](https://github.com/openwop/openwop-sdks) include verification helpers.

---

## Audit-log integrity

Advertise the `auditLogIntegrity` family only if you keep the log the way [`security-defaults.md`](../spec/v2/core/security-defaults.md) §"Audit-log integrity" describes: append-only, each entry hash-chained to the previous one, with signed Ed25519 checkpoints at the advertised `checkpointIntervalEntries` and `checkpointIntervalSeconds`, and `GET /audit/verify` served under scope `audit:read`.

What the operator does:

- Keep the checkpoint private key in a KMS-backed signer, not on local disk. Whoever holds both storage-write access and the signing key can forge the chain; protect the key.
- Use the checkpoint key for nothing else.
- Verifiers read `checkpointPublicKey` from discovery before each verification, which handles rotation.

---

## MCP trust boundary

MCP tool servers are external, and their output is untrusted input. The rules are in [`interop.md`](../spec/v2/core/interop.md), [`spec/v2/interop-map.json`](../spec/v2/interop-map.json) (the `mcp` rows) and [`tool-catalog.md`](../spec/v2/core/tool-catalog.md).

- Classify every MCP-sourced tool yourself. Never copy `safetyTier` or other effect fields from a server's `annotations`; an unclassified `source: "mcp"` tool is `safetyTier: "write"`.
- Tool arguments and content stay off event payloads (invariant `mcp-toolcall-payload-redaction`).
- On your own MCP server mount, every `tools/*`, `prompts/*` and `resources/*` request is authenticated and authorized before anything runs, and a run started over MCP starts untrusted.
- Nodes that consume MCP content should apply prompt-injection countermeasures (`SECURITY/threat-model-prompt-injection.md`).

---

## Pack supply chain and sandboxing

The rules are in [`packs.md`](../spec/v2/core/packs.md) §"Signing" and [`security-defaults.md`](../spec/v2/core/security-defaults.md) §"Sandbox isolation".

- Verify each pack's Ed25519 signature (`ed25519-canonical-json`) against the issuing registry's key for `keyId`, and check the pack name against that key's `permittedNamespaces`. Fail closed on any mismatch.
- Pin installed packs with a lockfile (`pack-lockfile`).
- A host that runs third-party packs enforces the eight `node-pack-sandbox-*` invariants and advertises `sandbox.isolationModel` as `wasm`, `process`, `container` or `vm`. Set hard memory and wall-clock limits.

The pack registry and its signing keys are operated from [openwop/openwop-registry](https://github.com/openwop/openwop-registry).

---

## Routine checks

Run these on every deploy, and on a schedule:

| Check | Surface | What a failure means |
| --- | --- | --- |
| Discovery advertises only what you run | `GET /.well-known/openwop` | Over-claim; conformance fails it. |
| A canary secret never reaches events, logs or errors | host smoke test | Secret leakage. |
| Audit chain verifies | `GET /audit/verify` | Tampering or key compromise. |
| Receivers verify webhook signatures | receiver-side test | Forged delivery accepted. |
| A tampered pack is refused | host smoke test | Supply-chain bypass. |
| Behavioral conformance | `npx @openwop/openwop-conformance --target-major 2 --require-behavior` ([`conformance/README.md`](../conformance/README.md)) | Advertisement and behavior have drifted apart. |

---

## What this guide is not

- **Not an audit.** The external audit engagement is tracked in [`SECURITY/external-audit-engagement.md`](../SECURITY/external-audit-engagement.md).
- **Not the disclosure policy.** That is [`SECURITY.md`](../SECURITY.md).
- **Not a deployment runbook.** For running a host in production, see [`PRODUCTION-RUNBOOK.md`](./PRODUCTION-RUNBOOK.md).

## See also

- [`spec/v2/core/security-defaults.md`](../spec/v2/core/security-defaults.md): the obligation table.
- [`spec/v2/core/identity.md`](../spec/v2/core/identity.md): authentication lanes.
- [`spec/v2/core/webhooks.md`](../spec/v2/core/webhooks.md): signing and delivery.
- [`spec/v2/core/packs.md`](../spec/v2/core/packs.md): pack signing.
- [`docs/KNOWN-LIMITS.md`](./KNOWN-LIMITS.md): what is not yet covered.
