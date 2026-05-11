# `core.openwop.agent-examples`

First pure-agent pack. Ships two minimal agent manifests with no node runtime. Validates the `agents[]` extension to `pack.json` (per `agent-manifest.schema.json` + RFC 0003 §`agents[]` extension).

| Pack name | `core.openwop.agent-examples` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | `language: remote` (no executable artifact — agents are host-interpreted) |
| Nodes | 0 — pure agent pack |
| Agents | 2 |
| External deps | None |
| License | Apache-2.0 |

## Why "pure agent pack"?

Node packs ship executable runtime artifacts (JS, Python, Go, WASM). Agent packs ship **agent manifests** — descriptors that hosts read to instantiate agents (system prompt + tool allowlist + memory shape + confidence calibration + handoff schemas). The agent itself runs inside whatever LLM the host's BYOK `aiProviders` surface resolves; the pack contributes the configuration, not the runtime.

A pure agent pack has `nodes: []` or omits the field entirely. The pack manifest schema (`node-pack-manifest.schema.json`) requires at least one of `nodes` or `agents` to be non-empty via an `anyOf` constraint — this pack satisfies that via `agents`.

## Agents

### `core.openwop.agent-examples.echo-agent`

| Field | Value |
|---|---|
| `persona` | `"Echo"` |
| `modelClass` | `"general"` |
| `systemPrompt` | Inline (~50 words) — repeats the user's most recent message verbatim |
| `toolAllowlist` | `[]` |
| `memoryShape` | `{ scratchpad: false, conversation: false, longTerm: false }` (stateless) |
| `confidence.defaultThreshold` | `0.95` (high — echo is mechanical) |

Smoke fixture for the agent-dispatch lifecycle. Hosts that advertise `capabilities.agents.dispatch` (RFC 0007) can use this as a no-op agent in conformance tests.

### `core.openwop.agent-examples.summarizer`

| Field | Value |
|---|---|
| `persona` | `"Summarizer"` |
| `modelClass` | `"writing"` |
| `systemPromptRef` | `prompts/summarizer.md` (~150 words) |
| `toolAllowlist` | `[]` |
| `memoryShape` | `{ scratchpad: false, conversation: false, longTerm: false }` (stateless) |
| `confidence.defaultThreshold` | `0.7` (default — text-quality judgments warrant escalation) |

Demonstrates the `systemPromptRef` path — the prompt body lives in `prompts/summarizer.md` rather than inlined in the manifest. Useful when prompts grow beyond a few sentences.

## Workflow usage

Agents are referenced by `WorkflowNode.agent: AgentRef` (RFC 0002). A workflow that dispatches the echo agent at a chat node:

```json
{
  "id": "chat-1",
  "typeId": "core.chat",
  "agent": {
    "agentId": "core.openwop.agent-examples.echo-agent"
  },
  "inputs": { "message": "hello world" }
}
```

Hosts read the `agent.agentId` field, look up the agent manifest (loaded from this pack at install time), and dispatch with the configured system prompt + tool allowlist + memory shape + confidence calibration.

## Why no model pinned?

The agent manifest's `modelClass` is a CLASS (`general`, `writing`, `coding`, `research`, `classification`, `reasoning`) — not a specific model. Hosts map classes to concrete models via their BYOK aiProviders config. That lets the same agent pack run against Anthropic on host A, OpenAI on host B, Vertex on host C — without changes to the manifest.

## Schemas

- Agent manifest schema: `schemas/agent-manifest.schema.json` (at repo root)
- Pack manifest schema: `schemas/node-pack-manifest.schema.json` — extended in the same commit as this pack to support `agents[]` + the `anyOf` constraint requiring at least one of `nodes` or `agents` non-empty

## See also

- [`spec/v1/node-packs.md`](../../spec/v1/node-packs.md)
- [`schemas/agent-manifest.schema.json`](../../schemas/agent-manifest.schema.json)
- [`RFCS/0003-agent-packs.md`](../../RFCS/0003-agent-packs.md) — agents[] extension RFC
- [`docs/PACKS-MVP-PLAN.md`](../../docs/PACKS-MVP-PLAN.md)
