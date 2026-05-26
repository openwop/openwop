> **Status: Stable · v1.1 (2026-05-22).** Normative spec for conformance-only host-sample test seams under `/v1/host/sample/*`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

# Host-sample test seams

OpenWOP's [conformance suite](../../conformance/) verifies behavioral contracts that v1 cannot probe through the production wire surface alone. Examples:

- "the prompt resolution chain layered correctly" can be observed end-to-end via `prompt.composed` event payloads, but isolating layer-by-layer precedence requires a synchronous resolver endpoint
- "the LLM cache-key recipe produced byte-identical output across hosts" can only be asserted if hosts expose their `canonicalize → SHA-256 → hex` computation
- "OTel span attributes don't carry BYOK canaries" requires an introspection endpoint scoped to a run

These contracts ship as **conformance-only test seams** under the `host-extensions.md` §"Canonical prefixes" namespace `/v1/host/sample/*`. They are NOT part of the v1 wire surface — production hosts SHOULD return `404` or `403` from these seams unless an env-gate (named per-seam below) is set.

This doc is the **canonical reference** for the test-seam contracts. Per-seam normative content also appears in the RFC + spec doc that introduces the seam; this doc is the consolidated index hosts implement against.

## Capability advertisement (normative)

Hosts that expose any test seam MUST advertise it under `/.well-known/openwop` per `capabilities.md`. The advertising flags are tabulated below per seam. Conformance scenarios capability-gate on the matching flag; hosts that don't advertise skip cleanly.

## Test seams

### 1. `POST /v1/host/sample/prompt/resolve` — Prompt resolution chain (RFC 0029)

| Field | Value |
|---|---|
| Method + path | `POST /v1/host/sample/prompt/resolve` |
| Capability gate | `capabilities.prompts.supported: true` |
| Env gate (reference impl) | seam registered when `capabilities.prompts.supported` is asserted |
| Introduced | RFC 0029 §C |

Request body:

```typescript
{
  kind: 'system' | 'user' | 'few-shot' | 'schema-hint',
  node: {
    nodeId: string,
    config?: {
      systemPromptRef?: string | PromptRef,
      userPromptRef?: string | PromptRef,
      schemaHintPromptRef?: string | PromptRef,
      fewShotPromptRefs?: Array<string | PromptRef>,
      agentId?: string,
    },
  },
  agentManifest?: {
    agentId: string,
    systemPrompt?: string,
    systemPromptRef?: string,
    promptOverrides?: Partial<Record<PromptKind, string | PromptRef>>,
    promptLibraryRef?: string,
  },
  workflowDefaults?: { promptRefs?: Partial<Record<PromptKind, string | PromptRef>> },
  hostDefaults?: Partial<Record<PromptKind, string | PromptRef>>,
  agentBindingsSupported?: boolean,    // overrides capabilities.prompts.agentBindings for this probe
}
```

Response body:

```typescript
{
  resolved: string | null,                                                      // rendered prompt text after variable substitution, or null if all 4 layers yielded null
  resolvedAt: 'node' | 'agent-intrinsic' | 'workflow' | 'host' | null,          // which layer won
  chain: Array<{                                                                 // every layer attempted, in priority order
    layer: 'node' | 'agent-intrinsic' | 'workflow' | 'host',
    ref: string | null,
    resolved: string | null,
  }>,
}
```

Hosts that advertise `capabilities.prompts.supported: true` MUST serve this seam with the documented shape. The `chain[]` array MUST list every layer attempted even when an earlier layer wins — conformance scenarios assert the full traversal record.

Conformance: `prompt-resolution-chain-{node-wins,agent-intrinsic,fallback-cascade}.test.ts`.

### 2. `GET /v1/host/sample/test/otel/spans?runId=<id>` — OTel span scrape (RFC 0034)

| Field | Value |
|---|---|
| Method + path | `GET /v1/host/sample/test/otel/spans?runId=<id>` |
| Capability gate | `capabilities.observability.testSeams.otelScrape: true` |
| Env gate (reference impl) | `OPENWOP_TEST_OTEL_SCRAPE=true` |
| Introduced | RFC 0034 §B |

Returns recorded OTel spans for the named run. When `otelScrape: true`, the host MUST return `200 OK` with body:

```typescript
{
  spans: Array<{
    name: string,                                  // span name, e.g., "openwop.run", "openwop.dispatch"
    attributes: Record<string, unknown>,           // span attributes including any openwop.*-prefixed keys
    events: Array<{ name: string, attributes?: Record<string, unknown> }>,
  }>,
}
```

The `spans[]` array MUST include every span produced by the host's instrumentation for the named run, including any `openwop.*`-prefixed attributes added to span context. Hosts MAY redact span content using the canonical `[REDACTED:<secretId>]` marker per `agent-memory.md` §"SR-1 secret-redaction invariant" — that's the contract conformance tests.

The seam graduates two SECURITY invariants from `reference-impl` to `protocol` tier:
- `secret-leakage-otel-attribute` — BYOK plaintexts MUST NOT appear as values on any `openwop.*` OTel attribute
- (paired) `secret-leakage-debug-bundle-otel` — same invariant on debug-bundle exports

Conformance: `envelope-reasoning-secret-redaction.test.ts` (capability-gated on the seam).

### 3. `POST /v1/host/sample/test/debug-bundle/export` — Debug-bundle export probe (RFC 0034)

| Field | Value |
|---|---|
| Method + path | `POST /v1/host/sample/test/debug-bundle/export` |
| Capability gate | `capabilities.observability.testSeams.debugBundleExport: true` |
| Env gate (reference impl) | `OPENWOP_TEST_DEBUG_BUNDLE_EXPORT=true` |
| Introduced | RFC 0034 §B |

Synchronous debug-bundle export for conformance scenarios that need to assert canary redaction without first triggering an interrupt → debug bundle workflow.

Request body:

```typescript
{
  runId: string,
}
```

Response body: same shape as `GET /v1/runs/{runId}/debug-bundle` per `spec/v1/debug-bundle.md` — `DebugBundle` with `bundleVersion`, `host`, `run`, `events`, `redactionMode`, `redactionApplied`, `truncated`, `truncatedReason`.

When advertised, the host MUST serve a `200 OK` with the documented shape.

Conformance: gates on `capabilities.observability.testSeams.debugBundleExport: true`.

### 4. `POST /v1/host/sample/test/llm-cache-key` — LLM cache-key recipe (RFC 0041)

| Field | Value |
|---|---|
| Method + path | `POST /v1/host/sample/test/llm-cache-key` |
| Capability gate | `capabilities.multiAgent.executionModel.replayDeterminism.supported: true` (RFC 0041 Phase 4 hosts); MAY be implemented earlier without advertising |
| Env gate (reference impl) | implicit — seam registered alongside the cache-key implementation |
| Introduced | RFC 0041 §A |

Computes the canonical LLM cache key per `replay.md` §"LLM cache-key recipe" §A + §B. Conformance scenarios drive the seam to assert (a) intra-host reproducibility, (b) non-recipe-field invariance, and (c) cross-host parity when two hosts both expose the seam.

Request body — an `LLMCacheKeyInput`-shaped object per `replay.md` §A. **Non-recipe fields are accepted and ignored** (the test exercises that the host's recipe correctly drops them):

```typescript
{
  // Recipe fields (per replay.md §A — only these influence the key):
  provider: string,                                  // canonical provider id, lowercase ASCII
  model: string,                                     // provider-stamped model id
  messages: Array<{ role, content, name?, toolCallId? }>,
  tools?: Array<{ name, description?, parameters }>,
  temperature?: number,
  topP?: number,
  topK?: number,
  responseFormat?: { type: 'text' | 'json' | 'tool_call', schema? },

  // Non-recipe fields (host MUST ignore for key computation):
  max_tokens?: number,
  stop?: string[],
  stream?: boolean,
  seed?: number,
  metadata?: Record<string, unknown>,
  user?: string,
  'x-request-id'?: string,
  // ... any other field
}
```

Response body:

```typescript
{
  cacheKey: string,    // 64 lowercase-hex chars (SHA-256 of canonicalize(projectRecipe(input)))
}
```

Hosts MUST:
1. Drop non-recipe fields from the input before canonicalization (§A closed-set rule)
2. Canonicalize per `replay.md` §B (RFC 8785 JCS-style: sorted keys recursively, no whitespace, preserve array order, UTF-8 NFC strings)
3. Return SHA-256 over the canonical bytes as lowercase hex

A missing or malformed `provider`/`model`/`messages` field MUST return `400 invalid_argument`.

Conformance: `replay-llm-cache-key.test.ts`, `replay-llm-cache-key-portable.test.ts`.

### 5. Staged-refusal seam — `POST /v1/host/sample/test/mock-ai/program` mode `refusal` (RFC 0041 §B)

| Field | Value |
|---|---|
| Method + path | `POST /v1/host/sample/test/mock-ai/program` |
| Capability gate | `capabilities.multiAgent.executionModel.replayDeterminism.refusalDivergenceEmission: true` (RFC 0041 Phase 4) |
| Env gate (reference impl) | `OPENWOP_TEST_SEAM_ENABLED=true` |
| Introduced | RFC 0041 §B; reuses the existing mock-AI program seam introduced by RFC 0032 §C |

The `replay.divergedAtRefusal` behavioral assertion requires staging the mock-AI provider to return a valid envelope on the original run and a refusal on the replay (or vice-versa). Phase 4 hosts that advertise `refusalDivergenceEmission: true` MUST honor the following program shape on `POST /v1/host/sample/test/mock-ai/program`:

```typescript
{
  nodeId: string,
  program: [
    { mode: 'envelope', envelope: { /* valid LLM envelope */ } },     // original run gets this
    { mode: 'refusal', refusalReason: string },                        // replay gets this
  ],
}
```

The host's mock-AI provider MUST honor the program **deterministically by attempt index**: the first call (original run) returns the first entry; the second call (replay) returns the second entry. The seam is callable BEFORE the run is created — each conformance scenario uses a unique fixture (and therefore unique `nodeId`).

When the replay's mock-AI call hits the `refusal` entry, the host MUST:
1. Emit a `replay.divergedAtRefusal` event with payload per `schemas/run-event-payloads.schema.json` §`replayDivergedAtRefusal`
2. Fail the replay with HTTP `422` + `error.code: "replay_diverged_at_refusal"`

Conformance: `replay-divergence-at-refusal.test.ts` (advertisement-shape probe lives now; the 2 behavioral `it.todo` assertions light up when this seam is wired).

### 6. Multi-region idempotency simulator — `POST /v1/host/sample/test/multi-region/simulate-partition` (RFC 0036 §C)

| Field | Value |
|---|---|
| Method + path | `POST /v1/host/sample/test/multi-region/simulate-partition` |
| Capability gate | `capabilities.idempotency.multiRegion.supported: true` OR `capabilities.idempotency.crossRegion ∈ {best-effort, strict}` (RFC 0036) |
| Env gate (reference impl) | `OPENWOP_TEST_MULTI_REGION_SIMULATOR=true` |
| Introduced | RFC 0036 §C — closes the CF-12 / OPS-5 multi-region simulation gap named in `docs/KNOWN-LIMITS.md` |

The convergence rule in `spec/v1/idempotency.md` §"Multi-region idempotency annex" §"Convergence rule" is a pure-function MUST: given ≥2 conflicting `ConflictClaim` records sharing `(tenantId, endpoint, key)`, the resolver MUST return the lex-min `runId` as the winner deterministically without coordination. This seam exposes that algorithm directly so conformance can mechanically verify the property against synthetic partitions (no actual multi-region replication required).

Request:

```typescript
{
  claims: Array<{
    runId: string,       // engine-assigned id; lex-sort determines winner
    tenantId: string,    // claims with different tenantId MUST be rejected (400)
    endpoint: string,    // claims with different endpoint MUST be rejected (400)
    key: string,         // claims with different key MUST be rejected (400)
    region: string,      // identifies which region produced this claim
  }>  // length ≥ 2; length < 2 MUST be rejected (400)
}
```

Response (`200 OK`):

```typescript
{
  winner: ConflictClaim,                                     // lex-min runId
  losers: ConflictClaim[],                                    // N-1 entries
  cacheRedirects: Array<{                                     // N entries (one per region)
    region: string,
    cacheKey: string,                                         // `${endpoint}:${key}`
    redirectToRunId: string,                                  // winner.runId
  }>,
  loserCancelReason: 'cross_region_dedup_loss',               // canonical literal
}
```

Idempotency: the resolver is a pure function with no side effects. Same inputs → same outputs across calls. Hosts MAY cache results but the seam itself doesn't persist state.

Conformance: `multi-region-idempotency-behavior.test.ts` (6 assertions covering lex-min winner, multi-region cache redirects, canonical cancel reason, order-invariance, and 400-on-tuple-mismatch).

### 7. Cross-engine append-ordering harness — `POST /v1/host/sample/test/cross-engine/{append,read,reset}` (RFC 0036 §B)

| Field | Value |
|---|---|
| Method + path | 3 endpoints (see below) |
| Capability gate | `capabilities.eventLog.crossEngineOrdering.supported: true` (RFC 0036 §B) |
| Env gate (reference impl) | `OPENWOP_TEST_CROSS_ENGINE_HARNESS=true` |
| Introduced | RFC 0036 §B — closes the CF-8 cross-engine append-ordering gap named in `docs/KNOWN-LIMITS.md` |

The cross-engine ordering invariant in `spec/v1/channels-and-reducers.md` §"Cross-engine ordering" requires that two engine instances writing to the same shared channel converge to a single globally-ordered linearization on read. This seam exposes a synthetic two-engine harness so conformance can verify the property without standing up two real engine instances.

Endpoints:

```
POST /v1/host/sample/test/cross-engine/append
  Body: { engineId: string, channelId: string, value: unknown, lamport?: number }
  Returns: { engineId, value, lamport, seq } — the assigned timestamp + sequence

GET  /v1/host/sample/test/cross-engine/read?channelId=<id>
  Returns: { entries: AppendEntry[] } — linearized by (lamport, engineId, seq)

POST /v1/host/sample/test/cross-engine/reset
  Body: {}
  Returns: { ok: true } — clears the in-memory log
```

Lamport-clock semantics (the host's advertised `orderingModel: 'lamport'`):

- Each append advances the engine's clock to `max(local, incoming) + 1`
- The `lamport?` field on `append` is the engine's view of the OTHER engine's clock (incoming hint); honored per the lamport receive rule
- `read` linearizes by `(lamport ASC, engineId ASC, seq ASC)` — a deterministic total order
- Hosts advertising a different `orderingModel` (`vector-clock`, `global-sequencer`, or `x-host-<host>-<key>`) MAY substitute their own algorithm but MUST honor the same `append`/`read`/`reset` contract

Conformance: `cross-engine-append-behavior.test.ts` (4 assertions covering global linearization, lamport monotonicity, receive-rule advancement, and read-determinism).

### 8. Sandbox MVP — `POST /v1/host/sample/test/sandbox-{load,invoke}` (RFC 0035)

| Field | Value |
|---|---|
| Method + path | 2 endpoints (see below) |
| Capability gate | `capabilities.sandbox.supported: true` (RFC 0035 §A) |
| Env gate (reference impl) | `OPENWOP_TEST_SANDBOX_MVP=true` |
| Introduced | RFC 0035 §B — exercises the 8 sandbox failure-mode invariants against a synthetic misbehaving-pack registry |

The sandbox seam exists so conformance can drive the §B failure-mode invariants without a real pack runtime + real misbehaving pack tarballs. Each `sandbox-invoke` request names a synthetic typeId from the host's pre-populated misbehaving-pack registry; the host executes the matching code body inside its sandbox and returns either the result or a typed error envelope per `host-capabilities.md` §"Error codes".

Endpoints:

```
POST /v1/host/sample/test/sandbox-load
  Body: { packId: string }
  Returns: 200 { ok: true, packId } | 400 validation_error | 404 sandbox_pack_not_found

POST /v1/host/sample/test/sandbox-invoke
  Body: {
    typeId: string,                       // e.g. 'misbehave.fs-escape-read'
    args?: Record<string, unknown>,       // available as `args` inside the sandboxed code
    packId?: string,                      // identifies the pack containing typeId
    allowedHostCalls?: string[],          // capability-gate whitelist for this invocation
  }
  Returns: 200 { result: unknown } | 200 { error: SandboxError }
```

`SandboxError` shape (canonical per `host-capabilities.md` §"Error codes"):

```typescript
{
  code:
    | 'sandbox_escape_attempt'      // forbidden-syscall escape (fs/env/network/process)
    | 'sandbox_capability_denied'   // host call not in allowedHostCalls
    | 'sandbox_memory_exceeded'     // memoryLimitBytes overflow
    | 'sandbox_timeout'             // wallClockLimitMs overflow
    | 'sandbox_invocation_error',   // fallback for thrown errors not in the canonical catalog
  details: {
    escapeKind?:                     // SET when code === 'sandbox_escape_attempt'
      | 'host-fs-escape'
      | 'host-env-leak'
      | 'network-escape'
      | 'host-process-escape',
    requestedCapability?: string,    // REQUIRED when code === 'sandbox_capability_denied'
    requestedBytes?: number,         // MAY appear when code === 'sandbox_memory_exceeded'
    message: string,
  },
}
```

Synthetic misbehaving-pack typeIds the conformance suite exercises:

| typeId | Failure mode it probes |
|---|---|
| `misbehave.fs-escape-read` | sandbox_escape_attempt + escapeKind: host-fs-escape |
| `misbehave.fs-escape-write` | sandbox_escape_attempt + escapeKind: host-fs-escape |
| `misbehave.env-leak` | sandbox_escape_attempt + escapeKind: host-env-leak |
| `misbehave.network-escape` | sandbox_escape_attempt + escapeKind: network-escape |
| `misbehave.process-escape` | sandbox_escape_attempt + escapeKind: host-process-escape |
| `misbehave.timeout` | sandbox_timeout |
| `misbehave.memory-bomb` | sandbox_memory_exceeded |
| `misbehave.cross-pack-mutate` | (no failure; result.shared MUST equal 1 on every invocation — cross-pack mutation MUST NOT leak across fresh contexts) |
| `misbehave.capability-gate-violation` | sandbox_capability_denied + details.requestedCapability |
| `well-behaved.echo` | (no failure; `result.echoed === args.input`) |
| `well-behaved.host-fetch` | (no failure when `allowedHostCalls` includes `'fetch'`) |

Conformance: `sandbox-mvp-behavior.test.ts` (10 assertions covering 5 escape kinds + timeout + memory + cross-pack isolation + capability-gate + 2 well-behaved baselines).

### 9. Workspace cross-owner driver — `POST /v1/host/sample/workspace/op` (RFC 0059)

| Field | Value |
|---|---|
| Method + path | `POST /v1/host/sample/workspace/op` |
| Capability gate | `capabilities.workspace.supported: true` (RFC 0059 §A) |
| Env gate (reference impl) | none (the in-memory host enables it unconditionally; production hosts gate per the §"Production safety" rule below) |
| Introduced | RFC 0059 §E — drives `host.workspace` CRUD against an EXPLICIT `{tenant, workspace}` owner so the `workspace-cross-tenant-isolation` (WCT-1) invariant is exercisable on a single-credential host (mirrors the blob/kv/queue/table cross-tenant seams) |

The production §C endpoints (`/v1/host/workspace/files`) bind every request to one authenticated owner, so a single-credential host cannot demonstrate cross-owner isolation through them. This seam takes the `{tenant, workspace}` owner in the body — letting a conformance scenario write as owner A and attempt a read as owner B — and routes through the SAME owner-scoped store the §C endpoints use. The host MUST still scope strictly by the supplied owner triple (WCT-1); the seam only supplies the triple that production resolves from the authenticated identity.

```
POST /v1/host/sample/workspace/op
  Body: {
    tenant: string,            // owner tenant (RFC 0048)
    workspace: string,         // owner workspace
    op: 'list' | 'get' | 'put' | 'delete',
    path?: string,             // required for get/put/delete
    content?: string,          // required for put
    contentType?: string,      // optional for put
    ifMatch?: string,          // optional optimistic-concurrency token for put
    prefix?: string,           // optional filter for list
    version?: number,          // optional historical read for get
  }
  Returns: the same body/status as the matching §C endpoint
           (200 WorkspaceFile | 200 { files } | 204 | 404 not_found
            | 409 workspace_conflict | 413 workspace_too_large)
```

Conformance: `workspace-cross-tenant-isolation.test.ts` (WCT-1 — write as owner A, then assert a different workspace AND a different tenant both fail closed on `get`/`list`, while the owner still reads its own file).

## Production safety (normative)

All seams under `/v1/host/sample/*` are conformance-only. Hosts deployed in production:

- SHOULD return `404 Not Found` from every seam unless an env-gate explicitly enables it
- MUST NOT honor the seams under default deployment configuration
- MUST document which env-gates were set for the conformance run in the host's `conformance.md` evidence file

The host-extension namespace `/v1/host/sample/*` is per `host-extensions.md` §"Canonical prefixes" — it is host-private space and does not affect the v1 wire-shape stability contract.

## Canonical-endpoint conformance hooks

A handful of conformance assertions exercise wire-surface contracts that ride the canonical OpenWOP REST endpoints rather than a dedicated `/v1/host/sample/*` seam. These hooks need an operator-provided seed runId (or equivalent) communicated via an `OPENWOP_TEST_*` environment variable so the conformance driver can target a known refusal-eligible state without smuggling a host-private endpoint.

### 9. `POST /v1/runs/{runId}:fork mode:replay` against a past-retention runId (RFC 0039 §B MAE-3)

The MAE-3 contract is: a fork from a past event-log index MUST either serve memory-as-of that index OR refuse with `422 replay_memory_snapshot_unavailable` per `rest-endpoints.md` §"Common error codes" — silent substitution of current memory is non-conformant.

The conformance driver targets the canonical fork endpoint with `mode: "replay"`. The host's pre-flight order is normative for distinguishing this refusal from neighboring 422s:

1. `checkFromSeqBounds(fromSeq, maxSeq)` runs FIRST and returns `422 invalid_from_seq` for `fromSeq > maxSeq + 1`. An impossible-fromSeq driver hits this gate, NOT MAE-3.
2. `checkReplayMemorySnapshotPreflight(...)` runs AFTER bounds-check and returns `422 replay_memory_snapshot_unavailable` ONLY when the memory snapshot for an in-bounds fromSeq cannot be served — `details.reason` MUST be one of `{"retention_expired", "event_log_unavailable"}`.

Driving MAE-3 from outside therefore requires an actually-realized refusal-eligible state. Conventions:

| Hook | Env var | Realizes |
|---|---|---|
| Past-retention run | `OPENWOP_TEST_EXPIRED_REPLAY_RUN_ID` | A known runId whose event log has aged past the host's retention window; forking with `mode: "replay"` returns `details.reason: "retention_expired"`. Operator provides the runId via env (parallel naming to the existing `OPENWOP_TEST_EXPIRED_RUN_ID` used by `production-retention-expiry`). |
| Event-log-unavailable run | (host-side fault-injection seam) | Not deterministically reproducible from outside — requires a host-side fault-injection seam to mark a run's event log unavailable. Documented here for completeness; no env-var convention yet. |

Envelope shape (normative; covered behaviorally in `multi-agent-memory-lifecycle.test.ts`):

```json
{
  "error": "replay_memory_snapshot_unavailable",
  "details": {
    "fromSeq": 0,
    "sourceRunId": "<runId from the URL>",
    "reason": "retention_expired"
  }
}
```

`details.reason` MUST be one of `{"retention_expired", "event_log_unavailable"}`. The host MAY add additional optional fields under `details`; `fromSeq` MUST echo the requested fromSeq and `sourceRunId` MUST echo the runId from the URL.

Conformance: `multi-agent-memory-lifecycle.test.ts` (the MAE-3 behavioral assertion soft-skips when `OPENWOP_TEST_EXPIRED_REPLAY_RUN_ID` is unset OR the host does not advertise `multiAgent.executionModel.version >= 2` + `memory.supported: true`).

## Open seams (light up when fixtures ship)

- **Memory cross-run TTL roundtrip seam** (RFC 0039 MAE-2) — `POST /v1/host/sample/test/memory/cross-run-ttl-roundtrip`. Contract: drive a parent → child → parent memory write/read sequence with controlled wall-clock skew to assert child-write-time TTL anchoring. Behavioral assertion in `multi-agent-memory-lifecycle.test.ts` stays `it.todo` until a memory-advertising Phase 2 host wires the seam.
- **Credential resolution + redaction seam** (RFC 0046) — `POST /v1/host/sample/credentials/echo`. Gated on `capabilities.credentials.supported`. Contract: resolve a seeded credential whose plaintext is a known canary, run an echo node, and return the run's observable surfaces (events + inputs + variables + channels + snapshot + debug bundle). The behavioral assertion in `credential-payload-redaction.test.ts` asserts the canary is absent from every returned surface (SECURITY invariant `credential-payload-redaction`); soft-skips on `404` until a credentials-advertising host wires the seam.
- **OAuth connector-echo seam** (RFC 0047) — `POST /v1/host/sample/oauth/connector-echo`. Gated on `capabilities.oauth.supported`. Contract: a synthetic provider issues a token whose value is a known canary; a connector node runs; the run's observable surfaces (including the `connector.authorized` event) are returned. `oauth-connector-redaction.test.ts` asserts the token canary is absent from every surface and that `connector.authorized` carries the credential reference, not the token (reuses the `credential-payload-redaction` invariant); soft-skips on `404`.
- **Run-ownership seam** (RFC 0048) — `GET /v1/host/sample/identity/owned-run`. Contract: return a `RunSnapshot` that carries an `owner` triple. `cross-workspace-isolation.test.ts` asserts the owner echo carries a non-empty `tenant`; soft-skips on `404` (or when `owner` is omitted by a single-tenant host).
- **Cross-workspace isolation seam** (RFC 0048 §D) — `POST /v1/host/sample/identity/cross-workspace-read`. Contract: a `principal` scoped to workspace A attempts to read a run owned by workspace B. `cross-workspace-isolation.test.ts` asserts the read fails closed with `run_forbidden` / `not_found` (no existence leak); soft-skips on `404` until a workspace-ownership host wires the seam.
- **Authorization-decision seam** (RFC 0049 §C) — `POST /v1/host/sample/authorization/decide`. Gated on `capabilities.authorization.supported`. Contract: request a decision (`{ principal, action, resource }`) for a principal whose role is absent/unseeded; the host MUST return `{ allowed: false }` (fail-closed). `authorization-fail-closed.test.ts` asserts the deny (SECURITY invariant `authorization-fail-closed`); soft-skips on `404` until an authorization-advertising host wires the seam.
- **SAML assertion-validation seam** (RFC 0050) — `POST /v1/host/sample/auth/saml/validate`. Gated on `capabilities.auth.profiles[]` includes `openwop-auth-saml` + an operator-supplied synthetic IdP (`OPENWOP_TEST_SAML_IDP_URL`). Contract: present an assertion of a named `variant` (`valid`, `alg-none`, `bad-signature`, `unsigned`, `expired`, `not-yet-valid`, `signature-wrapping`); the host MUST accept `valid` and reject every negative with `unauthenticated`. `auth-saml-profile.test.ts` drives the negatives — the 1-positive + 6-negative assertions are minted by the bundled synthetic IdP harness (`conformance/src/lib/saml-idp.ts`), which also runs the negative reference suite server-free; the host-ACS path soft-skips on `404` / absent env.
- **SCIM provisioning seam** (RFC 0050) — `POST /v1/host/sample/auth/scim/provision`. Gated on `capabilities.auth.profiles[]` includes `openwop-auth-scim` + an operator-supplied SCIM endpoint (`OPENWOP_TEST_SCIM_URL`). Contract: drive a SCIM `create-user` / `assign-group` / `deactivate-user` `op`; the host MUST upsert an RFC 0048 principal / RFC 0049 role and deny a deactivated principal's subsequent decisions. `auth-scim-profile.test.ts` drives the roundtrip; soft-skips on `404` / absent env.
- **Approval-gate seam** (RFC 0051) — `POST /v1/host/sample/governance/approval-gate`. Gated on `capabilities.authorization.supported`. Contract: drive a named `scenario` (`unauthorized-grant`, `grant`, `reject`, `override`, `quorum`) against a `core.openwop.governance.approvalGate` node; the host returns `{ released, event }` reflecting the outcome (an unauthorized principal MUST NOT release; `override` MUST emit `approval.overridden` with a `reason` + an audit entry). `approval-gate-flow.test.ts` drives unauthorized + override-audited; soft-skips on `404` until a governance-advertising host wires the seam.
- **Scheduling tick seam** (RFC 0052) — `POST /v1/host/sample/scheduling/tick`. Gated on `capabilities.scheduling.supported` + `cron: true`. Contract: advance a deterministic clock for a named `scenario` (`single-tick`, `missed-window` with `missedTicks`) and return `{ runsFired }` — the count of runs a cron schedule produced. The host MUST report `runsFired === 1` for a single tick (once-per-tick) and `runsFired <= 1` for a missed window (no backlog flood). `scheduling-cron-fires-once.test.ts` drives both; soft-skips on `404` until a scheduling host wires the seam. (Delayed-execution horizon + calendar scenarios deferred.)
- **Heartbeat tick seam** (RFC 0060) — `POST /v1/host/sample/heartbeat/tick`. Gated on `capabilities.heartbeat.supported`. Contract: evaluate a heartbeat predicate once for a request `{ heartbeatId, observedState, simulateSlowMs? }` (`simulateSlowMs` asks the predicate to overrun `maxRuntimeMs`, exercising the §B.2 timeout path) and return `{ evaluated: HeartbeatEvaluated[], stateChanged: HeartbeatStateChanged[], enqueuedRuns: number }` — exactly one `evaluated` per tick (§B.1); `stateChanged` + `enqueuedRuns` non-empty/non-zero ONLY when `observedState` differs from the prior tick's persisted state (§B.5, the anti-spam guarantee); `evaluated[].status === "timeout"` when `simulateSlowMs` exceeds the budget (§B.2). `heartbeat-fires-once-per-tick.test.ts` / `heartbeat-idempotent-no-spam.test.ts` / `heartbeat-runtime-bound.test.ts` drive these; soft-skip on `404` until a heartbeat host wires the seam.
- **Tool-hooks invoke seam** (RFC 0064) — `POST /v1/host/sample/toolhooks/invoke`. Gated on `capabilities.toolHooks.supported`. Contract: evaluate the per-tool authorization + rate-limit gate for one call `{ principal, toolName, requiredScopes?, args?, simulateRateLimitExhausted? }` and return the `{ toolCalled, toolReturned }` payload pair the host would emit (the additive RFC 0064 fields on the existing `agent.toolCalled` / `agent.toolReturned` events). `toolReturned.status` MUST be `forbidden` when the principal lacks a `requiredScopes` entry (or authz is unevaluable — fail-closed, RFC 0049), `rate_limited` when `simulateRateLimitExhausted`, else `ok` with a non-negative `durationMs`; `toolCalled.argsHash` MUST be a secret-redacted (SR-1) JCS+SHA-256 hash carrying no raw secret material. `tool-hooks-content-free.test.ts` / `tool-hooks-authorization-fail-closed.test.ts` / `tool-hooks-rate-limit.test.ts` / `tool-hooks-secret-redaction.test.ts` drive these; soft-skip on `404` until a tool-hooks host wires the seam.
- **Sub-run attestation seam** (RFC 0063) — `POST /v1/host/sample/subrun/attest`. Gated on `capabilities.agents.subRunAttestation`. Contract: drive one sub-workflow harvest-then-merge for a request `{ childOutputs, outputAttestation: { checksum?, algorithm?, requireApproval?, principalScope? }, approvalAction? }` and return `{ attestation, harvestedEvent, merged, mergedValues? }` — the `attestation { checksum, algorithm }` the host would surface on `core.workflowChain.event { phase: 'output.harvested' }`, whether the merge proceeded, and the merged values. The `checksum` MUST be the RFC 8785 JCS + SHA-256 digest of `childOutputs` (byte-stable for identical inputs, host-independent). When `requireApproval: true`, `merged` MUST be `true` only for `approvalAction` `accept`/`edit-accept` and MUST be `false` (fail-closed) for `reject` or an absent/expired approval. `subrun-checksum-stable.test.ts` / `subrun-approval-gate.test.ts` / `subrun-approval-fail-closed.test.ts` drive these; soft-skip on `404` until a sub-run-attestation host wires the seam.
- **Memory-distillation seam** (RFC 0062) — `POST /v1/host/sample/memory/distill`. Gated on `capabilities.memory.distillation.supported`. Contract: run one budgeted distillation for a request `{ memoryRef, tokenBudget?, sources?, indexEmitted?, includeSecretCanary? }` and return `{ event, archiveChecksum, indexUpdated, indexFile? }` — the `memory.compacted` event the host would emit (carrying the additive `distillation { tokenBudget, tokensUsed, indexUpdated }` sub-object) plus the stable archive's checksum. `event.distillation.tokensUsed` MUST be ≤ the resolved `tokenBudget`; an un-meetable budget MUST return `token_budget_exceeded` with no partial archive (atomic). The same `sources` + `tokenBudget` MUST yield an identical `archiveChecksum` (byte-stable). When `indexEmitted`, a `MEMORY-INDEX.json` workspace file MUST be retrievable and a `workspace.updated` event fired. When `includeSecretCanary`, a redacted secret in the sources MUST stay redacted in the archive (SR-1). `distillation-token-budget.test.ts` / `distillation-stable-archive.test.ts` / `distillation-index-roundtrip.test.ts` / `distillation-secret-carryforward.test.ts` drive these; soft-skip on `404` until a distillation host wires the seam.
- **Dead-letter exhaustion seam** (RFC 0053) — `POST /v1/host/sample/deadletter/exhaust`. Gated on `capabilities.deadLetter.supported`. Contract: drive a node that deterministically exhausts a short retry policy for a named `scenario` (`exhaust-retries`, `fork-after-dead-letter`); the host returns `{ event, forkEligible }` — the `run.dead_lettered` event (carrying `attempts`) and whether the dead-lettered run is forkable. `deadletter-retry-exhaustion.test.ts` drives both; soft-skips on `404` until a dead-letter host wires the seam. (Retention-purge scenario deferred — needs a clock seam.)
- **Agent-loop seam** (RFC 0061) — `POST /v1/host/sample/agentloop/run`. Gated on `capabilities.multiAgent.executionModel.version >= 5`. Contract: drive a bounded stateful loop for a request `{ turns, workspaceWriteAtTurn?, suspendAtTurn?, resume? }` and return `{ decisions, workspaceVisible?, resumedIteration? }` — the ordered `runOrchestrator.decided` payloads the host would emit (each carrying the `iteration` counter). `decisions[k].iteration` MUST equal `k+1` (1-based, monotonic, one per turn). When `workspaceWriteAtTurn: i` is set (requires `host.workspace.supported`), `workspaceVisible` MUST report the write invisible to turn *i*'s snapshot and visible to turn *i+1* (§C input 2). When `suspendAtTurn` + `resume` are set (requires `statefulResume: true`), `resumedIteration` MUST equal the suspend iteration — the counter does not reset or skip (§D). `agent-loop-iteration-monotonic.test.ts` / `agent-loop-workspace-snapshot.test.ts` / `agent-loop-stateful-resume.test.ts` drive these; soft-skip on `404` until a version-5 host wires the seam.

## Open spec gaps

- Capability flag for the prompt resolver seam is implicit (always-on when `prompts.supported: true`). A future minor revision MAY add `capabilities.prompts.testSeams.promptResolve` if hosts want to advertise the seam without committing to the full RFC 0029 behavior.
- The staged-refusal seam shape extends the existing RFC 0032 mock-AI program shape with a new `mode: "refusal"` entry. A future revision MAY split this out as a dedicated `capabilities.multiAgent.executionModel.testSeams` block.

## Cross-references

- `host-extensions.md` §"Canonical prefixes" — the `/v1/host/sample/*` namespace contract
- `capabilities.md` §"Truthful advertisement" — the host's commitment when it advertises any of the above flags
- `host-capabilities.md` §"`capabilities.observability.testSeams`" — the OTel scrape + debug-bundle export capability sub-block
- `observability.md` §"OTel collector test seam (RFC 0034)" — the canonical RFC 0034 §B normative text the OTel + debug-bundle seams implement
- `replay.md` §"LLM cache-key recipe" — the canonical recipe the §4 LLM cache-key seam computes
- `prompts.md` §"Resolution chain (normative)" — the canonical RFC 0029 resolver semantics the §1 seam exposes
