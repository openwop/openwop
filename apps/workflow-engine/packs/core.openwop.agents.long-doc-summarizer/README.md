# `core.openwop.agents.long-doc-summarizer`

Long-document summarizer using map-reduce. Splits input into chunks, summarizes each, then synthesizes a final summary. Handles documents that exceed any single LLM's context window.

| Pack name | `core.openwop.agents.long-doc-summarizer` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: remote` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime` |
| License | Apache-2.0 |

## When to use it

- Inputs > 50K tokens
- Multi-document corpora
- Cases where you want chunk-level summaries available in addition to the final synthesis

For short inputs (< 8K tokens), use `core.openwop.agent-examples.summarizer` directly — map-reduce adds latency and cost.

## Map-reduce pipeline

1. **Split** the input via `openwop:core.flow.split-in-batches` (chunk size and overlap caller-configurable).
2. **Map**: independently summarize each chunk. Per-chunk summaries are length-capped (caller-configurable, default ~500 chars).
3. **Reduce**: synthesize a final summary from the chunk summaries via `openwop:core.flow.aggregate-text`. Final summary is style-configurable (`brief` / `outline` / `narrative`).

## Handoff schemas

- `schemas/long-doc-summarizer.task.schema.json` — `{ input, style?, chunkSize?, chunkOverlap?, finalLength? }`
- `schemas/long-doc-summarizer.return.schema.json` — `{ summary, chunkSummaries, tokenCounts }`
