# `core.openwop.agents.research-crew`

Multi-agent research crew — 4 specialists bundled in one pack. Planner orchestrates; Retriever gathers; Critic reviews; Writer synthesizes.

| Pack name | `core.openwop.agents.research-crew` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 4 (planner / retriever / critic / writer) |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `openwop.agents.memoryBackends ≥ longTerm` |
| License | Apache-2.0 |

## Crew topology

```
       ┌─────────────┐
goal ─▶│   Planner   │── sub-questions
       └─────────────┘     │
              │            ▼
              │     ┌─────────────┐
              │     │  Retriever  │── evidence
              │     └─────────────┘
              │            │
              │            ▼
              │     ┌─────────────┐    re-retrieve
              │     │   Critic    │────────────┐
              │     └─────────────┘            │
              │            │ approved          │
              │            ▼                   │
              │     ┌─────────────┐            │
              └────▶│   Writer    │            │
                    └─────────────┘            │
                           │                   │
                           ▼                   │
                     report ─────────────────  └── back to Retriever
```

## When to use

- The research task warrants explicit roles (someone gathers, someone critiques, someone writes).
- You want per-step audit trails (which retrievals fed which claims; what the critic flagged).
- The task is too big for `core.openwop.agents.deep-research` (single-agent), too small for hand-built orchestration.

## Difference from `core.openwop.agents.deep-research`

`deep-research` is one agent that plans + retrieves + synthesizes internally. `research-crew` is four agents with explicit handoffs — slower, more expensive, but auditable per role and naturally parallelizable on the Retriever step.

## See also

- `core.openwop.agents.supervisor/` — generic supervisor pattern (this crew is an opinionated specialization)
