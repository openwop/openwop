# openwop Spec v1 — Capability Declaration (`/.well-known/openwop`)

> **Status: FINAL v1 (2026-04-27; hygiene pass 2026-05-10).** Formalized as `schemas/capabilities.schema.json`. The public network handshake at `GET /.well-known/openwop` is the canonical v1 capability declaration. Fields marked **required v1** are required for conformance; fields marked **optional v1** have stable wire shapes but MAY be omitted by hosts that do not support the capability. Conformance suite scenarios verify the required surface end-to-end and gate optional profile scenarios from this document. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

External clients (CLIs, SDKs, agents from other ecosystems) need a deterministic way to discover what an OpenWOP-compliant server can do *before* they issue requests. Specifically:

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

| Method | Path | Auth | Cache |
|---|---|---|---|
| `GET` | `/.well-known/openwop` | None (public) | `Cache-Control: public, max-age=300` recommended |

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

**Default limits** (`DEFAULT_CAPABILITY_LIMITS` in `Capabilities.ts:118`):

```typescript
{ clarificationRounds: 3, schemaRounds: 2, envelopesPerTurn: 5 }
```

**Helper functions**:
- `buildCapabilities(opts)` — construct from envelope catalog + limits. Validates `schemaVersions` are non-negative integers (`Capabilities.ts:142`).
- `formatCapabilitiesForPrompt(caps)` — render as system-prompt text block. Sorts envelope types + extension keys deterministically for prompt-cache stability (`Capabilities.ts:186`).
- `mergeCapabilities(base, extension)` — per-canvas-type merge. Union of envelopes, extension wins on schema-version + limit conflicts (`Capabilities.ts:265`).

**Enforcement**: Implementations typically track counters per (run, task, turn) and emit a capability-limit error on breach. The public wire consequence is the `cap.breached` event described below.

---

## Network-handshake shape

The full `GET /.well-known/openwop` response. Only `protocolVersion`, `supportedEnvelopes`, `schemaVersions`, and the three base `limits` are required by `schemas/capabilities.schema.json`. Additional fields below are **optional v1**: their shapes are stable when present, and clients MUST tolerate absence.

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
    "maxRunDurationSec": 86400,
    "maxRequestBodyBytes": 1048576
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

### Field reference

| Field | Type | Status | Notes |
|---|---|---|---|
| `protocolVersion` | `string` | **required v1** | Protocol version the server speaks, e.g. `"1.0"`. |
| `supportedEnvelopes` | `string[]` | **required v1** | Envelope `type` strings the engine recognizes. |
| `schemaVersions` | `Record<string, number>` | **required v1** | Active schema version per envelope type. **Per-envelope-type integer**, not per-spec-type semver. |
| `limits.clarificationRounds` | `number` | **required v1** | Default `3`. |
| `limits.schemaRounds` | `number` | **required v1** | Default `2`. |
| `limits.envelopesPerTurn` | `number` | **required v1** | Default `5`. |
| `extensions` | `Record<string, unknown>` | **optional v1** | Per-host or per-workflow extension data. Clients treat as opaque. |
| `implementation.{name,version,vendor}` | object | **optional v1** | Identifies the server. |
| `engineVersion` | `number` | **optional v1** | See `version-negotiation.md`. |
| `eventLogSchemaVersion` | `number` | **optional v1** | See `version-negotiation.md`. |
| `supportedTransports` | `string[]` | **optional v1** | Subset of `["rest", "mcp", "a2a", "grpc"]`. REST is required regardless of whether this field is present. |
| `limits.maxNodeExecutions` | `number` | **required v1** | Default `100`. Engine-side ceiling clamping `RunOptions.configurable.recursionLimit`. Exceedance emits `cap.breached` with `kind: "node-executions"` and transitions the run to `failed` per §"Engine-enforced limits + cap.breached" below. |
| `limits.maxRunDurationSec` | `number` | **optional v1** | Maximum run duration the host intends to allow. |
| `limits.maxRequestBodyBytes` | `number` | **optional v1** | Maximum REST request body accepted by the host. |
| `configurable` | object | **optional v1** | Per-run parameter overlay schema. |
| `observability` | object | **optional v1** | OTel attribute taxonomy hints. See `observability.md`. |
| `minClientVersion` | `string` | **optional v1** | Client-side version floor for `426 Upgrade Required`-style UX. |
| `runtimeCapabilities` | `string[]` | **optional v1** | Host-advertised opaque capability ids that NodeModules may require via `NodeModule.requires`. See §"Runtime capabilities" below. |
| `secrets.supported` | `boolean` | **optional v1** | Host advertises secret/credential resolution. Clients gate BYOK flows on this. See §"Secrets" below. |
| `secrets.scopes` | `string[]` | **optional v1** | Subset of `["tenant", "user", "run"]`. |
| `secrets.resolution` | `string` | **optional v1** | Currently `"host-managed"`. Reserved for future modes. |
| `aiProviders.supported` | `string[]` | **optional v1** | Providers the host's AI proxy can route to (`anthropic`, `openai`, `gemini`, etc.). |
| `aiProviders.byok` | `string[]` | **optional v1** | Subset of `aiProviders.supported` for which BYOK is permitted. |
| `aiProviders.policies` | object | **optional v1** | Host-side policy enforcement modes (`disabled` / `optional` / `required` / `restricted`). |
| `fixtures` | `string[]` | **optional v1** | Fixture workflow IDs the host has seeded. Conformance-suite-only contract. |

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

Lets a host advertise opaque host facilities that NodeModules can require via `NodeModule.requires?: readonly string[]`. The protocol owns the *check*; provider value shapes are documented per-capability alongside their consumers, NOT here.

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

**Client semantics.**

- `RunOptions.configurable.ai.provider` — selects the provider (must be in `supported`).
- `RunOptions.configurable.ai.model` — selects the model.
- `RunOptions.configurable.ai.credentialRef` — opaque host-issued reference to a stored secret (must reference a credential of a provider in `byok`).

**Server semantics.** Servers reject `ai.credentialRef` for providers NOT in `byok` with `credential_forbidden`. Servers reject unknown `provider` ids with `validation_error`.

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

| Mode | Meaning | Pre-dispatch behavior |
|---|---|---|
| `disabled` | Provider MUST NOT be used at all. | Reject before LLM call with `provider_policy_denied` (`reason: "provider_disabled"`). |
| `optional` | No restriction. Default behavior; equivalent to no policy. | Permit. |
| `required` | Provider MAY only be used when the caller supplies BYOK credentials. | Two reject paths: pre-resolve, when `RunOptions.configurable.ai.credentialRef` is absent (`reason: "byok_required"`); post-resolve, when the credential reference was supplied but the resolver returned no usable secret (`reason: "byok_required_but_unresolved"`). |
| `restricted` | Provider use is limited to an allowlist of model patterns. | Reject when the requested model does not match any wildcard in `allowedModels` (`reason: "model_not_allowed"`). The same `reason` covers the case where the resolved `restricted` policy has an empty/missing `allowedModels` — a misconfigured policy fails closed via the same wire shape, with `allowed: []` in the error context. |

**`allowedModels`** is the per-policy companion field for `restricted` mode — a list of glob patterns matched against `RunOptions.configurable.ai.model`. Hosts MUST treat a `restricted` policy with no `allowedModels` as fail-closed; the rejection surfaces via `reason: "model_not_allowed"` (with an empty `allowed` array in the error context to disambiguate from the "model unmatched" subcase). The shape of stored policy documents (per-workspace / per-project / per-canvas-type) is host-internal and not part of the wire protocol.

**Wire-format error.** When policy enforcement denies a request, the host MUST respond with the `errorCode` advertised above (default `provider_policy_denied`) and SHOULD include a machine-readable `reason` field with one of `["provider_disabled", "byok_required", "byok_required_but_unresolved", "model_not_allowed"]`. The error MUST NOT echo the resolved policy document — only the *decision*. This shape applies whether the denial surfaces as an HTTP error (REST), a JSON-RPC error (MCP), or a stream chunk's `errorCode` (streaming AI responses).

**Resolver behavior.**

- A host MAY layer policy resolution across multiple scopes (workspace → project → canvas-type). The effective policy is the host's deterministic merge of layer outputs; precedence is host-defined and SHOULD be documented per-deployment.
- If the resolver itself is unavailable (network outage, storage failure), hosts SHOULD fail-open to `optional` rather than fail-closed — denying ALL requests during resolver outage breaks the runbook unrecoverably.
- The single exception is a `restricted` policy that resolved successfully but contains an empty/missing `allowedModels` — that's a misconfigured policy, not an outage, and MUST fail-closed (surfacing as `reason: "model_not_allowed"` with `allowed: []`).

**Audit emission.** Hosts SHOULD emit a per-decision audit event (host-internal taxonomy; conventional name `policy.decision`) carrying the resolved policy + which scope-layer supplied each field. The exact payload shape is host-internal and NOT part of the wire protocol — clients learn the *outcome* through the `provider_policy_denied` error, not by subscribing to audit events.

**Backward compat.** Clients MUST tolerate the field's absence. A host that omits `policies` is equivalent to one that advertises `{"modes": ["optional"]}` and never returns `provider_policy_denied`.

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
  "fanOutSupported": false,
  "askUserRoutings": ["conversation", "clarification", "auto"]
}
```

- `models` — supported `workerDispatchModel` values. v1.x normates only `"child-run"`; hosts MAY add vendor extensions under `vendor.<host>.<model>`.
- `askUserRoutings` — supported `askUserRouting` values from `DispatchConfig`. Hosts that omit `"conversation"` MUST also omit `conversationPrimitive: true`.

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

| typeId | Gating capability | Reference |
|---|---|---|
| `core.conversationGate` | `conversationPrimitive: true` | §`conversationPrimitive` above |
| `core.orchestrator.supervisor` | `orchestrator.supported: true` | §`orchestrator` (RFC 0006) |
| `core.dispatch` | `dispatch.supported: true` | §`dispatch` (RFC 0007) |

Future RFCs adding capability-gated reserved typeIds MUST extend this table and follow the same refusal contract.

### Conformance

`conversationCapabilityNegotiation.test.ts` exercises the refusal contract for `core.conversationGate` against hosts that do not advertise `conversationPrimitive: true`. Analogous scenarios for the other gated typeIds ship as their gating capabilities migrate to general advertisement.

---

## Engine-enforced limits and the `cap.breached` event (closes CC-1 spec-side)

The four `Capabilities.limits` fields (`clarificationRounds`, `schemaRounds`, `envelopesPerTurn`, `maxNodeExecutions`) are engine-enforced — the server MUST emit a `cap.breached` event AND fail the run / node when an attempted operation would exceed the configured ceiling. All four kinds share the same event surface (`run-event-payloads.schema.json#$defs.capBreached`) so consumers handle one event with a `kind` discriminator instead of N parallel surfaces.

### `cap.breached` payload

| Field | Type | Notes |
|---|---|---|
| `kind` | string | One of `clarification`, `schema`, `envelopes`, `node-executions`. |
| `limit` | integer | The ceiling that was tripped (server-resolved value — see §Resolution below). |
| `observed` | integer | The observed value at the moment of trip. Always strictly greater than `limit`. |
| `nodeId` | string (optional) | Set for node-scoped limits (`clarification`, `schema`). Absent for run-scoped (`envelopes`, `node-executions`). |

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

The other three kinds follow analogous patterns (per `clarification` / `schema` / `envelopes` semantics in §In-package shape above), differing only in *what* gets counted and *which counter* resets when.

### What this closes

- **CC-1**: the `recursionLimit` runtime invariant. Validation and runtime enforcement are expressed as a unified `cap.breached` emission rather than a separate event class. No `eventLogSchemaVersion` bump required — `cap.breached` already exists with `node-executions` in its `kind` enum (per `run-event-payloads.schema.json` and the `openwop.cap_kind` OTel attribute in `observability.md`).
- **CC-4**: `Capabilities.limits.maxNodeExecutions` is required in v1. Default `100`. The clamp ceiling for `recursionLimit` overrides.

### Industry-standard alignment

Modern workflow engines unify limit-related failures under a small set of event types:

- LangGraph: `GraphRecursionError` (single error class).
- Temporal / Cadence: cap exceedance folds under `WorkflowExecutionTimedOut` / `ActivityTaskFailed` with reason discriminator.
- AWS Step Functions: `ExecutionFailed` with `error: "States.Runtime"` covers all runtime caps.

openwop follows the same pattern: `cap.breached` with a `kind` discriminator covers all four engine-enforced caps.

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

```
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

| # | Gap | Owner |
|---|---|---|
| C2 | ✅ Closed by `capabilities-change-detection.md`: `Capabilities-Etag` semantics for mid-session capability change detection. | v1.x annex |
| C3 | ✅ Closed by `capabilities-change-detection.md`: non-HTTP discovery handoff guidance for MCP/A2A composition. | v1.x annex |
| C5 | ✅ Closed by `capabilities-change-detection.md`: scoped capability view rules without leaking private tenant features. | v1.x annex |

## References

- `version-negotiation.md` — `engineVersion` + `eventLogSchemaVersion` deploy-skew safety
- `capabilities-change-detection.md` — `Capabilities-Etag`, scoped views, and non-HTTP discovery handoff
- `auth.md` — `/.well-known/openwop` is unauthenticated by design
- `run-options.md` — `configurable` field semantics
- `observability.md` — `openwop.*` OTel taxonomy
