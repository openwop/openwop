# `core.openwop.agents.devops-crew`

DevOps 3-agent crew. Planner decomposes operational goals into safe steps; Executor runs them; Verifier confirms.

| Pack name | `core.openwop.agents.devops-crew` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 3 (planner / executor / verifier) |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `host.fs`, `host.queueBus` |
| License | Apache-2.0 |

## Safety design

DevOps mistakes are expensive. This crew enforces:

- **Plan-execute-verify is mandatory.** Executor never runs without a plan; Verifier always runs after Executor.
- **Human approval gates.** Planner marks high-risk steps `requiresHumanApproval: true`; Executor refuses to run them without an explicit approval signal in the dispatch payload.
- **One step at a time.** Executor handles a single step per dispatch — caller (planner) decides whether to dispatch the next step based on Verifier's result.
- **No state-changing tools for Verifier.** Verifier's allowlist is read-only.

## Required host capabilities

- `host.fs` — fs-read/fs-write (planner reads runbook files; executor reads + writes config; verifier reads).
- `host.queueBus` — messaging.publish/consume for async ops.
- `host.agentRuntime` — for the dispatch chain.

## Handoff schemas

Each agent has its own task/return schema under `schemas/`. Planner emits a step list; Executor consumes one step; Verifier consumes a step + the post-check spec.
