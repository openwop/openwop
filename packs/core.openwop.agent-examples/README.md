# `core.openwop.agent-examples`

Reference / smoke-fixture agent pack. Exercises every shape on `agent-manifest.schema.json` so the conformance suite, registry verifier, and reference hosts have a canonical pack to validate against. Validates the `agents[]` extension to `pack.json` (per `agent-manifest.schema.json` + RFC 0003 §`agents[]` extension).

| Pack name | `core.openwop.agent-examples` |
| Version | `1.1.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: remote` (no executable artifact — agents are host-interpreted) |
| Nodes | 0 — pure agent pack |
| Agents | 5 |
| External deps | None |
| License | Apache-2.0 |

## Why "pure agent pack"?

Node packs ship executable runtime artifacts (JS, Python, Go, WASM). Agent packs ship **agent manifests** — descriptors that hosts read to instantiate agents (system prompt + tool allowlist + memory shape + confidence calibration + handoff schemas). The agent itself runs inside whatever LLM the host's BYOK `aiProviders` surface resolves; the pack contributes the configuration, not the runtime.

A pure agent pack has `nodes: []` or omits the field entirely. The pack manifest schema (`node-pack-manifest.schema.json`) requires at least one of `nodes` or `agents` to be non-empty via an `anyOf` constraint — this pack satisfies that via `agents`.

## Agents (5)

| agentId | persona | exercises |
|---|---|---|
| `echo-agent` | Echo | inline `systemPrompt` |
| `summarizer` | Summarizer | `systemPromptRef` |
| `chat` | Chat | `memoryShape.conversation: true` |
| `structured-fixture` | Structured Fixture | `handoff.{task,return}SchemaRef` |
| `tool-caller` | Tool Caller | non-empty `toolAllowlist` + `memoryShape.scratchpad: true` |

### `core.openwop.agent-examples.echo-agent`

Smoke fixture for the agent-dispatch lifecycle. Stateless, no tools, inline `systemPrompt`. Hosts that advertise `capabilities.agents.dispatch` (RFC 0007) can use this as a no-op agent.

### `core.openwop.agent-examples.summarizer`

Demonstrates `systemPromptRef` — prompt body lives in `prompts/summarizer.md`. Stateless, no tools.

### `core.openwop.agent-examples.chat`

Multi-turn conversational fixture. `memoryShape.conversation: true` — exercises per-run dialogue memory binding through the conversation channel (RFC 0005). No tools.

### `core.openwop.agent-examples.structured-fixture`

Typed I/O contract fixture. Ships `handoff.taskSchemaRef` + `handoff.returnSchemaRef` — both tarball-relative paths to JSON Schema 2020-12 documents under `schemas/`. Hosts validate inbound payloads against `taskSchemaRef` before dispatch and outbound results against `returnSchemaRef` before persistence. Stateless.

### `core.openwop.agent-examples.tool-caller`

Non-empty `toolAllowlist` fixture. Allowlists `openwop:core.http.fetch` + `openwop:core.data.jsonpath-query`. Exercises the runtime's tool-allowlist enforcement boundary established by safety-fix `OPENWOP-AUDIT-2026-003` (`SECURITY/invariants.yaml#agents-run-no-raw-handler`). Requires the host to advertise `host.agentRuntime` per RFC 0007. `memoryShape.scratchpad: true` for per-task tool-result tracking.

## Workflow usage

Agents are referenced by `WorkflowNode.agent: AgentRef` (RFC 0002). A workflow that dispatches the chat agent:

```json
{
  "id": "chat-1",
  "typeId": "core.chat",
  "agent": {
    "agentId": "core.openwop.agent-examples.chat"
  },
  "inputs": { "message": "hello" }
}
```

Hosts read the `agent.agentId` field, look up the agent manifest (loaded from this pack at install time), and dispatch with the configured system prompt + tool allowlist + memory shape + confidence calibration.

## Why no model pinned?

The agent manifest's `modelClass` is a CLASS (`general`, `writing`, `coding`, `research`, `classification`, `reasoning`) — not a specific model. Hosts map classes to concrete models via their BYOK aiProviders config. That lets the same agent pack run against Anthropic on host A, OpenAI on host B, Vertex on host C — without changes to the manifest.

## Schemas

- Agent manifest schema: `schemas/agent-manifest.schema.json` (at repo root)
- Pack manifest schema: `schemas/node-pack-manifest.schema.json` — extended in the same commit as this pack to support `agents[]` + the `anyOf` constraint requiring at least one of `nodes` or `agents` non-empty
- Per-agent handoff schemas: `schemas/structured-fixture.{task,return}.schema.json`

## See also

- [`spec/v1/node-packs.md`](../../spec/v1/node-packs.md)
- [`schemas/agent-manifest.schema.json`](../../schemas/agent-manifest.schema.json)
- [`RFCS/0003-agent-packs.md`](../../RFCS/0003-agent-packs.md) — agents[] extension RFC
- [`docs/PACK-CATALOG.md`](../../docs/PACK-CATALOG.md) — full pack catalog
- Production agent packs: `packs/core.openwop.agents.<pattern>/`
