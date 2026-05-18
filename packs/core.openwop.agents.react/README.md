# `core.openwop.agents.react`

Canonical ReAct (Reason + Act) loop agent. The "hello world" of openwop agents — every framework that ships an agent library ships one of these (LangGraph's `react-agent`, LangChain's `create_react_agent`, CrewAI's task loop, etc.).

| Pack name | `core.openwop.agents.react` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: remote` (pure-agent pack) |
| Nodes | 0 |
| Agents | 1 (`core.openwop.agents.react.default`) |
| Required host capabilities | `aiProviders`, `host.agentRuntime` |
| License | Apache-2.0 |

## What it does

Implements the ReAct prompting pattern (Yao et al., 2022): the agent alternates between **reasoning** ("what should I do next?") and **acting** (one tool call, or a final answer). Each iteration reads the prior observation back into the prompt context, then decides the next step.

Default tool allowlist permits `openwop:core.http.fetch`. Workflows extend the allowlist at dispatch time via the `RunOptions.configurable.toolAllowlist` override (per RFC 0002 §F + host policy).

## When to use it vs. when not to

| Use ReAct when… | Don't use ReAct when… |
|---|---|
| The task needs flexible decision-making over a small tool set | The task is a fixed pipeline (use a workflow DAG instead) |
| The user can describe the goal but not the exact steps | The task needs strict structured output (use `core.openwop.agents.structured-extractor`) |
| 2-6 tool calls are typical | The task needs 10+ steps (use `core.openwop.agents.deep-research` or a crew pack) |
| You want auditable per-step reasoning events | You want fastest-possible single-shot inference |

## Handoff schemas

Both task and return payloads are typed:

- `schemas/react.task.schema.json` — `{ goal: string, maxSteps?: number, toolAllowlist?: string[] }`
- `schemas/react.return.schema.json` — `{ answer: string, steps: ReActStep[], stoppedReason: "completed" | "max_steps" | "tool_error" }`

Hosts validate inbound `task` against `taskSchemaRef` before dispatch and outbound `result` against `returnSchemaRef` before persistence (per RFC 0003 §D).

## Configuration knobs

The agent reads three knobs from the task payload:

- `goal` (required) — the user's request.
- `maxSteps` (optional, default `6`) — hard cap on Reason+Act iterations.
- `toolAllowlist` (optional) — extends the pack's default allowlist for this dispatch. Hosts MAY enforce a host-level allowlist that intersects with both.

## Required host capabilities

This pack DEPENDS on a host that advertises both:

- `host.aiProviders` — for LLM inference (`ctx.callAI` per the BYOK contract).
- `host.agentRuntime` — for the tool-dispatch boundary established by safety-fix `OPENWOP-AUDIT-2026-003`. Hosts without `host.agentRuntime` MUST refuse to dispatch any agent with non-empty `toolAllowlist` (returns `HOST_CAPABILITY_MISSING`).

The reference Postgres host (`examples/hosts/postgres/`) advertises both.

## See also

- `spec/v1/agent-dispatch.md` (not yet drafted)
- [`RFCS/0002-agent-identity-and-reasoning-events.md`](../../RFCS/0002-agent-identity-and-reasoning-events.md)
- [`RFCS/0007-dispatch.md`](../../RFCS/0007-dispatch.md)
- [`packs/core.openwop.agents/`](../core.openwop.agents/) — n8n-style root+sub-nodes for in-workflow agent composition (this pack is the alternative: a standalone agent persona, no sub-nodes)
- [`packs/core.openwop.agents.supervisor/`](../core.openwop.agents.supervisor/) — multi-agent supervisor
- [`packs/core.openwop.agents.deep-research/`](../core.openwop.agents.deep-research/) — long-horizon research variant
