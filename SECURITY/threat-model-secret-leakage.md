# Threat Model: Secret Leakage

> **Scope:** Credential resolution paths advertised under `capabilities.secrets` (BYOK). Covers the wire boundary, host-internal redaction harness, and observable surfaces (event log, OTel spans, error envelopes, exports, debug bundles).
> **Last updated:** 2026-05-01
> **Companion artifacts:** `spec/v1/run-options.md` §"Credential references" · `spec/v1/capabilities.md` §"Secrets" · `SECURITY/invariants.yaml` (entries `secret-leakage-*`).

## 1. Why this model

Per `the public security review plan` (B- / 82, governance C+, Security B), the BYOK secret path is the highest-impact surface that can leak material via a successful response or a thrown error. The protocol's stated guarantee is that secret material never appears in any observable surface. Under hostile or adversarial input, what code paths could break that guarantee?

This model enumerates the surfaces, the attacker capabilities, and the invariants that MUST hold. Each invariant has an ID; `SECURITY/invariants.yaml` maps each ID to one or more tests that pin the contract. The CI gate at `scripts/check-security-invariants.sh` verifies the mapping.

## 2. Trust boundaries

```text
[Client] ── HTTPS ──> [Host /v1/runs]
                          │
                          │  ServerSecretResolverAdapter
                          ▼
                       [Host secret store: KMS-encrypted]
                          │
                          │  decrypt + inject as Authorization
                          ▼
                       [LLM provider / external API]
                          │
                          │  response (may echo header in error body)
                          ▼
                       [Host: parse, redact, persist]
                          │
                          ▼
                       [Event log / OTel spans / error envelope / debug bundle / exports]
                          │
                          │  served back to client
                          ▼
                       [Client / observability sink]
```

Trust transitions:

- **T1: Client → Host.** The client supplies an opaque `credentialRef` ID; never raw key material. A request that contains raw key material in any field is an abuse case (see §3 A2).
- **T2: Host → Provider.** The host injects the resolved secret into the upstream `Authorization` header (or provider-specific equivalent). The secret SHOULD NOT enter any other field.
- **T3: Provider → Host.** Some providers echo the request header in their error responses. The host MUST sanitize before persisting.
- **T4: Host → Observable surface.** Any host-emitted event, span, log, error, export, or bundle MUST pass through redaction.
- **T5: Host → Client.** Run snapshots, event-log queries, and debug bundles all serve through the host's redaction-on-read path.

## 3. Adversaries

| ID  | Adversary                                              | Capability                                                                                           |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| A1  | External attacker with valid client API key            | Issue `POST /v1/runs` with hostile inputs; read responses to runs they own                           |
| A2  | Malicious workflow author                              | Author a workflow whose inputs/variables echo `credentialRef` material into observable artifact data |
| A3  | Hostile LLM / provider response                        | Provider echoes the `Authorization` header value into its error payload                              |
| A4  | Compromised log collector                              | Read every line the host emits to stdout/stderr; cannot read in-memory state                         |
| A5  | Operator with read-only access to event log Firestore  | Read every persisted event; cannot read secret store                                                 |
| A6  | Hostile client retrying with crafted `Idempotency-Key` | Drive retry storm; observe replay vs. fresh distinction (RFC 0002)                                   |

## 4. STRIDE per surface

### 4.1 Event log payloads

Persisted in Firestore at `runs/{runId}/events/{eventId}`. Read by clients, replayed for forks, exported in debug bundles.

| Threat                 | Vector                                                                                         | Mitigation                                                                 | Invariant                          |
| ---------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| Information disclosure | LLM error response containing the `Authorization` header is persisted as `node.failed` payload | All payloads pass through `sanitizeErrorMessageForLog` before persist      | `secret-leakage-eventlog-payload`  |
| Information disclosure | Workflow variable marked sensitive but routed through generic `setVariable` action             | Sensitive markers enforced at the variable layer, not the action layer     | `secret-leakage-eventlog-variable` |
| Tampering              | Operator with write access modifies persisted event to remove redaction marker                 | Out of scope (operator with write access is trusted; covered by host RBAC) | —                                  |

### 4.2 OTel spans

`recordException` and `setStatus` accept arbitrary `Error` objects. V8 stack format echoes `.message` in line 1.

| Threat                 | Vector                                                                                  | Mitigation                                                                                                      | Invariant                       |
| ---------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Information disclosure | `span.recordException(rawError)` where `rawError.message` contains echoed Authorization | `recordSanitizedException` helper sanitizes both `.message` AND `.stack`                                        | `secret-leakage-otel-exception` |
| Information disclosure | `span.setAttribute('http.request.header.authorization', headerValue)`                   | OTel attribute allowlist excludes `authorization` (engine layer); host layer forbids non-allowlisted attributes | `secret-leakage-otel-attribute` |

### 4.3 Error envelope

`auth.md` defines the canonical `{error, message}` shape. The `message` field is human-readable.

| Threat                 | Vector                                                                                             | Mitigation                                                                       | Invariant                        |
| ---------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------- |
| Information disclosure | Provider returns 401 with the offending Authorization in body; host bubbles up `body` as `message` | All error envelopes constructed via `sanitizeErrorMessageForLog`-routed builders | `secret-leakage-error-envelope`  |
| Information disclosure | Auth middleware echoes Bearer header in 401 reason on bad token                                    | Auth middleware sanitization (reference impl `auth.ts` log call sites)           | `secret-leakage-auth-middleware` |

### 4.4 Debug bundle

`GET /v1/runs/{runId}/debug-bundle` returns events, variables, node receipts, span tree, decision audit trail.

| Threat                 | Vector                                                              | Mitigation                                                                       | Invariant                          |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------- |
| Information disclosure | Bundle includes raw variable values without applying sensitive-mask | Bundle generator routes through the same redaction pipeline as event-log queries | `secret-leakage-debug-bundle`      |
| Information disclosure | Bundle includes raw OTel span attributes                            | Span attributes pass through allowlist before bundle export                      | `secret-leakage-debug-bundle-otel` |

### 4.5 Exports / artifact downloads

PRDs, themes, generated files served via `GET /v1/artifacts/{...}`.

| Threat                 | Vector                                                                | Mitigation                                                                                                                                                                | Invariant                                                       |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Information disclosure | Generated artifact (PRD content) contains an LLM-echoed Authorization | LLM input gating: `credentialRef` material is NEVER passed into prompt context                                                                                            | `secret-leakage-artifact-content`                               |
| Information disclosure | Workflow author writes a node that explicitly emits the secret        | Workflow validation rejects nodes whose declared `inputs` include a credential-shaped string at compile time (best-effort: heuristic via `ed25519`/`sk-` shape detection) | `secret-leakage-author-emit` (advisory only — defense-in-depth) |

### 4.6 Provider response stream (T3)

Some providers echo the request header in their streamed error responses (observed: HTTP/1 servers under specific conditions).

| Threat                 | Vector                                                     | Mitigation                                             | Invariant                     |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| Information disclosure | SSE chunk `data:` field contains echoed Authorization      | Stream sanitizer applied to every chunk before forward | `secret-leakage-stream-chunk` |
| Information disclosure | Streamed error event payload contains echoed Authorization | Error chunks pass through same sanitizer               | `secret-leakage-stream-error` |

## 5. Invariants (MUST NOT)

Each entry below is filed in `SECURITY/invariants.yaml` with its ID, severity, and required-test glob.

| ID                                 | Statement                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secret-leakage-eventlog-payload`  | Persisted event payloads MUST NOT contain raw key material from any source (provider header echo, workflow variable, error message).                                                                                                                                                                           |
| `secret-leakage-eventlog-variable` | Workflow variables marked `sensitive: true` MUST be masked in event payloads using the host's advertised `compliance.defaultMode`.                                                                                                                                                                             |
| `secret-leakage-otel-exception`    | `Error.message` and `Error.stack` MUST be sanitized before passing to `span.recordException()` or `span.setStatus()`.                                                                                                                                                                                          |
| `secret-leakage-otel-attribute`    | OTel span attributes MUST NOT include the `authorization` header value or any field whose key matches a credential-name pattern.                                                                                                                                                                               |
| `secret-leakage-error-envelope`    | The canonical error envelope's `message` field MUST NOT contain raw key material.                                                                                                                                                                                                                              |
| `secret-leakage-auth-middleware`   | Auth-middleware log lines MUST NOT echo raw `Authorization` header content on bad-token rejection.                                                                                                                                                                                                             |
| `secret-leakage-debug-bundle`      | Run debug bundles MUST apply the same redaction as event-log queries.                                                                                                                                                                                                                                          |
| `secret-leakage-debug-bundle-otel` | Run debug bundles MUST NOT export OTel span attributes outside the allowlist.                                                                                                                                                                                                                                  |
| `secret-leakage-artifact-content`  | LLM prompt context MUST NOT include raw `credentialRef` material; artifact bodies inherit this guarantee.                                                                                                                                                                                                      |
| `secret-leakage-stream-chunk`      | SSE chunks forwarded from a provider MUST pass through the redaction sanitizer.                                                                                                                                                                                                                                |
| `secret-leakage-stream-error`      | SSE error chunks MUST pass through the redaction sanitizer.                                                                                                                                                                                                                                                    |
| `secret-leakage-author-emit`       | (ADVISORY) Workflow validation SHOULD reject nodes whose declared inputs match credential shape patterns. Defense-in-depth; not a hard MUST.                                                                                                                                                                   |
| `egress-decision-no-secret-leak`   | (RFC 0079) The `CredentialProvenance` descriptor + the `egress.decided` event MUST NOT carry the credential secret value — identifiers, destination, decision, audiences, and an optional reason code only.                                                                                                    |
| `egress-credential-audience-bound` | (RFC 0079, reference-impl until Accepted) A host-issued credential MUST NOT be attached to an egress whose destination is not in the credential's provenance `audiences`; provenance-unevaluable / expired ⇒ fail-closed `denied`. The confused-deputy / credential-exfiltration guard at the egress boundary. |
| `budget-no-pricing-leak`           | (RFC 0084) The `budget.*` events + `cap.breached{budget-*}` MUST NOT carry pricing breakdowns, rate cards, per-token prices, provider credentials, or model prose — dimension name + integers/numbers + scope only.                                                                                            |
| `connection-pack-no-credential-material` | (RFC 0095) A connection-pack manifest (`kind: "connection"`) MUST NOT contain credential material in any field; a host MUST reject one carrying a blocklisted secret-indicating property name (`connection-packs.md` §Manifest clause 2 — sole exemption: the `provider.auth.endpoints.token` endpoint URL) with `connection_pack_credential_material`, scanning BEFORE generic schema validation. The pack is public provider metadata only; the OAuth client credential stays host-side (RFC 0047). |
| `trigger-ingestion-ssrf`           | (RFC 0099) ANY host-side fetch the external-event ingestion path performs (webhook verification callback, email-attachment resolution, form file-upload retrieval) MUST go through the RFC 0076 §B SSRF guard (`assertPublicUrl` / `httpClient.safeFetch`) — no private/link-local/loopback target, with the `maxResponseBodyBytes` cap. The host MUST NOT hand the run an external URL to fetch itself; `TriggerEvent.AttachmentRef.ref` is a host-internal opaque handle (`trigger-bridge.md` §F.4). |
| `trigger-ingestion-content-redaction` | (RFC 0099) The inbound external-event body, headers, email content, and form fields MUST NOT appear on any `run.*` / `trigger.*` durable event payload (RFC 0083 §C content-freeness, generalized). The content lives ONLY in `ctx.triggerData` (the in-run `TriggerEvent`, never event-logged). `webhook.headers` MUST be a host-curated allowlist (no `Authorization`/`Cookie`/`Proxy-Authorization`); `dedupKey` MUST be host-opaque and MUST NOT embed inbound body/header content in cleartext (`trigger-bridge.md` §F.4). |
| `a2a-push-egress-ssrf`             | (RFC 0100) A caller-registered A2A push-notification `pushConfig.url` MUST be validated through the RFC 0093 webhook-egress SSRF guard before any push (no private/loopback/link-local target). A push MUST NOT carry run-internal content beyond the projected `A2ATaskState` + A2A artifact references; `pushConfig.tokenFingerprint` MUST be a truncated/salted digest, never the raw push-auth token (SR-1). The durable async A2A trust boundary (`a2a-integration.md` §"Async / durable Tasks"). |
| `runner-credential-non-transit`    | (RFC 0122) A self-hosted runner's local credential (subscription CLI login per RFC 0121; private endpoint key per RFC 0108) MUST NOT transit the host — it MUST NOT appear in any `SelfHostedRunnerDispatchFrame`/`SelfHostedRunnerResultFrame`, `run.*` event payload, run result, debug bundle, export, replay state, or log. The host sends `inputs`, receives `output`, and never sees the credential; the frame schemas are `additionalProperties:false` so a runner cannot smuggle a credential field onto a result. The runner-channel analog of SR-1 (`self-hosted-runner.md` §Behavior clause 2). |
| `anon-actor-no-secret-reach`       | (RFC 0132, reference-impl until Accepted) **Public-surface credential reach.** An anonymous-actor tool call (either tier) MUST NOT resolve/return/reach any secret or BYOK credential material and MUST NOT reach cross-tenant data (SR-1 + CTI-1 parity). A read-tier tool is tenant-scoped to the surface's tenant; a cross-tenant read fails closed (`run_forbidden` / empty). An identity-less caller never reaches the operator's secrets. |
| `anon-actor-egress-ssrf-guarded`   | (RFC 0132, reference-impl until Accepted) An anon-initiated egress MUST ride the RFC 0076 §B SSRF-guarded, RFC 0079 audience-bound egress path; a tenant/host credential MUST NOT attach out-of-audience — `denied`/`downgraded`, never allowed-with-credential. An anon actor MUST NOT become a confused deputy for a tenant credential (composes `egress-credential-audience-bound`). |
| `anon-actor-audit-opaque`          | (RFC 0132, reference-impl until Accepted) The anon-session `principal` MUST be opaque, ephemeral, non-cross-linkable, and non-PII (no IP / email / device fingerprint); the reused `authorization.decided` audit record MUST carry no PII or credential material (RFC 0048 identifier-opacity + SR-1). |

### 4.7 Credential confused-deputy egress (RFC 0079)

A new surface: when a tool or pack runtime attaches a host-issued credential (RFC 0046 reference / RFC 0047 OAuth token) to an outbound request via `ctx.http.safeFetch`, the §host.http SSRF guard checks the _URL_ but not the _credential↔destination binding_. A prompt-injected or misconfigured tool can target an attacker-controlled destination with a credential minted for a legitimate service (a **confused deputy** — STRIDE: Information Disclosure + Elevation of Privilege). Mitigation: the `egress-credential-audience-bound` MUST (`host-capabilities.md` §"Credential provenance + egress policy" §C) — the host evaluates `CredentialProvenance.audiences` before attaching the credential and **fails closed**, emitting a content-free `egress.decided` decision. The decision/descriptor themselves are secret-free (`egress-decision-no-secret-leak`).

## 6. Residual risks

- **Host-internal memory.** A reference impl that holds decrypted secrets in process memory remains vulnerable to OS-level attacks (core dumps, swap, debug attach). Out of scope for protocol-level threat model; handled by host operator policy.
- **Provider compromise.** A compromised LLM/payment provider could log or exfiltrate the upstream secret regardless of host redaction. Mitigation is BYOK + tight per-provider scoping; covered by §3 A3 and partially by `secret-leakage-stream-chunk`.
- **Workflow-author-emitted leaks.** A malicious workflow author can construct a workflow whose declared output deliberately echoes the credential. The advisory invariant (`secret-leakage-author-emit`) reduces but doesn't eliminate this; ultimate defense is access control on workflow authoring.

## 7. Verification

Every MUST-NOT invariant in §5 has a test mapping in `SECURITY/invariants.yaml`. The CI gate `scripts/check-security-invariants.sh` reads the YAML and verifies every protocol-tier invariant has at least one matching test file. Reference-impl-tier invariants are advisory at the public-repo CI gate; the reference impl's own CI verifies them.

## 8. References

- `SECURITY.md` — disclosure policy.
- `SECURITY/invariants.yaml` — invariant → test mapping.
- `spec/v1/run-options.md` §"Credential references" — credentialRef semantics.
- `spec/v1/capabilities.md` §"Secrets" — discovery field shape + NFR-7 redaction requirement.
- `spec/v1/observability.md` §"Privacy classification" — masking modes.
- Host implementations MUST route persisted events, error envelopes, streams, debug bundles, and telemetry exporters through their own redaction pipeline before data leaves the trust boundary.
- `conformance/src/scenarios/redaction.test.ts` — vendor-neutral redaction scenarios.
