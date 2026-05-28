# `core.openwop.agents.supervisor`

Multi-agent supervisor. Routes user tasks to specialized subagents via RFC 0007 dispatch and aggregates results. Mirrors LangGraph Supervisor and CrewAI's hierarchical-process pattern.

| Pack name | `core.openwop.agents.supervisor` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: remote` (pure-agent pack) |
| Agents | 1 (`core.openwop.agents.supervisor.default`) |
| Required host capabilities | `aiProviders`, `host.agentRuntime` |
| License | Apache-2.0 |

## What it does

Receives a user goal and the names of subagents available in the run. Plans which subagent handles which subtask, dispatches each via the host's RFC 0007 dispatch surface, awaits results, decides whether the goal is complete or needs another round, then synthesizes a final answer.

Tool allowlist is intentionally narrow: only `openwop:core.dispatch.agent` (fire-and-forget subagent dispatch) and `openwop:core.dispatch.await` (block on a dispatched subagent). The supervisor does not call APIs, fetch URLs, or access files directly — that's the subagents' job.

## When to use it vs. when not to

| Use Supervisor when… | Don't use Supervisor when… |
|---|---|
| The goal requires multiple specialized skills (research + writing + coding) | The goal is a single skill — dispatch the specialist directly |
| Subagents are independently developed and versioned | All "subagents" are really just prompt variations — use a single agent with prompt branching |
| You want per-subagent confidence calibration + escalation | You need lowest-latency single-shot inference |
| Subtasks can run in parallel | The dependency graph is strictly linear — use a workflow DAG |

## Required subagent contract

A workflow that uses Supervisor MUST also pre-install the subagent packs the Supervisor will dispatch. Supervisor learns about available subagents through the `task.subagents` field at dispatch time (an array of `AgentRef` per RFC 0002). It will only attempt to dispatch agents named in that array — unknown `agentId`s are rejected at dispatch time by the host's agent registry.

Suggested companions:
- `core.openwop.agents.deep-research` — for research subtasks
- `core.openwop.agents.code-reviewer` — for code subtasks
- `core.openwop.agents.doc-writer` — for writing subtasks
- `core.openwop.agents.structured-extractor` — for structured-output subtasks

## Handoff schemas

- `schemas/supervisor.task.schema.json` — `{ goal: string, subagents: AgentRef[], maxRounds?: number }`
- `schemas/supervisor.return.schema.json` — `{ answer: string, dispatchedSubagents: SubagentDispatch[], stoppedReason }`

## See also

- [`RFCS/0006-orchestrator.md`](../../RFCS/0006-orchestrator.md)
- [`RFCS/0007-dispatch.md`](../../RFCS/0007-dispatch.md)
- `packs/core.openwop.agents.research-crew/` (not yet shipped) — pre-bundled crew (Supervisor pairs naturally with crew packs)
