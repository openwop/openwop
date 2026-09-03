# OpenWOP Spec v1 — Per-Run Options Overlay

> **Status: Stable · v1.1 (2026-04-27).** Comprehensive coverage of `RunOptions` schema covering `configurable`, `tags`, `metadata`, and `recursionLimit` overrides. Stable surface for external review. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

A workflow definition (DAG of nodes + edges) is the _shape_ of the work. Operationally, two runs of the same workflow often need different _parameters_: a different LLM model, a different temperature, a different prompt variant for A/B testing, a tighter recursion cap for safety, or a tenant-scoped tag for filtering observability. Today, the only way to vary parameters is to fork the workflow definition itself — which inflates the workflow catalog with duplicates that differ only in a single config field.

openwop defines a **per-run options overlay** that decouples parameter overrides from workflow versioning. `WorkflowDefinition` describes shape; `RunOptions.configurable` overlays parameters at run start without changing shape.

This is distinct from versioning (see `version-negotiation.md`):

- **Workflow versioning** (`ctx.getVersion`) — branches the _code path_ an in-flight run follows. Required when behavior diverges.
- **Configurable overlay** — overrides _opaque parameters_ the existing code path consumes. Sufficient when only values differ.

The `configurable` mechanism parallels [LangChain's `RunnableConfig.configurable`](https://python.langchain.com/docs/concepts/runnables/#configurable-runnables) idiom — chosen for ecosystem familiarity.

---

## `RunOptions` schema

An OpenWOP-compliant server MUST accept a `RunOptions` object on `POST /v1/runs` (top-level, alongside `workflowId` and `inputs`):

```typescript
interface RunOptions {
  /** Per-run parameter overlay. Opaque to the engine; surfaced to NodeModules
   *  via `ctx.config.configurable`. */
  configurable?: Record<string, unknown>;

  /** Free-form tags for observability filtering. Commonly used for tenant
   *  isolation in dashboards (e.g., `tenant:acme`), feature-flag attribution
   *  (e.g., `experiment:new-prompt`), and cost categorization. */
  tags?: string[];

  /** Free-form metadata for observability (logs, traces, metrics). Distinct
   *  from `inputs` which feed nodes; metadata never affects execution. */
  metadata?: Record<string, unknown>;
}
```

All three fields are OPTIONAL. A `POST /v1/runs` body without `RunOptions` MUST be accepted as if `RunOptions` were `{}`.

---

## `configurable`

The `configurable` field is opaque to the engine. NodeModules MAY consume keys via `ctx.config.configurable`. The server MUST surface every key/value the caller supplied without modification.

### Validation

An OpenWOP-compliant server SHOULD validate `configurable` against the schema declared in `Capabilities.configurable` when the host advertises that optional v1 capability. If a key is unknown or a value is out of declared bounds, the server SHOULD reject the request with HTTP `400 Bad Request`:

<!-- normative-example: error-envelope.schema.json -->
```json
{
  "error": "validation_error",
  "message": "configurable.temperature must be between 0 and 2 (got 3.5)",
  "details": { "key": "temperature", "value": 3.5, "min": 0, "max": 2 }
}
```

If the server doesn't yet declare `Capabilities.configurable`, it MAY accept any key/value (forward-compatibility for early adopters) but SHOULD log a warning when unknown keys are submitted.

### Per-workflow `configurableSchema`

Workflow definitions MAY carry a `configurableSchema` field declaring which `configurable` keys the workflow accepts at run start. The field is a JSON Schema 2020-12 object that constrains the shape of `RunOptions.configurable` on `POST /v1/runs`:

```yaml
# WorkflowDefinition (excerpt)
id: campaign-orchestration
version: 3
configurableSchema:
  type: object
  properties:
    temperature: { type: number, minimum: 0, maximum: 1 }
    model: { type: string, enum: [claude-sonnet-4-6, claude-haiku-4-5] }
    promptOverrides:
      type: object
      additionalProperties: { type: string }
  required: []
  additionalProperties: false
```

When `configurableSchema` is present, hosts:

1. MUST validate `RunOptions.configurable` against this schema at `POST /v1/runs` time and reject with `validation_error` on failure.
2. MUST surface `configurableSchema` on `GET /v1/workflows/{workflowId}` so clients can pre-flight-validate before submitting a run.
3. MUST validate `configurableSchema` against host-level `Capabilities.configurable` at workflow registration time — a workflow cannot accept a key the host doesn't recognize.

When `configurableSchema` is absent, fall back to host-level `Capabilities.configurable` validation (§"Validation" above).

This is **additive**: workflows authored before this field landed omit `configurableSchema` and continue to validate against host-level rules only.

### Reserved keys

The following keys are RESERVED. Servers MUST handle them per the spec and MUST NOT permit NodeModules to redefine them:

| Key                        | Type                                                                              | Semantics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recursionLimit`           | `number`                                                                          | Override the per-run node-execution ceiling. Clamped to the server's `Capabilities.limits.maxNodeExecutions`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `model`                    | `string`                                                                          | Override the AI model for nodes that consume `ctx.config.configurable.model`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `temperature`              | `number`                                                                          | Override AI temperature. Range 0-2 (server SHOULD enforce).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `maxTokens`                | `number`                                                                          | Override AI max-tokens cap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `promptOverrides`          | `Record<string, string>`                                                          | Per-prompt-ID variant override. Map of canonical prompt ID → override text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `mockProvider`             | `{ id: string, config?: object }`                                                 | Route AI activity calls through a deterministic mock provider instead of real LLM APIs. Test-keys-only (servers MUST refuse on production keys with `403 mock_provider_forbidden`). See "Mock provider extension" §below — closes F1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ai.provider`              | `string`                                                                          | Override the AI provider for the run. MUST be in `Capabilities.aiProviders.supported`. Servers reject unknown providers with `validation_error`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ai.model`                 | `string`                                                                          | Override the AI model for the run. Distinct from the unprefixed `model` key — `ai.model` is BYOK-aware (resolves against the chosen provider's catalog); `model` is the legacy unscoped override. New code SHOULD prefer `ai.model`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ai.credentialRef`         | `string`                                                                          | Opaque host-issued reference to a stored credential (e.g., `secret_a3b9c2`). MUST reference a credential of a provider in `Capabilities.aiProviders.byok`; servers reject mismatched-provider refs with `credential_forbidden`. NEVER carries raw key material — the host's `SecretResolver` dereferences the ref internally. Required when a node's `requiresSecrets[]` declares an `ai-provider` kind on a BYOK provider; absent for platform-managed-key runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `escalationThreshold`      | `number` (0–1)                                                                    | Multi-Agent Shift Phase 1. Per-run override of the confidence-escalation threshold used by the `low-confidence` suspend contract. When an `agent.decided.confidence` value is below this threshold, the host MUST suspend via `node.suspended { reason: 'low-confidence' }` per `interrupt.md`. Default `0.7` per the Phase-1 disposition (industry-typical floor for LLM judgement). Servers MAY refuse values outside `[0, 1]` with `validation_error`. Hosts that don't advertise `capabilities.agents.supported: true` ignore the key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `reasoningVerbosity`       | `"summary" \| "full" \| "off"`                                                    | Multi-Agent Shift Phase 1. Per-run override of the `agent.reasoned` event verbosity (see `capabilities.md` §`agents.reasoning`). `"summary"` (default) bounds traces to the host's `agents.reasoning.tokenLimit`; `"full"` emits complete model traces (useful for debug-bundle inspection); `"off"` suppresses `agent.reasoned` events entirely. Hosts that don't advertise `capabilities.agents.supported: true` ignore the key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `runTimeoutMs`             | `number`                                                                          | RFC 0058. Wall-clock deadline for the whole run (milliseconds, measured from `run.started`). Resolved as `min(runTimeoutMs, Capabilities.limits.maxRunDurationMs)`; out-of-range values return `400 validation_error` at run-create, never at runtime. On breach the server MUST emit `cap.breached { kind: 'run-duration', limit: <resolvedMs>, observed: <elapsedMs> }`, transition the run to `failed` with `error.code = 'run_timeout'`, and stop scheduling. Absent ⇒ only the host ceiling (if advertised) applies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `maxLoopIterations`        | `number`                                                                          | RFC 0058. Ceiling on agent-loop iterations — one increment per orchestrator turn per `multi-agent-execution.md` §"Execution loop"; distinct from `recursionLimit` (node executions). Resolved as `min(maxLoopIterations, Capabilities.limits.maxLoopIterations)`. On breach the server MUST emit `cap.breached { kind: 'loop-iterations', limit: <resolvedMax>, observed: <iterationCount> }`, transition to `failed` with `error.code = 'loop_limit_exceeded'`, and stop scheduling. Hosts that don't advertise `capabilities.multiAgent.executionModel.supported` (the execution loop, RFC 0037) ignore the key — there are no orchestrator turns to count. The bound is enforceable on any host with the RFC 0037 loop; RFC 0061 (`version: 5`) formalizes the observable per-turn `iteration` counter this bounds. (`runTimeoutMs` above is independent of the execution model and enforceable on any host.) **Scope (clarification):** `maxLoopIterations` counts **outer orchestrator turns** only — one increment per `runOrchestrator.decided`. It does **not** bound the **inner function-calling loop within a single node/agent execution** (the model↔tool request rounds of an agent dispatched per RFC 0072 §B); those rounds happen entirely inside one orchestrator turn and are governed by the host's own per-execution cap (an internal default, not a wire key), exactly as a child sub-orchestrator's iterations do not count against a parent's bound (RFC 0058 §"Unresolved questions" #2). A host MUST NOT conflate the two — doing so would let a tool-heavy single turn spuriously trip `loop_limit_exceeded`. |
| `distillation.tokenBudget` | `number`                                                                          | RFC 0062. Per-run token budget for a memory-distillation ("dream") run — caps input+output token accounting against the host's advertised `capabilities.memory.distillation.tokenizerName` (best-effort-honest, ±10%). Resolved as `min(distillation.tokenBudget, capabilities.memory.distillation.maxTokenBudget)`; absent ⇒ the host defaults to `maxTokenBudget`. A source set that cannot be distilled within the budget fails the run with `token_budget_exceeded` and writes no partial archive (atomic). Hosts that don't advertise `capabilities.memory.distillation.supported` ignore the key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `budget`                   | `object` ([`budget-policy.schema.json`](../../schemas/budget-policy.schema.json)) | RFC 0084. Enforceable per-run SPEND policy — `maxTokens` / `maxCostUsd` / `maxToolCalls` / `maxRetries` / `modelAllow[]` / `modelDeny[]` / `thresholdPercent` / `onExhaustion`. Every dimension optional; absent ⇒ unbounded (host default). Resolved as `min` across run/workflow/agent/project scopes, clamped to `Capabilities.limits.maxBudget*` ceilings (the RFC 0058 §A pattern), and recorded at `budget.reserved` (a replay re-reads it, never re-resolves). Consumption is derived from the existing `provider.usage` / `agent.toolCalled` / retry events (no double-counting). On exhaustion of a hard dimension the host emits `cap.breached { kind: 'budget-tokens'\|'budget-cost'\|'budget-tool-calls'\|'budget-retries' }` → `run.failed { error: 'budget_exhausted' }` (or, with `onExhaustion: 'interrupt'`, an RFC 0051 approval interrupt). **Wall-time / loop-iterations are NOT here** — those are RFC 0058's `runTimeoutMs` / `maxLoopIterations`; `budget` governs spend, 0058 governs execution bounds (the orthogonality seam). Hosts that don't advertise `capabilities.budget.supported` ignore the key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

NodeModules consuming these keys MUST NOT crash if they're absent — the `configurable` field is OPTIONAL.

Vendor extensions MUST use a vendor-prefixed namespace (e.g., `acme.feature_x`) to avoid collisions with future spec-reserved keys.

The `ai.*` namespace is RESERVED for spec-defined BYOK + provider-routing keys; vendor extensions to AI routing MUST use a vendor prefix instead.

### Example

```json
POST /v1/runs
{
  "workflowId": "campaign-orchestration",
  "inputs": { "briefId": "brief_42" },
  "configurable": {
    "model": "claude-sonnet-4-6",
    "temperature": 0.3,
    "recursionLimit": 50,
    "promptOverrides": {
      "campaign-strategy.system": "Use a more formal tone."
    }
  },
  "tags": ["tenant:acme", "experiment:formal-voice"],
  "metadata": {
    "submittedBy": "ci-pipeline",
    "buildId": "abc123"
  }
}
```

---

## Mock provider extension (closes F1)

For conformance testing + development workflows that exercise AI nodes without consuming real-API budget, the spec defines a `configurable.mockProvider` extension. When set, the engine routes ALL AI activity calls through the named mock provider instead of dispatching to a real LLM. The mock returns deterministic chunks per its config — fully replay-deterministic by construction.

### Wire shape

```jsonc
{
  "configurable": {
    "mockProvider": {
      "id": "stream-text",
      "config": {
        "tokens": ["Hello", " ", "world"],
        "delayMsPerToken": 50,
        "finishReason": "stop",
        "usage": { "promptTokens": 12, "completionTokens": 3, "totalTokens": 15 }
      }
    }
  }
}
```

`id` selects a mock provider from the server's catalog (advertised via `Capabilities.testing.mockProviders`). `config` is the per-provider parameter shape; each provider documents its own keys.

### Authorization

Mock providers MUST be guarded — anyone with API access could otherwise skip real billing by always opting in.

- An OpenWOP-compliant server MUST refuse `configurable.mockProvider` from production API keys with `403 mock_provider_forbidden`.
- Test API keys (advertised via `Capabilities.testing.testKeyPrefix` — typically `hk_test_`) pass.
- Servers MAY additionally gate on per-tenant policy or feature flags.

<!-- normative-example: error-envelope.schema.json -->
```json
{
  "error": "mock_provider_forbidden",
  "message": "Mock providers are not enabled for this API key. Use a test key (prefix 'hk_test_').",
  "details": {
    "requestedProvider": "stream-text",
    "supportedProviders": ["stream-text", "tool-calls", "error", "usage-only"]
  }
}
```

### Canonical mock provider catalog

An OpenWOP-compliant server claiming v1.0 conformance MUST recognize the `stream-text` provider (the spec-canonical baseline that unblocks `messages`-mode testing). Other providers below are RECOMMENDED but not required for conformance.

#### `stream-text` (REQUIRED)

Emits `output.chunk` events one at a time with the configured cadence, then completes the AI activity with a normal terminal chunk (`isLast: true`).

| Config field      | Type       | Default                 | Notes                                                                                                                                                                 |
| ----------------- | ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens`          | `string[]` | `["mock", " response"]` | Sequence of strings emitted as individual `output.chunk` events. Each becomes one chunk's `chunk` field.                                                              |
| `delayMsPerToken` | `integer`  | `0`                     | Wall-clock delay between successive chunks. Range 0..5000. Useful for testing client-side incremental rendering.                                                      |
| `finishReason`    | `string`   | `"stop"`                | Set on the final chunk's `meta.finishReason`. Must be one of the canonical values (`stop`/`length`/`tool_calls`/`content_filter`).                                    |
| `usage`           | `object`   | (computed)              | Token-billing metadata for the final chunk's `meta.usage`. When omitted, the server computes `completionTokens = tokens.length` and `promptTokens = 1` (placeholder). |
| `model`           | `string`   | `"mock-stream-text-v1"` | Set on every chunk's `meta.model`.                                                                                                                                    |

#### `tool-calls` (RECOMMENDED)

Emits a sequence of structured tool-call chunks. Useful for testing function-calling pipelines without a real LLM.

| Config field      | Type      | Notes                                                                                     |
| ----------------- | --------- | ----------------------------------------------------------------------------------------- |
| `toolCalls`       | `array`   | Each item is `{id, name, arguments}` per the S2 `meta.toolCalls` shape. Emitted in order. |
| `delayMsPerToken` | `integer` | Same as `stream-text`.                                                                    |

#### `error` (RECOMMENDED)

Fails the AI activity immediately with a configured error. Useful for testing failure paths in retry logic + idempotency.

| Config field  | Type      | Notes                                                                                               |
| ------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `code`        | `string`  | Sets `RunSnapshot.error.code`.                                                                      |
| `message`     | `string`  | Sets `RunSnapshot.error.message`.                                                                   |
| `retryable`   | `boolean` | When `true`, the engine treats this as a transient failure and retries per the node's retry budget. |
| `failAfterMs` | `integer` | Optional delay before failing — exercises mid-call cancellation.                                    |

#### `usage-only` (RECOMMENDED)

Returns no content but reports `meta.usage`. Useful for testing cost-attribution rollup (O4 attributes) without consuming tokens.

| Config field | Type     | Notes                                                                                                 |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `usage`      | `object` | `{promptTokens, completionTokens, totalTokens}`. Reported in the single emitted chunk's `meta.usage`. |

### Replay determinism

Mock providers are inherently replay-safe: their entire behavior is determined by `configurable.mockProvider.config`, which is persisted on the run doc and re-applied at replay time. Replays through real LLMs need the Layer-2 invocation log (`idempotency.md` §Layer 2) to maintain determinism; mock providers do not — they're a closed-form deterministic function of their config.

This makes mock providers especially suitable for `:fork` testing: a forked run with `mode: replay` and a mock provider produces byte-identical event logs to the source run, every time.

### Capabilities advertisement

Servers advertise mock-provider support via `Capabilities.testing`:

```jsonc
{
  "testing": {
    "mockProviders": ["stream-text", "tool-calls", "error", "usage-only"],
    "testKeyPrefix": "hk_test_"
  }
}
```

Consumers requesting a mock-provider that's not in the server's `mockProviders` array get `400 unsupported_mock_provider`.

### What this is NOT

- The mock-provider extension is NOT for production traffic. Routing real user requests through mocks is a billing-bypass vulnerability; the test-key gating prevents this at the auth layer.
- It is NOT a replacement for unit tests of NodeModule code. NodeModule unit tests run in-process with stubs; mock providers exercise the engine + activity + event-log path end-to-end.
- It does NOT define a way to mock non-AI activities (HTTP webhook, Stripe payment, etc.). Those are handled by per-activity test-mode patterns (e.g., Stripe's `tok_visa` test cards) that are inherently provider-specific. Future spec work MAY extend the mock-provider catalog to cover them.

---

## `tags`

An OpenWOP-compliant server MUST treat `tags` as an opaque string array attached to the run for observability purposes. Servers MUST:

1. Persist tags on the run document.
2. Include tags in OTel span attributes as `openwop.run.tag.<index>` or as a single `openwop.run.tags` array attribute (implementation choice).
3. Surface tags in dashboard / admin-panel run listings for filtering.

Servers MAY index tags for query (e.g., `GET /v1/runs?tag=tenant:acme`); this is RECOMMENDED for production deployments but not REQUIRED for spec compliance.

### Tag format conventions

openwop doesn't prescribe tag syntax. The following CONVENTIONS are widely used:

- `tenant:<id>` — tenant/workspace scoping
- `experiment:<name>` — feature-flag or A/B variant attribution
- `cost-center:<id>` — billing categorization
- `caller:<system>` — origin system (e.g., `caller:ci`, `caller:cli`, `caller:web`)
- `env:<environment>` — `env:prod`, `env:staging`

Servers MUST NOT reject tags based on format (other than non-string entries or excessive length).

### Limits

An OpenWOP-compliant server SHOULD enforce these limits on tags:

- Maximum tag count per run: `100`
- Maximum tag length: `256` characters
- Tags MUST be valid UTF-8

Exceeding limits MUST produce `400 validation_error`.

---

## `metadata`

Free-form key/value object attached to the run. Engine MUST NOT consume metadata for any execution decision. Used for:

- Tracing correlation IDs from the caller's system
- Audit trail context (who/why/when)
- Cost tracking metadata
- Custom observability fields beyond what `tags` express

Servers MUST persist metadata and MAY include it in OTel span attributes as `openwop.run.metadata.<key>`.

### Limits

An OpenWOP-compliant server SHOULD enforce:

- Maximum metadata depth: `4` levels of nesting
- Maximum total serialized size: `8192` bytes
- All values MUST be JSON-serializable (no functions, no `undefined`, no circular references)

---

## NodeModule access

NodeModules access run options via `ctx.config`:

```typescript
async function* myNode(ctx: NodeContext): AsyncIterable<NodeEvent> {
  const model = ctx.config.configurable?.model ?? 'claude-haiku-4-5';
  const temperature = ctx.config.configurable?.temperature ?? 0.7;

  yield {
    kind: 'output',
    output: { /* ... */ },
  };
}
```

`tags` and `metadata` are NOT exposed to NodeModules — they're observability-only. Exposing them would invite executors to branch on tag values, defeating the "tags don't affect execution" invariant.

---

## Persistence

An OpenWOP-compliant server MUST persist `RunOptions` on the run document at creation time. Resume / replay paths MUST surface the original options to NodeModules via `ctx.config` — NodeModules SHOULD see the same `configurable` values across all attempts of a node execution.

A server MAY allow caller modification of `tags` and `metadata` after creation via a host extension or future `PATCH /v1/runs/{runId}` endpoint. It MUST NOT allow modification of `configurable` after run creation — that breaks replay determinism.

---

## Open spec gaps

> **Absorbed into `spec/v1/gaps.json` (RFC 0174 §E.3, 2026-09-03).** The 4 row(s) this table carried are now `openwop.gap.spec.run-options.<local>` entries with a disposition and a witness class, one namespace with every RFC register (RFC 0166 §B). The table is retired; do not add rows here.

## References

- `auth.md` — auth model + status legend
- `rest-endpoints.md` — `POST /v1/runs` endpoint
- `capabilities.md` — `Capabilities.configurable` schema declaration
- `version-negotiation.md` — distinct from workflow versioning (`ctx.getVersion`)
- `observability.md` — `openwop.run.tag.*` + `openwop.run.metadata.*` span attributes
- LangChain idiom: <https://python.langchain.com/docs/concepts/runnables/#configurable-runnables>
