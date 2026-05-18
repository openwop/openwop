# `core.openwop.agents.deep-research`

Long-horizon research agent. Plans an investigation, decomposes into sub-questions, retrieves from RAG + web, evaluates source quality, produces a structured findings report. Mirrors LangGraph Deep Agents.

| Pack name | `core.openwop.agents.deep-research` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: remote` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `openwop.agents.memoryBackends ≥ longTerm` |
| License | Apache-2.0 |

## When to use it

- Open-ended research questions ("what are the trade-offs of X vs Y in 2026?")
- Multi-source investigations where source quality matters
- Tasks where 10-20 tool calls are typical
- Tasks where you want findings persisted to long-term memory for re-use

Don't use it for: short fact lookups (use `react`), single-document extraction (use `structured-extractor`), strict step-by-step pipelines (use a workflow DAG).

## Long-term memory

`memoryShape.longTerm: true` — the agent persists discovered facts (sources, claims, contradictions) to long-term memory per RFC 0004 so subsequent runs on related topics can re-use them. **Triggers the redaction harness** per RFC 0004 — credentials, PII, and secrets in retrieved content are masked before persistence.

## Tool allowlist

Default permits:
- `openwop:core.http.fetch` — HTTP GET for direct URL retrieval
- `openwop:core.rag.retrieve` — RAG retrieval against installed vector indices
- `openwop:core.rag.contextual-compression` — relevance-pruning for long retrievals
- `openwop:vendor.myndhyve.web-research` — web-search-aware retrieval over the host's search adapter

Hosts MAY restrict at dispatch time. Workflows MAY extend via `task.toolAllowlist`.

## Handoff schemas

- `schemas/deep-research.task.schema.json` — `{ question: string, depth?: "shallow"|"medium"|"deep", maxToolCalls?: number, sources?: string[] }`
- `schemas/deep-research.return.schema.json` — `{ report: string, findings: Finding[], sources: Source[], openQuestions: string[] }`

## See also

- `packs/core.openwop.agents.research-crew/` (not yet shipped) — bundled crew variant (planner + retriever + critic + writer)
- [`packs/core.openwop.rag/`](../core.openwop.rag/) — RAG primitives used by tools
- [`RFCS/0004-memory-layer.md`](../../RFCS/0004-memory-layer.md)
