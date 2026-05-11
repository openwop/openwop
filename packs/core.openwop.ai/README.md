# `core.openwop.ai`

Spec-canonical AI-call pack. Three foundational nodes that route through the host's BYOK aiProviders surface.

| Pack name | `core.openwop.ai` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | JavaScript (ESM), Node `>=20` |
| External deps | None — pack makes NO HTTP calls |
| peerDependencies | `aiProviders: supported` |
| License | Apache-2.0 |

## Why no HTTP / no SDK deps?

OpenWOP's `Capabilities.aiProviders` lets hosts advertise which AI providers they route to (Anthropic, OpenAI, Gemini, etc.) and which support BYOK. The PACK doesn't need to know about provider URLs, auth, retry, or rate limits — it asks the host (via `ctx.callAI(...)`) and gets back a normalized result. The host owns:

- Provider URL + version routing
- Secret resolution (BYOK)
- Rate-limit handling
- Provider-specific quirks (system-prompt placement, stop-sequence limits, tool-calling formats)
- Cost attribution + audit logging

That keeps the pack lightweight + provider-portable. The same pack runs against Anthropic on host A and Gemini on host B.

## Nodes

| typeId | role | capabilities |
|---|---|---|
| `core.openwop.ai.chat-completion` | `side-effect` | `cacheable`, `side-effectful` |
| `core.openwop.ai.structured-output` | `side-effect` | `cacheable`, `side-effectful` |
| `core.openwop.ai.embeddings` | `side-effect` | `cacheable`, `side-effectful` |

All three declare `side-effectful` — LLM calls cost money + are non-deterministic. The engine's Layer-2 invocation log caches the terminal `node.completed` payload keyed on `(runId, nodeId, request-hash)`. **Replays return the cached payload without re-calling the provider** — guaranteeing cost-once + replay-determinism (per `spec/v1/replay.md` §"Replay determinism").

### `chat-completion`

Free-form LLM chat. Returns text + token usage + a normalized finish reason.

```json
{
  "config": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "systemPrompt": "You are a concise assistant.",
    "temperature": 0.7,
    "maxTokens": 500
  },
  "inputs": {
    "messages": [{ "role": "user", "content": "Summarize: ..." }]
  }
}
// outputs: { content, usage: { inputTokens, outputTokens }, finishReason }
```

### `structured-output`

LLM call constrained to produce JSON matching a caller-supplied schema. The host's structured-output mechanism translates this to the provider-specific format (Anthropic tool-use, OpenAI JSON mode, Gemini response_schema). The runtime does a shallow structural check post-hoc and retries up to `retryOnInvalidJson` times if the model returns invalid JSON.

```json
{
  "config": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "outputSchema": {
      "type": "object",
      "required": ["sentiment", "confidence"],
      "properties": {
        "sentiment": { "type": "string", "enum": ["positive", "negative", "neutral"] },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    }
  },
  "inputs": { "messages": [{ "role": "user", "content": "Classify: 'I love this'" }] }
}
// outputs: { data: { sentiment: 'positive', confidence: 0.95 }, usage, retries: 0 }
```

Throws `structured_output_invalid` after retries exhausted.

### `embeddings`

Generates a vector embedding for the input text. Single-text input — for batch embedding, dispatch the node in parallel via `core.control.parallel`.

```json
{
  "config": { "provider": "openai", "model": "text-embedding-3-small", "dimensions": 512 },
  "inputs": { "text": "OpenWOP is a wire-level protocol for multi-agent workflow orchestration." }
}
// outputs: { vector: [...512 floats...], dimensions: 512, model: "text-embedding-3-small" }
```

## Host contract

The pack reads `ctx.callAI` from the node context. The OpenWOP spec doesn't yet normatively declare `ctx.callAI` (deferred to a future Track 13 spec-surface addition), but hosts advertising `Capabilities.aiProviders.supported` MUST expose an equivalent primitive:

```typescript
ctx.callAI({
  provider: string,
  model: string,
  messages: Array<{ role, content }>,
  temperature?, maxTokens?, stopSequences?, systemPrompt?,
  responseSchema?: object,   // for structured-output
  embeddingMode?: true,      // for embeddings
  dimensions?: number,       // for embeddings
}) → Promise<{
  content?: string,
  data?: object,
  embedding?: number[],
  usage: { inputTokens, outputTokens, totalTokens? },
  finishReason?: string,
  model?: string,
}>
```

Hosts that don't expose this throw `host_capability_missing` at runtime. (Workflow-register-time refusal via `peerDependencies` is the correct path; runtime check is defense-in-depth.)

## See also

- [`spec/v1/capabilities.md`](../../spec/v1/capabilities.md) §aiProviders
- [`spec/v1/replay.md`](../../spec/v1/replay.md) §"Replay determinism" — why side-effectful nodes are replay-safe
- [`spec/v1/node-packs.md`](../../spec/v1/node-packs.md) §peerDependencies
- [`docs/PACKS-MVP-PLAN.md`](../../docs/PACKS-MVP-PLAN.md) — Phase 1 catalog
- `docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md` (lives in the myndhyve repo) — full migration plan
