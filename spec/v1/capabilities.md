# OpenWOP Spec v1 — Capability Declaration (`/.well-known/openwop`)

> **Status: Stable · v1.1 (2026-04-27; hygiene pass 2026-05-10).** Formalized as `schemas/capabilities.schema.json`. The public network handshake at `GET /.well-known/openwop` is the canonical v1 capability declaration. Fields marked **required v1** are required for conformance; fields marked **optional v1** have stable wire shapes but MAY be omitted by hosts that do not support the capability. Conformance suite scenarios verify the required surface end-to-end and gate optional profile scenarios from this document. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

External clients (CLIs, SDKs, agents from other ecosystems) need a deterministic way to discover what an OpenWOP-compliant server can do _before_ they issue requests. Specifically:

- Which protocol version they're talking to (and whether their client is too old)
- Which envelope types and node types are registered
- What hard limits apply (recursion, run duration, request body size)
- Which transports are exposed (REST, MCP, A2A, gRPC)
- Which OTel attribute taxonomy traces will use
- Which `configurable` keys are accepted on per-run overrides

This document specifies the public surface. Implementations MAY also maintain richer internal capability objects for prompt construction, node dispatch, or product UX; those internal objects are not normative unless projected through `/.well-known/openwop`.

---

## Endpoint

An OpenWOP-compliant server MUST expose:

| Method | Path                   | Auth          | Cache                                            |
| ------ | ---------------------- | ------------- | ------------------------------------------------ |
| `GET`  | `/.well-known/openwop` | None (public) | `Cache-Control: public, max-age=300` recommended |

The path follows [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) `.well-known` URI conventions. The response MUST be JSON with `Content-Type: application/json`.

A server MAY expose this at additional paths for backward compatibility but MUST treat `/.well-known/openwop` as canonical.

---

## Two surfaces

OpenWOP distinguishes two capability surfaces:

- **In-package `Capabilities`** — what the engine tells the LLM in the system prompt. 5 fields. **(stable)** — see "In-package shape" below.
- **Network-handshake `Capabilities`** — what `GET /.well-known/openwop` returns to external clients. Superset of the in-package shape plus discovery, transport, observability, profile, testing, and optional feature advertisement. This is the public v1 handshake.

The in-package shape remains useful for engines and LLM prompts. The network-handshake shape is what clients and conformance suites consume.

---

## In-package shape (internal, non-normative)

What the engine actually has today, used to format the system prompt:

```typescript
interface Capabilities {
  protocolVersion: string;                          // engine ↔ LLM contract version
  supportedEnvelopes: readonly string[];            // ['prd.create', 'theme.create', ...]
  schemaVersions: Readonly<Record<string, number>>; // { 'prd.create': 2, 'theme.create': 1 }
  limits: CapabilityLimits;                         // hard caps on LLM behavior
  extensions?: Readonly<Record<string, unknown>>;   // per-canvas-type additions
}

interface CapabilityLimits {
  clarificationRounds: number;   // default 3
  schemaRounds: number;           // default 2
  envelopesPerTurn: number;       // default 5
}
```

**Default limits** (`DEFAULT_CAPABILITY_LIMITS` in the reference app — `openwop/openwop-app` repo, backend `Capabilities.ts`; historical, non-normative):

```typescript
{ clarificationRounds: 3, schemaRounds: 2, envelopesPerTurn: 5 }
```

**Helper functions** (reference-app patterns, same `Capabilities.ts`):

- `buildCapabilities(opts)` — construct from envelope catalog + limits. Validates `schemaVersions` are non-negative integers.
- `formatCapabilitiesForPrompt(caps)` — render as system-prompt text block. Sorts envelope types + extension keys deterministically for prompt-cache stability.
- `mergeCapabilities(base, extension)` — per-canvas-type merge. Union of envelopes, extension wins on schema-version + limit conflicts.

**Enforcement**: Implementations typically track counters per (run, task, turn) and emit a capability-limit error on breach. The public wire consequence is the `cap.breached` event described below.

---

## Network-handshake shape

The full `GET /.well-known/openwop` response. Only `protocolVersion`, `supportedEnvelopes`, `schemaVersions`, and the three base `limits` are required by `schemas/capabilities.schema.json`. Additional fields below are **optional v1**: their shapes are stable when present, and clients MUST tolerate absence.

#### Document-root layout (normative — RFC 0073)

Every capability family — the required `protocolVersion` / `supportedEnvelopes` / `schemaVersions` / `limits`, and every optional family (`agents`, `secrets`, `aiProviders`, `auth`, `memory`, `multiAgent`, `authorization`, and all others defined in `schemas/capabilities.schema.json`) — MUST appear as a property of the **document root** of the `GET /.well-known/openwop` response. `capabilities.schema.json` validates this full response: its properties are the root properties, and it declares **no `capabilities` wrapper property**. A host MUST NOT require a `capabilities` wrapper object to convey them.

A top-level `capabilities` wrapper object is a **deprecated legacy shape**, tolerated only by the schema's `additionalProperties: true`. Through the v1.x migration window a host MAY additionally mirror the families under a `capabilities` object for backward compatibility; **clients** SHOULD read the document root first and MAY fall back to a `capabilities.*` wrapper. The **conformance suite reads the root only** — root is the MUST above, so a host that serves families exclusively under the wrapper is non-conformant and is graded as such (RFC 0073 Phase 4). Hosts MUST serve families at the root and SHOULD NOT emit the wrapper. The host-side mirror affordance and the schema's `additionalProperties` tolerance are scheduled to retire together at the next major version (v2.0), at which point `capabilities.schema.json` tightens to forbid the wrapper — see RFC 0073.

```json
{
  "protocolVersion": "1.0",
  "implementation": { "name": "...", "version": "...", "vendor": "..." },

  "engineVersion": 1,
  "eventLogSchemaVersion": 2,

  "supportedTransports": ["rest", "mcp", "a2a"],
  "supportedEnvelopes": ["prd.create", "theme.create", "..."],
  "schemaVersions": { "prd.create": 2, "theme.create": 1 },

  "limits": {
    "clarificationRounds": 3,
    "schemaRounds": 2,
    "envelopesPerTurn": 5,
    "maxNodeExecutions": 1000,
    "maxRunDurationMs": 86400000
  },

  "configurable": {
    "model": { "type": "string" },
    "temperature": { "type": "number", "min": 0, "max": 2 },
    "recursionLimit": { "type": "number", "max": 1000 }
  },

  "observability": {
    "namespace": "openwop",
    "spanAttributes": ["openwop.run_id", "openwop.node_id", "openwop.node_type", "openwop.event_seq", "openwop.workflow_id", "openwop.protocol_version"]
  },

  "runtimeCapabilities": ["chat.sendPrompt", "canvas.write"],

  "secrets": {
    "supported": true,
    "scopes": ["tenant", "user", "run"],
    "resolution": "host-managed"
  },

  "aiProviders": {
    "supported": ["anthropic", "openai", "gemini"],
    "byok": ["anthropic", "openai"]
  },

  "minClientVersion": "1.0",
  "fixtures": ["conformance-noop"]
}
```

The example's `maxNodeExecutions: 1000` is a deliberately non-default value (the documented default is `100`) illustrating a host that raises the ceiling.

### Field reference

| Field                                  | Type                      | Status          | Notes                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocolVersion`                      | `string`                  | **required v1** | Protocol version the server speaks, e.g. `"1.0"`.                                                                                                                                                                                                                                     |
| `supportedEnvelopes`                   | `string[]`                | **required v1** | Envelope `type` strings the engine recognizes.                                                                                                                                                                                                                                        |
| `schemaVersions`                       | `Record<string, number>`  | **required v1** | Active schema version per envelope type. **Per-envelope-type integer**, not per-spec-type semver.                                                                                                                                                                                     |
| `limits.clarificationRounds`           | `number`                  | **required v1** | Default `3`.                                                                                                                                                                                                                                                                          |
| `limits.schemaRounds`                  | `number`                  | **required v1** | Default `2`.                                                                                                                                                                                                                                                                          |
| `limits.envelopesPerTurn`              | `number`                  | **required v1** | Default `5`.                                                                                                                                                                                                                                                                          |
| `extensions`                           | `Record<string, unknown>` | **optional v1** | Per-host or per-workflow extension data. Clients treat as opaque.                                                                                                                                                                                                                     |
| `implementation.{name,version,vendor}` | object                    | **optional v1** | Identifies the server.                                                                                                                                                                                                                                                                |
| `engineVersion`                        | `number`                  | **optional v1** | See `version-negotiation.md`.                                                                                                                                                                                                                                                         |
| `eventLogSchemaVersion`                | `number`                  | **optional v1** | See `version-negotiation.md`.                                                                                                                                                                                                                                                         |
| `supportedTransports`                  | `string[]`                | **optional v1** | Subset of `["rest", "mcp", "a2a", "grpc"]`. REST is required regardless of whether this field is present.                                                                                                                                                                             |
| `limits.maxNodeExecutions`             | `number`                  | **optional v1** | Default `100`. Hosts that advertise it MUST enforce it. Engine-side ceiling clamping `RunOptions.configurable.recursionLimit`. Exceedance emits `cap.breached` with `kind: "node-executions"` and transitions the run to `failed` per §"Engine-enforced limits + cap.breached" below. |
| `limits.maxRunDurationMs`              | `number`                  | **optional v1** | Maximum run duration (milliseconds) the host intends to allow. Upper bound for `RunOptions.configurable.runTimeoutMs` (RFC 0058).                                                                                                                                                     |
| `limits.maxRequestBodyBytes`           | `number`                  | **optional v1** | Maximum REST request body accepted by the host, in bytes. Added to `capabilities.schema.json` by RFC 0094 (`limits` is otherwise closed — `additionalProperties: false`).                                                                                                             |
| `configurable`                         | object                    | **optional v1** | Per-run parameter overlay schema.                                                                                                                                                                                                                                                     |
| `observability`                        | object                    | **optional v1** | OTel attribute taxonomy hints. See `observability.md`.                                                                                                                                                                                                                                |
| `minClientVersion`                     | `string`                  | **optional v1** | Client-side version floor for `426 Upgrade Required`-style UX.                                                                                                                                                                                                                        |
| `runtimeCapabilities`                  | `string[]`                | **optional v1** | Host-advertised opaque capability ids that NodeModules may require via `NodeModule.requires`. See §"Runtime capabilities" below.                                                                                                                                                      |
| `secrets.supported`                    | `boolean`                 | **optional v1** | Host advertises secret/credential resolution. Clients gate BYOK flows on this. See §"Secrets" below.                                                                                                                                                                                  |
| `secrets.scopes`                       | `string[]`                | **optional v1** | Subset of `["tenant", "user", "run"]`.                                                                                                                                                                                                                                                |
| `secrets.resolution`                   | `string`                  | **optional v1** | Currently `"host-managed"`. Reserved for future modes.                                                                                                                                                                                                                                |
| `aiProviders.supported`                | `string[]`                | **optional v1** | Providers the host's AI proxy can route to (`anthropic`, `openai`, `gemini`, etc.).                                                                                                                                                                                                   |
| `aiProviders.byok`                     | `string[]`                | **optional v1** | Subset of `aiProviders.supported` for which BYOK is permitted.                                                                                                                                                                                                                        |
| `aiProviders.selfHosted`               | `string[]`                | **optional v1** | RFC 0108. Subset of `aiProviders.supported` that are operator-/tenant-configured OpenAI-compatible endpoints (opaque id, never URL-shaped; endpoint location non-disclosed; no capability inference from the id).                                                                       |
| `aiProviders.policies`                 | object                    | **optional v1** | Host-side policy enforcement modes (`disabled` / `optional` / `required` / `restricted`).                                                                                                                                                                                             |
| `aiProviders.promptPrefixCache`        | object                    | **optional v1** | RFC 0116. Provider-scoped advert that the host honors the `generate` request's `cachePrefixId` as a context-cache routing hint — tenant-keyed (`prompt-prefix-cache-cross-tenant-isolation`), secret-free, replay-invariant.                                                            |
| `fixtures`                             | `string[]`                | **optional v1** | Fixture workflow IDs the host has seeded. Conformance-suite-only contract.                                                                                                                                                                                                            |
| `interrupt.approverRouting.supported`  | `boolean`                 | **optional v1** | RFC 0104. Host honors the OPTIONAL, ADVISORY `approverGroupRefs` / `approverRoleRefs` / `audience` fields on the `kind:"approval"` InterruptPayload — resolves the advertised ref kinds against its own identity/RBAC, enforces eligibility host-side, routes notifications. Absent ⇒ the fields are ignored and the host stays conformant.                                                                                                  |
| `interrupt.approverRouting.refKinds`   | `string[]`                | **optional v1** | RFC 0104. Subset of `["group","role"]` the host actually resolves. `group` ⇒ honors `approverGroupRefs`; `role` ⇒ honors `approverRoleRefs`. Advertise only what the resolver supports (capability honesty).                                                                            |
| `interrupt.approverRouting.audience`   | `boolean`                 | **optional v1** | RFC 0104. Host honors the `audience` notification-targeting override. Absent/`false` ⇒ host notifies the resolved eligible union (`approversList` ∪ `approverGroupRefs` ∪ `approverRoleRefs`) and ignores `audience`.                                                                  |

### `configurable`

Schema for per-run parameter overrides accepted by `POST /v1/runs` `configurable` field. See `run-options.md` for full semantics. The capability declaration enumerates the keys the server accepts:

```json
"configurable": {
  "model": { "type": "string", "description": "AI model override" },
  "temperature": { "type": "number", "min": 0, "max": 2 },
  "maxTokens": { "type": "number", "min": 1, "max": 8192 },
  "promptOverrides": { "type": "object" },
  "recursionLimit": { "type": "number", "min": 1, "max": 1000 }
}
```

A client MUST consult this capability before sending `configurable` values and MUST omit keys not listed. An unknown key on the wire MAY be rejected with `validation_error` or silently ignored — implementations differ; the spec recommends rejection so misconfiguration is loud.

### Runtime capabilities

Lets a host advertise opaque host facilities that NodeModules can require via `NodeModule.requires?: readonly string[]`. The protocol owns the _check_; provider value shapes are documented per-capability alongside their consumers, NOT here.

```json
"runtimeCapabilities": ["chat.sendPrompt", "canvas.write", "secrets.byok"]
```

**Field shape:** array of unique non-empty strings. Capability ids are dotted, domain-scoped (conventional namespaces: `chat.*`, `canvas.*`, `secrets.*`, `media.*`).

**Client semantics.** A client that submits a workflow whose nodes declare `requires: ['chat.sendPrompt']` SHOULD first verify the host advertises that capability. A host that lacks a capability MUST refuse to dispatch nodes that declare it in `requires`, terminating the run with `RunSnapshot.error.code = 'capability_not_provided'` and the missing capability id in the error message.

**Backward compat.** Clients MUST tolerate the field's absence — only hosts that opt into runtime-capability advertisement expose it. NodeModules with no `requires` are unaffected.

Conformance coverage lives in `conformance/src/scenarios/runtime-capabilities.test.ts`.

### `secrets`

Lets a host advertise that it supports secret-resolution + BYOK (Bring-Your-Own-Key) flows for AI provider credentials and other host-managed secrets.

```json
"secrets": {
  "supported": true,
  "scopes": ["tenant", "user", "run"],
  "resolution": "host-managed"
}
```

**Field shape:**

- `supported` (boolean) — host has any secret-resolution at all. Hosts that don't store credentials (e.g., test deployments) return `false` and clients MUST NOT attempt BYOK flows.
- `scopes` (string array, subset of `["tenant", "user", "run"]`) — declares which secret-storage scopes the host implements. A `tenant`-scoped secret is shared across the workspace; `user`-scoped is per-end-user; `run`-scoped is ephemeral per-run. Hosts that support multiple scopes return all of them. **Naming alias**: hosts that store tenant-scoped secrets at a workspace-keyed path (e.g., a host that uses `workspaces/{wsId}/secrets/{id}`) advertise `tenant` here regardless of internal field naming — the wire term is `tenant`. **`run` scope is reserved** in v1.x; future hosts MAY advertise it without a spec bump (additive in this `scopes` array). Clients MUST tolerate any subset including unfamiliar future scopes.
- `resolution` (string, currently always `"host-managed"`) — the resolution mode. Reserved for forward-compat: future versions may add `"client-attached"` for clients that pass credentials inline (out of scope for v1.x — clients MUST use opaque references via `RunOptions.configurable.ai.credentialRef`).

**Client semantics.** Clients gate BYOK UX on `secrets.supported === true`. Without it, the BYOK flow is unavailable and the host serves all callers from platform-managed credentials.

**Server semantics.** Hosts that advertise secrets MUST implement a secret-resolution adapter. The adapter returns opaque resolved-secret references that downstream provider adapters dereference internally — raw key material NEVER appears in the protocol surface (no events, logs, traces, prompts, errors, exports, screenshots).

**Hard rule (NFR-7):** any code path that emits a `RunEvent`, OTel span, log line, error message, or exported artifact MUST NOT contain raw key material. Hosts MUST add lint + redaction unit tests verifying this invariant before exposing the BYOK surface.

### `aiProviders`

Companion to `secrets`. Advertises which AI providers the host's AI-proxy can route to and which permit BYOK.

```json
"aiProviders": {
  "supported": ["anthropic", "openai", "gemini"],
  "byok": ["anthropic", "openai"]
}
```

**Field shape:**

- `supported` (string array) — provider ids the host's AI-proxy can route to. Conventional ids: `anthropic`, `openai`, `gemini`, `mistral`, `cohere`, `vertex`, `bedrock`. Hosts MAY add vendor-prefixed extensions.
- `byok` (string array, subset of `supported`) — providers for which the host permits BYOK. Empty array → all calls use platform-managed keys; non-empty → clients MAY pass an opaque `ai.credentialRef` in `RunOptions.configurable` for matching providers.
- `selfHosted` (string array, subset of `supported`) — RFC 0108. The subset of `supported` whose entries are operator- or tenant-configured OpenAI-compatible endpoints rather than host-managed connections to known public vendors. See [`aiProviders.selfHosted`](#aiproviders-selfhosted--self-hostedopenai-compatible-provider-class-rfc-0108) below for its three normative rules.

**Client semantics.**

- `RunOptions.configurable.ai.provider` — selects the provider (must be in `supported`).
- `RunOptions.configurable.ai.model` — selects the model.
- `RunOptions.configurable.ai.credentialRef` — opaque host-issued reference to a stored secret (must reference a credential of a provider in `byok`).

**Server semantics.** Servers reject `ai.credentialRef` for providers NOT in `byok` with `credential_forbidden`. Servers reject unknown `provider` ids with `validation_error`.

#### `aiProviders.selfHosted` — self-hosted/OpenAI-compatible provider class (RFC 0108)

`supported`/`byok` say which providers a host routes to and which permit BYOK, but not whether an entry is a **host-managed connection to a known public vendor** (e.g. `anthropic`) or an **operator- or tenant-configured OpenAI-compatible endpoint** (Ollama, vLLM, LM Studio, or any `/v1/chat/completions`-compatible server). Those are materially different trust, capability, and key-custody surfaces. The optional `selfHosted[]` advertisement marks the latter so a client and the conformance suite can read the distinction honestly.

```json
"aiProviders": {
  "supported": ["anthropic", "openai", "ollama", "compat"],
  "byok": ["anthropic", "openai", "compat"],
  "selfHosted": ["ollama", "compat"]
}
```

`selfHosted` is OPTIONAL; an absent or empty array means the host advertises no self-hosted/compatible endpoints (its `supported[]` entries are all host-managed or BYOK-cloud connections — today's behavior). The capabilities document is **host-scoped**: a `selfHosted` entry means "this host supports configuring such an endpoint and at least one is configured in the advertising scope," not "you, the reading client, have one" — the same scope semantics `byok[]` already has.

**A.1 — Subset constraint.** Every entry of `aiProviders.selfHosted[]` MUST also appear in `aiProviders.supported[]`. A `selfHosted` entry MAY additionally appear in `aiProviders.byok[]` (the endpoint requires a tenant-supplied key) or not (the endpoint needs no key, e.g. a default Ollama).

**A.2 — Truthful advertisement (normative).** A host MUST list a provider id in `aiProviders.selfHosted[]` only when the host can route to **at least one configured, reachable** OpenAI-compatible endpoint for that id within the advertising scope. Listing a self-hosted provider with no backing endpoint is a dishonest capability claim per [§Truthful advertisement](#truthful-advertisement) and is non-conformant; `OPENWOP_REQUIRE_BEHAVIOR=true` MUST fail it.

**A.3 — Endpoint non-disclosure (normative).** The provider id in `selfHosted[]` is an opaque host-chosen label. A host MUST NOT encode the endpoint's network location (scheme, host, port, path, or base-URL) in the provider id, and MUST NOT disclose that location on any wire surface — the capabilities document, any `run.*` event payload, error envelopes, the debug bundle, exports, or replay state. See the `self-hosted-endpoint-no-disclosure` SECURITY invariant. Disclosing the endpoint leaks internal network topology and enables SSRF reconnaissance against the operator's network. The endpoint base-URL is **configuration, not a credential**; an optional endpoint key remains a BYOK credential governed by RFC 0046 verbatim.

**B — Capability non-inference (normative).** For a provider id present in `aiProviders.selfHosted[]`, a client MUST NOT infer model capabilities (e.g. `structured-output`, `discriminator-enum`, `function-calling`, `long-context`, `reasoning` per RFC 0031 §C, or input modalities per RFC 0091) from the provider id or from any known-vendor capability mapping. The **only** authoritative source of a self-hosted provider's capabilities is what the host actually advertises and gates on: `capabilities.modelCapabilities.advertised[]` (RFC 0031) and `aiProviders.input.modalities` (RFC 0091). A self-hosted endpoint whose capabilities the host does not advertise is treated as text-only; the host MUST refuse a request for an unadvertised capability or modality per the RFC 0031 model-capability gate (`capability_not_provided`), exactly as for any other provider. This prevents a client from assuming, e.g., that a `selfHosted` id named `ollama` supports vision merely because some public deployment of that engine does. How a host *derives* a self-hosted endpoint's capabilities — a static declaration captured at configuration time, or a runtime probe — is host-internal and out of scope, exactly as RFC 0031 §C leaves the derivation of the model-capability mapping host-internal.

#### `aiProviders.authModes` — BYOK auth-mode contract (RFC 0067, `Active`)

`supported` and `byok` say _which_ providers the host routes to and _which_ permit BYOK, but not _how_ a client is expected to supply a provider's credential. As the catalog grows beyond API-key providers (OAuth-backed providers, local Ollama/vLLM endpoints, platform-managed providers) the supply mechanism diverges. The optional `authModes` map advertises it so a client can pre-flight the credential UX without trial-and-error.

```json
"aiProviders": {
  "supported": ["anthropic", "openai", "vertex", "ollama"],
  "byok": ["anthropic", "openai"],
  "authModes": {
    "anthropic": ["apiKey"],
    "openai": ["apiKey"],
    "vertex": ["oauth-pkce"],
    "ollama": ["none"]
  }
}
```

**Field shape:** `authModes` is an OPTIONAL object whose keys are provider ids (each MUST appear in `supported`) and whose values are non-empty, unique arrays of auth modes drawn from the closed enum `["apiKey", "oauth-pkce", "oauth-device", "none", "subscription"]` (`subscription` added by RFC 0121, `Active`).

| Mode           | Meaning                                                                                                | Credential supply                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`       | Host accepts a stored API-key credential.                                                              | Client passes `RunOptions.configurable.ai.credentialRef` (today's BYOK path). Provider MUST appear in `byok`.                                         |
| `oauth-pkce`   | Host acquires a token via an OAuth 2.0 authorization-code + PKCE flow it owns (RFC 0047 `host.oauth`). | Client references the host-stored credential by `ref` (RFC 0046); the PKCE flow is host-driven; key material is NEVER passed on `ai.credentialRef`.   |
| `oauth-device` | Host acquires a token via an OAuth 2.0 device-authorization flow it owns.                              | Same as `oauth-pkce`.                                                                                                                                 |
| `none`         | Provider needs no caller-supplied credential.                                                          | A local provider (Ollama / vLLM at a host-configured endpoint) or one served entirely from platform-managed keys. Provider MUST NOT appear in `byok`. |
| `subscription` | Host accepts a credential derived from reusing the caller's existing **personal, non-metered consumer subscription** with the provider (e.g. Claude Pro/Max, ChatGPT Plus), rather than a metered API key (RFC 0121). | Client references the host-stored credential by `ref` (RFC 0046), like `oauth-pkce`/`oauth-device`; key/session material is NEVER passed on `ai.credentialRef`. Provider MUST appear in `byok`. The credential MUST bind at `host.credentials` `scope:"user"` — never tenant/workspace-shared. The acquisition mechanism (how the host obtains/refreshes the underlying session) is host-internal and out of scope. |

**Auth-mode contract (normative when `authModes` is advertised):**

1. Every key in `authModes` MUST also appear in `aiProviders.supported`.
2. A provider whose mode array includes `apiKey` MUST also appear in `aiProviders.byok` (`apiKey` _is_ the BYOK path; the two advertisements MUST agree).
3. A provider whose mode array is exactly `["none"]` MUST NOT appear in `aiProviders.byok`. A provider MAY advertise `["apiKey", "none"]` (BYOK permitted with a platform-managed fallback) and MUST then appear in `byok`.
4. A provider advertising `oauth-pkce` or `oauth-device` SHOULD also advertise `capabilities.oauth` (RFC 0047) with a matching provider `id`; the OAuth flow itself is governed by RFC 0047. The credential is referenced by `ref` (RFC 0046), never passed as key material.
5. Absent `authModes`, the default contract is unchanged: a provider in `byok` behaves as `apiKey`; a provider in `supported` but not in `byok` behaves as `none`. Clients MUST tolerate the field's absence and apply this default.
6. `authModes` advertises _capability_, not a per-run _requirement_ — per-provider policy enforcement remains `aiProviders.policies`. A client MUST NOT infer a policy mode from an auth mode, and MUST ignore an auth mode it does not recognize rather than reject the discovery document.

The following clauses are added by RFC 0121 (`Active`) and bind only a host that advertises the `subscription` mode for some provider:

7. A provider whose mode array includes `subscription` MUST also appear in `aiProviders.byok` (`subscription` _is_ a BYOK path — the caller supplies a credential, even if it is not an API key; the same rule as `apiKey`, clause 2). A provider MAY advertise multiple modes together, e.g. `["apiKey", "subscription"]`, meaning either an API key or a personal-subscription credential satisfies the same provider slot; the two resolve to **differently-scoped** credentials (see clause 8), not interchangeable ones.
8. **User-scope-only (MUST).** A credential resolved under `subscription` mode MUST be bound to `host.credentials` (RFC 0046) `scope:"user"`. A host MUST NOT resolve, store, or permit reference to a `subscription`-mode credential at `tenant`/`workspace` scope, and MUST reject an attempt to bind one at that scope with the canonical error code `credential_scope_forbidden`. This is the wire-level safety rail against silently sharing one individual's personal, single-seat subscription across a multi-user tenant (SECURITY invariant `subscription-credential-user-scope-only`).
9. A host MUST NOT advertise `subscription` for a provider without an operator-attested, provider-specific credential-acquisition mechanism actually configured and reachable — the same truthful-advertisement discipline RFC 0108 §A.2 established for `aiProviders.selfHosted`. This is host-attested (not statically machine-verifiable beyond capability shape), enforced only under `OPENWOP_REQUIRE_BEHAVIOR=true` behavioral scenarios.

**Provider-name vocabulary (non-normative).** `supported` stays an open `string[]`. To reduce cross-host id drift, hosts SHOULD use the recommended ids in `schemas/capabilities.schema.json` §`aiProviders.supported` when routing to a known provider (`anthropic`, `openai`, `gemini`, `vertex`, `bedrock`, `mistral`, `cohere`, `openrouter`, `litellm`, `together`, `huggingface`, `qwen`, `ollama`, `vllm`). The list is advisory; a host MAY advertise any vendor-prefixed extension id, and clients MUST tolerate unknown ids. Aggregators (`openrouter`, `litellm`) front many upstream models disambiguated by `RunOptions.configurable.ai.model` (host-interpreted); this spec does not normate a model-id grammar.

### `aiProviders.policies`

Additive companion to `aiProviders`. Lets a host advertise which **policy modes** it implements for per-provider gating. Hosts that omit this field implement no enforcement (clients see only `optional` semantics).

```json
"aiProviders": {
  "supported": ["anthropic", "openai", "gemini"],
  "byok": ["anthropic", "openai"],
  "policies": {
    "modes": ["disabled", "optional", "required", "restricted"],
    "scopes": ["workspace", "project", "canvas-type"],
    "errorCode": "provider_policy_denied"
  }
}
```

**Field shape:**

- `modes` (string array, subset of `["disabled", "optional", "required", "restricted"]`) — declares the policy modes this host can enforce. A host MAY support a subset (e.g., `["optional", "required"]`) — clients MUST tolerate any subset.
- `scopes` (string array, optional) — declares the resolution layers the host evaluates when computing the effective policy for a request. Conventional ids: `workspace`, `project`, `canvas-type`. Order is host-defined; the host MUST document its precedence rules.
- `errorCode` (string, optional, defaults to `provider_policy_denied`) — the wire-format error code returned when policy enforcement denies a request. Reserved for hosts that need a vendor-prefixed alias.

**The four modes** (host-side enforcement, opaque to the engine):

| Mode         | Meaning                                                              | Pre-dispatch behavior                                                                                                                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled`   | Provider MUST NOT be used at all.                                    | Reject before LLM call with `provider_policy_denied` (`reason: "provider_disabled"`).                                                                                                                                                                                                                                                 |
| `optional`   | No restriction. Default behavior; equivalent to no policy.           | Permit.                                                                                                                                                                                                                                                                                                                               |
| `required`   | Provider MAY only be used when the caller supplies BYOK credentials. | Two reject paths: pre-resolve, when `RunOptions.configurable.ai.credentialRef` is absent (`reason: "byok_required"`); post-resolve, when the credential reference was supplied but the resolver returned no usable secret (`reason: "byok_required_but_unresolved"`).                                                                 |
| `restricted` | Provider use is limited to an allowlist of model patterns.           | Reject when the requested model does not match any wildcard in `allowedModels` (`reason: "model_not_allowed"`). The same `reason` covers the case where the resolved `restricted` policy has an empty/missing `allowedModels` — a misconfigured policy fails closed via the same wire shape, with `allowed: []` in the error context. |

**`allowedModels`** is the per-policy companion field for `restricted` mode — a list of glob patterns matched against `RunOptions.configurable.ai.model`. Hosts MUST treat a `restricted` policy with no `allowedModels` as fail-closed; the rejection surfaces via `reason: "model_not_allowed"` (with an empty `allowed` array in the error context to disambiguate from the "model unmatched" subcase). The shape of stored policy documents (per-workspace / per-project / per-canvas-type) is host-internal and not part of the wire protocol.

**Wire-format error.** When policy enforcement denies a request, the host MUST respond with the `errorCode` advertised above (default `provider_policy_denied`) and SHOULD include a machine-readable `reason` field with one of `["provider_disabled", "byok_required", "byok_required_but_unresolved", "model_not_allowed"]`. The error MUST NOT echo the resolved policy document — only the _decision_. This shape applies whether the denial surfaces as an HTTP error (REST), a JSON-RPC error (MCP), or a stream chunk's `errorCode` (streaming AI responses).

**Resolver behavior.**

- A host MAY layer policy resolution across multiple scopes (workspace → project → canvas-type). The effective policy is the host's deterministic merge of layer outputs; precedence is host-defined and SHOULD be documented per-deployment.
- If the resolver itself is unavailable (network outage, storage failure), hosts SHOULD fail-open to `optional` rather than fail-closed — denying ALL requests during resolver outage breaks the runbook unrecoverably.
- The single exception is a `restricted` policy that resolved successfully but contains an empty/missing `allowedModels` — that's a misconfigured policy, not an outage, and MUST fail-closed (surfacing as `reason: "model_not_allowed"` with `allowed: []`).

**Audit emission.** Hosts SHOULD emit a per-decision audit event (host-internal taxonomy; conventional name `policy.decision`) carrying the resolved policy + which scope-layer supplied each field. The exact payload shape is host-internal and NOT part of the wire protocol — clients learn the _outcome_ through the `provider_policy_denied` error, not by subscribing to audit events.

**Backward compat.** Clients MUST tolerate the field's absence. A host that omits `policies` is equivalent to one that advertises `{"modes": ["optional"]}` and never returns `provider_policy_denied`.

### `aiProviders.promptPrefixCache` — portable prompt-prefix cache hint (RFC 0116)

Additive, provider-scoped companion to `aiProviders`. Advertises that the host honors the AI-envelope `generate` request's optional `cachePrefixId` (`ai-envelope.md` §"Prompt-prefix cache (RFC 0116)" + `host-capabilities.md` §host.aiEnvelope) as a routing hint into the routed provider's server-side context cache.

```json
"aiProviders": {
  "supported": ["anthropic", "openai", "gemini"],
  "promptPrefixCache": {
    "supported": true,
    "providers": ["anthropic"]
  }
}
```

**Field shape:**

- `supported` (boolean, required when the block is present) — whether the host honors `cachePrefixId`.
- `providers` (string array, optional) — the subset of `aiProviders.supported[]` for which the host honors `cachePrefixId`. Prefix caching is **provider-specific** (e.g. Anthropic ephemeral); this is **NOT a universal claim**. A request whose routed provider is not in this list MUST have `cachePrefixId` ignored. Absent ⇒ host-defined per-provider routing.

**Normative rules** (full text in `ai-envelope.md` §"Prompt-prefix cache (RFC 0116)"):

- **MAY honor / MUST ignore.** A host advertising `promptPrefixCache` for the routed provider MAY honor `cachePrefixId`; otherwise it MUST ignore it (no error, no behavior change).
- **Cross-tenant isolation (MUST).** The host MUST key its provider context cache by `(resolved tenant, cachePrefixId)` — tenant-namespaced, never global. Two tenants supplying the same `cachePrefixId` MUST NOT share a cache entry; tenant B's first use of A's id MUST be a miss. Enforced by SECURITY invariant `prompt-prefix-cache-cross-tenant-isolation` (protocol tier).
- **Replay invariance (MUST).** `cachePrefixId` is a cost hint, never a semantic input: the recorded envelope + `provider.usage.inputTokens`/`outputTokens` MUST be identical hit-vs-miss and MUST replay identically. The cost-only `provider.usage.cacheReadTokens`/`cacheWriteTokens` witness a hit (and a cross-tenant non-share) and are replay-non-asserted.
- **BYOK (MUST NOT).** `cachePrefixId` MUST NOT encode or derive from secret/BYOK material — it is the provider cache key and appears in host logs/metrics.

**Backward compat.** Clients MUST tolerate the field's absence; a host that omits `promptPrefixCache` ignores `cachePrefixId`.

### `fixtures`

Lets a host advertise the set of conformance fixture workflows it has seeded so the conformance suite can decide which fixture-dependent scenarios run vs. skip.

```json
"fixtures": ["conformance-noop", "conformance-delay", "conformance-cancellable"]
```

**Field shape:**

- OPTIONAL `string[]` of fixture-workflow IDs the host has seeded. Each ID matches the corresponding `id` of a fixture stub in `node_modules/@openwop/openwop-conformance/fixtures/{id}.json`.
- Hosts MAY advertise vendor-prefixed IDs (e.g., `openwop.smoke.byok`); the suite ignores IDs it doesn't recognize.
- Order is not significant. Duplicates SHOULD NOT appear; consumers MUST tolerate them by treating the set as deduplicated.
- Absent or empty array means the host advertises no fixtures.

**Client semantics.** The v1.0 conformance baseline reads the field at suite init and gates fixture-dependent scenarios with `it.skipIf` / `describe.skipIf`. A scenario whose fixture isn't advertised is reported as `skipped` rather than `failed`. SDK clients SHOULD ignore the field; it's a conformance-suite contract, not a client-facing capability.

**Server semantics.** Hosts that seed conformance fixtures SHOULD advertise them under `fixtures`. Hosts that don't ship the fixture surface MAY omit the field entirely; pre-RFC hosts that omit it are interpreted as "advertises no fixtures." The advertisement is a claim that the host has the workflow doc resolvable by `POST /v1/runs` `workflowId`; the suite verifies the runtime behavior end-to-end.

**`openwop-fixtures` profile.** Hosts that advertise at least one fixture satisfy the `openwop-fixtures` profile per `profiles.md`.

**Backward compat.** Clients MUST tolerate the field's absence — hosts that predate this profile omit it. The v1.0 conformance baseline reads the field when present and treats absence as a compatible default.

### `agents`

Multi-Agent Shift capability block (v1+). Hosts that implement any multi-agent surface declare it here; hosts that do not omit the block entirely. Each field gates a specific conformance scenario class; scenarios skip honestly when the relevant flag is absent.

```json
"agents": {
  "supported": true,
  "profile": "wop-agents-full",
  "modelClasses": ["reasoning", "tool-using", "chat"],
  "orchestratorPattern": "delegate.smart",
  "memoryBackends": ["long-term"],
  "orchestrator": true,
  "dispatch": true,
  "reasoning": { "verbosity": "summary", "tokenLimit": 512 }
}
```

**Phase semantics:**

- **Phase 1 — agent identity** (`supported: true` + optional `profile` + optional `reasoning`). When `true`, host accepts run-level `RunSnapshot.agent` / `runOrchestrator` fields, emits `agent.reasoned` / `agent.toolCalled` / `agent.toolReturned` / `agent.handoff` / `agent.decided` events, and honors the confidence-escalation contract (`agent.decided.confidence` below the resolved escalation threshold → suspend with `node.suspended { reason: 'low-confidence' }`).
- **Phase 2 — agent packs** (`modelClasses` + `orchestratorPattern`). `modelClasses` filters which `AgentManifest` distributions install on this host; manifests carrying an unsupported `modelClass` MUST refuse install with `unsupported_model_class`. `orchestratorPattern` advertises the host's supervisor strategy — canonical `single` / `delegate` / `delegate.smart`; vendor extensions under `vendor.<host>.<pattern>`.
- **Phase 3 — memory layer** (`memoryBackends`). `long-term` means the host implements `ExecutionHost.memory` against a durable store with the SR-1 redaction invariant intact end-to-end (BYOK plaintext substituted for `[REDACTED:<secretId>]` before any persisted write). Hosts that don't wire `MemoryAdapter` omit the field.
- **Phase 5 — orchestrator role** (`orchestrator: true`). Host advertises the `core.orchestrator.supervisor` node typeId AND honors the conservative-path suspend semantics (CP-1).
- **Phase 6 — dispatch loop** (`dispatch: true`). Host advertises the `core.dispatch` Core typeId AND honors the conservative-path commitment CP-2 (no mid-run DAG mutation). Implies (but does NOT require) `orchestrator: true`.

**Reasoning verbosity:**

- `verbosity: 'summary'` — host SHOULD bound each `agent.reasoned.reasoning` payload to `reasoning.tokenLimit` tokens (default 512). Recommended for production.
- `verbosity: 'full'` — host MAY emit complete model traces. Useful for debug-bundle inspection; not recommended for general production.
- `verbosity: 'off'` — host suppresses `agent.reasoned` events entirely. Conformance scenario `agentReasoningEvents.test.ts` skips when this mode is in effect.

Runs MAY override the host default via `RunOptions.configurable.reasoningVerbosity` (see `run-options.md`).

**Streaming reasoning (RFC 0024).** Hosts MAY advertise `agents.reasoning.streaming: true` to declare they emit `agent.reasoning.delta` events incrementally while a reasoning block is still open, in addition to the final `agent.reasoned`. Defaults to `false`. Consumers MUST tolerate both modes: a streaming host emits zero-or-more `agent.reasoning.delta` events followed by exactly one closing `agent.reasoned`; a non-streaming host emits only the closing event. The closing `agent.reasoned` event remains authoritative for reasoning content — if a host's truncation / redaction pipeline transforms the trace at finalize time, consumers reading only the closing event see the canonical result. See RFC 0024 §Proposal for the full normative contract.

**Backward compat.** Clients MUST tolerate the entire `agents` block's absence — pre-MAS hosts omit it. Within the block, every field is optional; pattern is "declare what you support, omit what you don't."

### `conversationPrimitive`

Multi-Agent Shift Phase 4 capability. When `true`, host advertises that it implements the `core.conversationGate` typeId AND honors the `conversation.start` / `conversation.exchange` / `conversation.close` suspend variants per `interrupt.md`. Hosts that don't claim this fall back to `clarification.requested` interrupts for multi-turn user interjections.

```json
"conversationPrimitive": true
```

**Field shape:** OPTIONAL `boolean`. Absent or `false` means the host does NOT implement the conversation primitive; multi-turn user interjections route through the legacy `clarification.requested` interrupt path.

**Conformance.** `conversationLifecycle.test.ts` / `conversationVsLegacySuspend.test.ts` / `conversationReplayDeterminism.test.ts` / `conversationCapabilityNegotiation.test.ts` gate on this flag.

**Refusal contract (normative).** A workflow whose `nodes[].typeId` references `core.conversationGate` and is submitted to a host whose `/.well-known/openwop` does NOT advertise `conversationPrimitive: true` MUST be refused. Hosts MAY refuse at workflow registration time OR at run-create time; the wire-shape semantics are otherwise identical (see §"Unsupported capability" below). The same refusal contract applies symmetrically to other capability-gated typeIds — see §"Unsupported capability" for the canonical envelope and the typeId → capability map.

**Backward compat.** Pre-MAS hosts omit the field. v1.0 conformance baseline reads the field when present and skips conversation scenarios when absent.

### `workflowChainPacks`

RFC 0013 (`Accepted` 2026-05-18; the matching spec doc [`workflow-chain-packs.md`](./workflow-chain-packs.md) remains at `DRAFT v1.x` pending Phase B/C closure). When `supported: true`, the host's workflow editor implements **workflow-chain pack expansion** — the author drops a chain tile, the host resolves the pack (verifying signature), prompts for `parameters`, substitutes `{{params.<name>}}` placeholders throughout the chain's DAG, rewrites node ids for collision avoidance, and splices the resulting nodes into the parent workflow. Dispatching runtimes see only the expanded `core.*`/published-vendor typeIds — the chain reference is NOT preserved at runtime, so this capability is a workflow-edit-time concern only.

```json
"workflowChainPacks": { "supported": true }
```

**Field shape:** OPTIONAL `object`. When present, `supported: boolean` is REQUIRED. Hosts that don't implement chain expansion omit the block entirely (or set `supported: false`).

**Conformance.** `workflow-chain-pack-manifest-validation.test.ts` gates on this flag for the registry-validation path; future `workflow-chain-expansion.test.ts` (Phase 2/3) will gate on it for end-to-end expansion. Hosts that don't advertise the capability are skipped, not failed.

**Runtime invariance.** The `workflowChainPacks` capability advertises **editor** support only — the runtime engine never sees chain-pack-specific surface (workflows reach the runtime fully expanded into concrete `core.*`/published-vendor typeIds). Hosts that omit the capability still execute workflows containing post-expansion DAGs cleanly; what they can't do is implement the author-time drag-tile flow. There is no runtime refusal contract for this capability — the chain reference is workflow-edit-time only and leaves no surface for the runtime to gate on.

### `connections`

RFC 0095 (`Draft`). When `packsSupported: true`, the host installs `kind: "connection"` registry packs — portable provider definitions ([`connection-packs.md`](./connection-packs.md)) — and MUST implement the [`connection-packs.md`](./connection-packs.md) §Manifest clause 6 resolution contract: an RFC 0045 connector's `auth.provider` (or an RFC 0047 `host.oauth` provider string) resolves against the installed connection pack whose `provider.id` matches, with installed-vs-built-in precedence per SemVer §11 and `connection_provider_unresolved` / `connection_provider_conflict` diagnostics.

```json
"connections": { "packsSupported": true }
```

**Field shape:** OPTIONAL `object`. When present, `packsSupported: boolean` is REQUIRED. Hosts that don't install connection packs omit the block entirely (provider resolution stays implementation-defined / host-built-in, exactly as before RFC 0095). An optional `supported: boolean` MAY accompany it for family-shape uniformity; behavior keys on `packsSupported` only.

**Composition.** Connection packs are only *useful* alongside `oauth.supported` (RFC 0047) or `credentials.supported` (RFC 0046); a host SHOULD NOT advertise `connections.packsSupported` without at least one of those.

**Conformance.** The `connection-pack-manifest-valid` / `connection-pack-no-credential-material` / `connection-pack-reach-exclusive` schema probes are always-on (server-free); the behavioral `connection-provider-resolution` / `connection-pack-write-reconsent` scenarios gate on `connections.packsSupported` and soft-skip when unadvertised (hard-fail under `OPENWOP_REQUIRE_BEHAVIOR=true`).

### `observability`

Optional v1 observability advertisement. See `observability.md`.

```json
"observability": {
  "namespace": "openwop",
  "spanAttributes": [
    "openwop.run_id",
    "openwop.node_id",
    "openwop.node_type",
    "openwop.event_seq",
    "openwop.workflow_id",
    "openwop.protocol_version"
  ],
  "spanNames": ["openwop.run", "openwop.node.<typeId>", "openwop.interrupt"]
}
```

A server that exports OTel traces MUST use the `openwop.*` namespace. Aliasing to vendor-specific taxonomies (e.g., `langgraph.*`, `datadog.*`) is per-deployment configuration, NOT spec'd.

---

## Post-launch v1.0 capability additions

The following capability blocks landed after the initial v1.0 freeze as additive normative shapes. All are optional; hosts that omit them remain v1-conformant.

### `orchestrator` (RFC 0006)

Distinct from the umbrella `agents.orchestrator: boolean` flag — this block carries the richer shape RFC 0006 §G requires.

```json
"orchestrator": {
  "supported": true,
  "workerIdInterpretation": "node",
  "fanOutSupported": false
}
```

- `supported` — when `true`, host implements `runOrchestrator` semantics (CO-1/CO-2/CO-3 ordering invariants).
- `workerIdInterpretation` — closed enum `"node" | "agent" | "either"`. Tells clients whether `OrchestratorDecision.nextWorkerIds` entries are node IDs (resolved against the run's DAG) or agent IDs (resolved via the workflow's agent-to-node binding).
- `fanOutSupported` — when `true`, host honors `nextWorkerIds.length > 1` per RFC 0007's `fanOutPolicy`. Hosts that always treat length > 1 as a workflow-authoring error set `false`.

When `orchestrator.supported: true`, hosts MUST also advertise `dispatch.supported: true` (orchestrator decisions need a dispatch translator).

### `dispatch` (RFC 0007)

```json
"dispatch": {
  "supported": true,
  "models": ["child-run"],
  "fanOutSupported": true,
  "fanOutPolicies": ["sequential", "reject", "parallel"],
  "joinModes": ["wait-all", "quorum", "first", "race"],
  "onChildFailureModes": ["collect", "fail-fast", "absorb"],
  "maxFanOut": 16,
  "askUserRoutings": ["conversation", "clarification", "auto"]
}
```

- `models` — supported `workerDispatchModel` values. v1.x normates only `"child-run"`; hosts MAY add vendor extensions under `vendor.<host>.<model>`.
- `fanOutSupported` — when `true`, host honors `nextWorkerIds.length > 1` per RFC 0007's `fanOutPolicy`. Since RFC 0118 it is ALSO the gate for accepting `fanOutPolicy: 'parallel'` at registration: a host advertising `false` MUST reject a `core.dispatch` node pinning `'parallel'` with a `validation_error` at `POST /v1/workflows`. Hosts that always treat length > 1 as a workflow-authoring error set `false`.
- `fanOutPolicies` (RFC 0118, OPTIONAL) — the `fanOutPolicy` values the host accepts. Lets an author detect partial support; a host MAY ship `["sequential", "reject"]` only (parallel unsupported) even with `fanOutSupported: true` for the length-rejection sense. Absent ⇒ treat as `["sequential", "reject"]`.
- `joinModes` (RFC 0118, OPTIONAL) — the `joinPolicy.mode` values the host implements for `fanOutPolicy: 'parallel'`. A host MAY ship `["wait-all"]` only. A `core.dispatch` node pinning a `joinPolicy.mode` not in `joinModes` is a registration `validation_error`. Absent ⇒ the host implements no parallel join (advertise `fanOutPolicies` without `"parallel"`).
- `onChildFailureModes` (RFC 0118, OPTIONAL) — the `joinPolicy.onChildFailure` values the host accepts. `joinPolicy` has two orthogonal axes — `mode` (completion condition) and `onChildFailure` (error aggregation) — and `joinModes` gates ONLY the first; this descriptor gates the second so an author can discover which aggregation modes a host honors. A `core.dispatch` node pinning a `joinPolicy.onChildFailure` not in `onChildFailureModes` is a registration `validation_error`. Absent ⇒ `["collect"]` (the `DispatchConfig.joinPolicy.onChildFailure` default) — a host that does not advertise the descriptor MUST reject a node pinning `'fail-fast'` or `'absorb'`, so the conservative default never silently accepts an unimplemented aggregation. A host implementing all three advertises `["collect", "fail-fast", "absorb"]`.
- `maxFanOut` (RFC 0118, OPTIONAL) — the host's hard concurrency/breadth ceiling for a parallel fan-out (§`maxConcurrency`). The effective concurrency is `min(config.maxConcurrency ?? ∞, maxFanOut ?? ∞)`; the host dispatches in waves up to this ceiling, never silently dropping children. Absent ⇒ unbounded (authors SHOULD treat absent as "unknown, may be capped").
- `askUserRoutings` — supported `askUserRouting` values from `DispatchConfig`. Hosts that omit `"conversation"` MUST also omit `conversationPrimitive: true`.

A host that advertises `dispatch.supported: true` but not `fanOutSupported: true` (or omits `"parallel"` from `fanOutPolicies`) is fully conformant — `fanOutPolicy: 'parallel'` is opt-in (RFC 0118).

### `memory` (RFC 0004)

Distinct from the umbrella `agents.memoryBackends: string[]` array — this block carries `MemoryAdapter` operational shape.

```json
"memory": {
  "supported": true,
  "maxEntrySizeBytes": 65536,
  "ttlSupported": true
}
```

- `supported` — when `true`, host implements the four-operation `MemoryAdapter` contract (`list`, `get`, `put`, `delete`) per RFC 0004 §A.
- `maxEntrySizeBytes` — upper bound on `MemoryEntry.content` size. Hosts SHOULD reject `put` requests exceeding this with `validation_error`.
- `ttlSupported` — when `true`, host honors `expiresAt` per RFC 0004 §E.

#### `memory.compaction` (RFC 0012, `Accepted`)

**Why this exists.** Long-running agents accumulate many small `MemoryEntry` rows over time. Hosts that periodically distill those into fewer, longer-lived summaries face two cross-host concerns: (1) observability — operators monitoring multi-host fleets need a canonical event vocabulary so dashboards don't have to learn each host's vendor extension; (2) security — summarization models can introduce secret-shaped substrings (hallucinated tokens, format-leaks from in-context examples) that were NOT present in any source entry, so the BYOK redaction pass MUST be reapplied at the compaction boundary. This sub-block standardizes both the wire shape and the SR-1 carry-forward invariant; the actual algorithm (summarization model, embedding scheme, scheduling) remains a host choice.

Optional sub-block. Hosts that distill many short-lived `MemoryEntry` rows into fewer long-lived ones MAY advertise it; hosts that don't are assumed not to compact (clients MUST NOT infer compaction from entry counts).

```json
"memory": {
  "supported": true,
  "maxEntrySizeBytes": 65536,
  "ttlSupported": true,
  "compaction": {
    "supported": true,
    "trigger": "host-managed",
    "maxInputEntries": 1000,
    "maxOutputBytes": 65536
  }
}
```

- `supported` (boolean, REQUIRED when the sub-block is present) — when `true`, host performs compaction over `longTerm` memory and emits the `memory.compacted` event per `observability.md` §"Canonical event vocabulary".
- `trigger` (closed enum `"host-managed" | "client-requested" | "both"`, REQUIRED when `supported: true`) — `host-managed` runs on a host-internal schedule clients do not control. `client-requested` and `both` are reserved enum values; v1.x normates only `host-managed`.
- `maxInputEntries` (integer, OPTIONAL) — informational ceiling on how many source entries one compaction collapses. Not wire-enforced.
- `maxOutputBytes` (integer, OPTIONAL) — informational ceiling on the distilled entry size. SHOULD be `≤ memory.maxEntrySizeBytes`.

**SR-1 carry-forward (normative).** Hosts advertising `memory.compaction.supported: true` MUST route compacted entry content through the same BYOK redaction harness applied to a fresh `put`. Per RFC 0012 §D, the fact that source entries were SR-1-compliant at original `put` time is NOT evidence to skip redaction on derived content — summarization models can introduce secret-shaped substrings not present in any source. See `SECURITY/invariants.yaml` row `memory-compaction-sr-1-carry-forward`.

#### `memory.distillation` (RFC 0062, `Active`)

**Why this exists.** A "dream" is a periodic background run that distills recent transactional memory into long-term artifacts under an explicit token budget, then refreshes a retrieval index the next session loads at startup. openwop already had the halves — `memory.compaction` (RFC 0012) defines host-managed distillation + the `memory.compacted` event, and `scheduling` (RFC 0052) defines scheduled run initiation — but nothing bound them, pinned a _token budget_, or defined the _index_ that closes the loop back to startup. Distillation composes them; it reuses the `memory.compacted` event (extended with an additive optional `distillation` sub-object) rather than minting a parallel `memory.distilled` event.

Optional sub-block. Hosts that omit it keep plain on-demand compaction (`memory.compaction`) or no memory; clients MUST NOT infer distillation from entry counts. The run contract — read snapshot → mandatory token budget → RFC 0012 distill with SR-1 carry-forward → byte-stable archive → `MEMORY-INDEX.json` workspace file → extended `memory.compacted` — is normative in [`agent-memory.md`](./agent-memory.md) §"Scheduled distillation".

```json
"memory": {
  "supported": true,
  "maxEntrySizeBytes": 65536,
  "ttlSupported": true,
  "distillation": {
    "supported": true,
    "maxTokenBudget": 8000,
    "scheduled": true,
    "indexEmitted": true,
    "tokenizerName": "claude",
    "archiveRetention": "P30D"
  }
}
```

- `supported` (boolean, REQUIRED when the sub-block is present) — when `true`, host honors the `distillation.tokenBudget` reserved run-option key (`run-options.md`), runs budgeted distillation over `longTerm` memory, writes a stable archive, and emits `memory.compacted` with the `distillation` sub-object.
- `maxTokenBudget` (integer, OPTIONAL) — largest per-run distillation token budget the host honors. A supplied `distillation.tokenBudget` is clamped to this; absent ⇒ the host defaults to this.
- `scheduled` (boolean, OPTIONAL) — when `true`, host can initiate distillation on a schedule (requires `capabilities.scheduling`, RFC 0052). Distillation MAY also run on-demand without scheduling.
- `indexEmitted` (boolean, OPTIONAL) — when `true`, host writes a retrievable memory-index manifest (`MEMORY-INDEX.json`, a workspace file per RFC 0059) after distillation; updating it emits `workspace.updated`.
- `tokenizerName` (string, OPTIONAL) — identifier of the tokenizer the budget is counted against (e.g. `claude`, `gpt-4`). The budget is best-effort-honest per this tokenizer (±10% conformance tolerance), not byte-exact.
- `archiveRetention` (string, OPTIONAL) — ISO-8601 duration (e.g. `P30D`) the distilled archives persist before GC. Recursive distillation (distilling prior archives) is allowed; each level re-checks SR-1.

**Token budget + SR-1 (normative).** A distillation run MUST stay within its effective `tokenBudget` (`min(distillation.tokenBudget, maxTokenBudget)`, defaulting to `maxTokenBudget` when absent); a source set that cannot be distilled within the budget MUST fail with `token_budget_exceeded` (`rest-endpoints.md`) and write no partial archive (atomic). SR-1 carry-forward (RFC 0012 §D) holds through distillation — a distilled archive MUST NOT re-expose a secret the sources had redacted; this reuses the `memory-compaction-sr-1-carry-forward` invariant, so distillation adds no new invariant.

### `runs.pauseResume` (Track 13)

```json
"runs": {
  "pauseResume": {
    "supported": true,
    "drainPolicies": ["immediate", "drain-current-node"]
  }
}
```

When `supported: true`, host implements `POST /v1/runs/{runId}:pause` and `:resume` per `rest-endpoints.md` §pause/resume.

### `idempotency` (Track 13 multi-region annex)

```json
"idempotency": {
  "supported": true,
  "layer1RetentionSeconds": 86400,
  "layer2RetentionSeconds": 1209600,
  "crossRegion": "best-effort"
}
```

`crossRegion` is a closed enum: `"single-region" | "best-effort" | "strict"`. Default value when the block is advertised but the field is omitted MUST be treated as `"single-region"` per `idempotency.md` §"Multi-region idempotency".

### `webhooks.signatureAlgorithms` (Track 13)

Extension of the existing webhooks block:

```json
"webhooks": {
  "supported": true,
  "signatureAlgorithms": ["v1"]
}
```

When `signatureAlgorithms` is surfaced, it MUST include `"v1"` (the canonical baseline). Hosts that omit the field continue to honor the absence-equals-`v1` rule per `webhooks.md` §"Signature algorithm versioning".

### `auth.profiles` and `auth.auditLogIntegrity` (Track 13)

Extension of the existing auth advertisement:

```json
"auth": {
  "profiles": ["openwop-auth-api-key-rotation", "openwop-auth-oidc-user-bearer", "openwop-audit-log-integrity"],
  "auditLogIntegrity": {
    "hashChain": true,
    "checkpointSignatureAlgorithm": "ed25519",
    "checkpointPublicKey": "MCowBQYDK2VwAyEA...",
    "checkpointIntervalEntries": 1000,
    "checkpointIntervalSeconds": 300
  },
  "oidc": {
    "issuers": ["https://accounts.example.com/"],
    "audience": "https://openwop.example.com",
    "supportedScopeMapping": "group-claim",
    "introspectionIntervalSeconds": 300
  }
}
```

Profile-string canonicalization follows `auth-profiles.md` §"Profile catalog". When `openwop-audit-log-integrity` appears in `auth.profiles`, the `auditLogIntegrity` block is REQUIRED.

---

## Capability stability tier — `tier` / `experimentalUntil` (RFC 0042)

Every object-valued capability sub-block under the network-handshake `capabilities.*` MAY carry an optional **`tier`** field, plus a paired **`experimentalUntil`** date. This makes a host's _stability claim_ for a capability machine-readable on the wire, so a consumer can tell a stable contract apart from an `Active`-RFC preview without fetching `RFCS/*.md`.

| Field               | Type                         | Meaning                                                                                                                                                                                                                                                                                                       |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tier`              | `"stable" \| "experimental"` | Absent ⇒ `"stable"`. `stable`: the host commits to this capability's wire shape across v1.x minors. `experimental`: the host advertises the surface as a preview; the wire shape MAY shift compatibly without notice until the underlying RFC graduates to `Accepted` and the host re-advertises as `stable`. |
| `experimentalUntil` | `string` (`YYYY-MM-DD`)      | **REQUIRED when `tier: "experimental"`** (schema-enforced via `if`/`then`). ISO-8601 date no more than 12 months past the discovery-response date.                                                                                                                                                            |

**Normative rules.**

- A host **MUST omit** `tier` for a capability whose underlying RFC is already `Accepted` (the advertisement is then unconditionally stable). A capability whose RFC is still `Active` **SHOULD** advertise `tier: "experimental"` until the RFC promotes.
- When `tier: "experimental"`, the host **MUST** advertise `experimentalUntil` ≤ 12 months out. This is enforced at the schema layer: `tier: "experimental"` without `experimentalUntil` **MUST** fail discovery validation.
- **Sunset rule.** Reaching `experimentalUntil` without the underlying RFC graduating to `Accepted` obliges the host to take one of three publicly-visible actions: **(1) flip to `stable`** (the wire shape held — commit to it); **(2) extend** with a new `experimentalUntil` ≤ 12 months out (a _second_ extension REQUIRES an open deprecation RFC justifying the continued flux); or **(3) retract** the capability advertisement (clients then receive `capability_not_provided` per §"Unsupported capability — refusal contract"). A host advertising an `experimentalUntil` in the past is **non-conformant** (`validation_error`, `details.field: "capabilities.<path>.experimentalUntil"`, `details.reason: "experimentalUntil_in_past"`).
- `tier` is **per-capability, not per-host**: a host MAY advertise some capabilities `stable` and others `experimental` in the same discovery payload.

**Conformance routing.** Scenarios gated on a capability consult its `tier` via the `experimentalGate(profileName, advertised, tier, experimentalUntil?)` helper (`conformance/src/lib/behavior-gate.ts`). Under default mode an `experimental` capability **soft-skips** (a dedicated `Skipped (experimental)` tally, distinct from the capability-gated skip bucket); it runs as a hard assertion only when **`OPENWOP_REQUIRE_EXPERIMENTAL=true`** is set (in addition to `OPENWOP_REQUIRE_BEHAVIOR=true`). A host that omits `tier` is evaluated as `stable` — the prior behavior, unchanged. The shape probes live in `conformance/src/scenarios/experimental-tier-shape.test.ts`.

A host advertising any `tier: "experimental"` capability derives the `openwop-experimental` profile (`profiles.md` §`openwop-experimental`); clients requiring stable-only contracts filter on its negation. This is **additive** (`COMPATIBILITY.md` §2.1): `tier` is optional with default `"stable"`, no existing wire surface changes, and existing v1 conformance passes are unaffected.

---

## Unsupported capability — refusal contract

Workflows MAY reference typeIds that are gated on optional capability advertisement (e.g., `core.conversationGate` is gated on `conversationPrimitive: true`). A host that does not advertise the gating capability MUST refuse such workflows. Refusal may occur at either of two boundaries:

1. **Workflow registration** (e.g., on `POST /v1/workflows` or equivalent): the host refuses the workflow document before it can be referenced by `POST /v1/runs`.
2. **Run creation** (`POST /v1/runs`): the host accepts the workflow document but refuses to create a run from it.

The protocol does NOT prescribe which boundary to use; hosts MAY choose either. What hosts MUST NOT do is silently fall back to a substitute behavior (e.g., demote `core.conversationGate` to `core.clarificationGate`) — the refusal is observable.

### Wire envelope

The refusal MUST use the canonical error envelope (`error-envelope.schema.json`) with:

- HTTP status code one of `400 Bad Request`, `404 Not Found`, or `422 Unprocessable Entity`. `400` is recommended when the host validates capability fitness eagerly; `422` is recommended when the host accepts the request shape but rejects on capability resolution; `404` is acceptable when the host treats the unregisterable workflow as not-found.
- `error.code` from the closed set:
  - `validation_error` (broadest — when capability gating is part of request validation),
  - `capability_required` (specific — preferred when the host wants to be unambiguous),
  - `not_found` (when registration was refused and the workflow is consequently unresolvable).
- `details.requiredCapability` SHOULD name the capability key whose absence triggered the refusal (e.g., `"conversationPrimitive"`).
- `details.offendingTypeId` SHOULD name the typeId in the workflow that triggered the gating (e.g., `"core.conversationGate"`).

```json
{
  "error": "capability_required",
  "message": "Workflow \"conformance-conversation-capability-negotiation\" references core.conversationGate, but this host does not advertise capabilities.conversationPrimitive: true.",
  "details": {
    "requiredCapability": "conversationPrimitive",
    "offendingTypeId": "core.conversationGate",
    "nodeId": "convo"
  }
}
```

### Capability-gated typeId map (normative)

| typeId                         | Gating capability              | Reference                      |
| ------------------------------ | ------------------------------ | ------------------------------ |
| `core.conversationGate`        | `conversationPrimitive: true`  | §`conversationPrimitive` above |
| `core.orchestrator.supervisor` | `orchestrator.supported: true` | §`orchestrator` (RFC 0006)     |
| `core.dispatch`                | `dispatch.supported: true`     | §`dispatch` (RFC 0007)         |

Future RFCs adding capability-gated reserved typeIds MUST extend this table and follow the same refusal contract.

### Conformance

`conversationCapabilityNegotiation.test.ts` exercises the refusal contract for `core.conversationGate` against hosts that do not advertise `conversationPrimitive: true`. Analogous scenarios for the other gated typeIds ship as their gating capabilities migrate to general advertisement.

---

## Engine-enforced limits and the `cap.breached` event (closes CC-1 spec-side)

The `Capabilities.limits` fields (`clarificationRounds`, `schemaRounds`, `envelopesPerTurn`, `maxNodeExecutions`, and — per RFC 0058 — `maxRunDurationMs`, `maxLoopIterations`) are engine-enforced — the server MUST emit a `cap.breached` event AND fail the run / node when an attempted operation would exceed the configured ceiling. All kinds share the same event surface (`run-event-payloads.schema.json#$defs.capBreached`) so consumers handle one event with a `kind` discriminator instead of N parallel surfaces.

### `cap.breached` payload

| Field      | Type              | Notes                                                                                                                                                                                                                                                                                               |
| ---------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`     | string            | One of `clarification`, `schema`, `envelopes`, `node-executions`; `wasm-memory` / `wasm-fuel` / `wasm-execution-time` (RFC 0008 §K); `run-duration` / `loop-iterations` (RFC 0058).                                                                                                                 |
| `limit`    | integer           | The ceiling that was tripped (server-resolved value — see §Resolution below). For `run-duration` this is the resolved timeout in milliseconds; for `loop-iterations` the resolved iteration ceiling.                                                                                                |
| `observed` | integer           | The observed value at the moment of trip. Always strictly greater than `limit`. For `run-duration` the elapsed milliseconds; for `loop-iterations` the iteration count. MUST be recorded in the event and reused on replay / `:fork` — never recomputed from a live clock or counter (`replay.md`). |
| `nodeId`   | string (optional) | Set for node-scoped limits (`clarification`, `schema`). Absent for run-scoped limits (`envelopes`, `node-executions`, `run-duration`, `loop-iterations`).                                                                                                                                           |

### Resolution: `recursionLimit` + `maxNodeExecutions`

For the `node-executions` kind specifically (which is the runtime invariant for `recursionLimit`):

1. The server resolves the effective limit as `min(RunOptions.configurable.recursionLimit, Capabilities.limits.maxNodeExecutions)`. If the caller didn't supply `configurable.recursionLimit`, the server uses `maxNodeExecutions` directly.
2. The server validates the caller's supplied value at run-create time via the `validateRecursionLimit()` helper documented in `run-options.md`. Out-of-range values return `400 validation_error` BEFORE the run starts — never at runtime.
3. The server maintains a per-run `nodeExecutionCount` counter, incremented on every node-state transition into `started`.
4. When `nodeExecutionCount > resolvedLimit`, the server:
   - Emits `cap.breached` with `kind: 'node-executions'`, `limit: resolvedLimit`, `observed: nodeExecutionCount`.
   - Transitions the run to `failed`.
   - Sets `RunSnapshot.error.code = 'recursion_limit_exceeded'` and `RunSnapshot.error.message` to a human-readable description.
   - Stops scheduling further nodes.

The other three kinds follow analogous patterns (per `clarification` / `schema` / `envelopes` semantics in §In-package shape above), differing only in _what_ gets counted and _which counter_ resets when.

### Resolution: `run-duration` + `loop-iterations` (RFC 0058)

Two run-scoped bounds follow the same resolve-at-create, enforce-at-runtime, emit-`cap.breached` pattern:

- **`run-duration`** — the server resolves `min(RunOptions.configurable.runTimeoutMs, Capabilities.limits.maxRunDurationMs)` (measured from `run.started`), validates the caller's value at run-create (`400 validation_error` if out of range), and on expiry emits `cap.breached { kind: 'run-duration', limit: <resolvedMs>, observed: <elapsedMs> }`, transitions the run to `failed` with `error.code = 'run_timeout'`, and stops scheduling.
- **`loop-iterations`** — for hosts advertising `multiAgent.executionModel.supported` (the execution loop, RFC 0037; orchestrator turns are the counted iterations), the server resolves `min(RunOptions.configurable.maxLoopIterations, Capabilities.limits.maxLoopIterations)`, counts one increment per orchestrator turn, and on exceedance emits `cap.breached { kind: 'loop-iterations', limit: <resolvedMax>, observed: <iterationCount> }`, transitions to `failed` with `error.code = 'loop_limit_exceeded'`, and stops scheduling.

Both are run-scoped (no `nodeId`). Adding these two kinds to the `capBreached.kind` enum is additive — no `eventLogSchemaVersion` bump — exactly as RFC 0008 §K added the `wasm-*` kinds.

### What this closes

- **CC-1**: the `recursionLimit` runtime invariant. Validation and runtime enforcement are expressed as a unified `cap.breached` emission rather than a separate event class. No `eventLogSchemaVersion` bump required — `cap.breached` already exists with `node-executions` in its `kind` enum (per `run-event-payloads.schema.json` and the `openwop.cap_kind` OTel attribute in `observability.md`).
- **CC-4**: `Capabilities.limits.maxNodeExecutions` is optional in v1 (only the three base limits are schema-required); hosts that advertise it MUST enforce it. Default `100`. The clamp ceiling for `recursionLimit` overrides.

### Industry-standard alignment

Modern workflow engines unify limit-related failures under a small set of event types:

- LangGraph: `GraphRecursionError` (single error class).
- Temporal / Cadence: cap exceedance folds under `WorkflowExecutionTimedOut` / `ActivityTaskFailed` with reason discriminator.
- AWS Step Functions: `ExecutionFailed` with `error: "States.Runtime"` covers all runtime caps.

openwop follows the same pattern: `cap.breached` with a `kind` discriminator covers all engine-enforced caps — the four core kinds, the RFC 0008 `wasm-*` runtime caps, and the RFC 0058 `run-duration` / `loop-iterations` bounds.

### Conformance fixture

`conformance-cap-breach` (specced in `conformance/fixtures.md`) exercises the path end-to-end: 10 sequential noop nodes + `configurable.recursionLimit: 5` → terminal `failed` + `cap.breached` event with `kind: 'node-executions'`.

---

## Status legend

- **required v1** — required by `schemas/capabilities.schema.json`; every conforming host MUST include it.
- **optional v1** — shape is stable when present; hosts MAY omit when unsupported, and clients MUST tolerate absence.
- **future** — not part of the v1 wire shape; use only in roadmap/RFC text until it is added to the schema.

---

## Capability negotiation flow

A typical client startup:

```text
1. Client → GET /.well-known/openwop
2. Server → 200 OK, Capabilities JSON
3. Client checks:
   - protocolVersion satisfies my pinned floor?  → if not, abort with version-mismatch UX
   - implementation.version known?               → log advisory if mismatch
   - minClientVersion ≤ my version, if present?  → if not, abort with upgrade-required UX
   - supportedEnvelopes includes envelopes I emit? → if not, narrow my behavior
   - advertised profiles cover my workflow needs?  → if not, choose another host
   - limits compatible with my workload?         → if not, surface to user
4. Client → first protocol request
```

The server MUST NOT change capability response shape mid-session in a way that invalidates a client's prior negotiation. If the server's capabilities change (e.g., new node pack registered), it MAY surface this via a `Capabilities-Etag` response header that clients can probe periodically. See `capabilities-change-detection.md` for validator semantics, scoped capability views, and non-HTTP discovery handoff guidance.

---

## Backward compatibility

Adding new fields to the `Capabilities` shape is non-breaking — clients ignore unknown fields. Removing or renaming fields is breaking and MUST be accompanied by a `protocolVersion` bump.

The required/optional split protects implementers from over-pinning: a host can be conformant with only the required base fields, while richer hosts can advertise optional profiles and capabilities without changing the protocol version.

---

## Open spec gaps

| #   | Gap                                                                                                                         | Owner      |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---------- |
| C2  | ✅ Closed by `capabilities-change-detection.md`: `Capabilities-Etag` semantics for mid-session capability change detection. | v1.x annex |
| C3  | ✅ Closed by `capabilities-change-detection.md`: non-HTTP discovery handoff guidance for MCP/A2A composition.               | v1.x annex |
| C5  | ✅ Closed by `capabilities-change-detection.md`: scoped capability view rules without leaking private tenant features.      | v1.x annex |

## References

- `version-negotiation.md` — `engineVersion` + `eventLogSchemaVersion` deploy-skew safety
- `capabilities-change-detection.md` — `Capabilities-Etag`, scoped views, and non-HTTP discovery handoff
- `auth.md` — `/.well-known/openwop` is unauthenticated by design
- `run-options.md` — `configurable` field semantics
- `observability.md` — `openwop.*` OTel taxonomy
