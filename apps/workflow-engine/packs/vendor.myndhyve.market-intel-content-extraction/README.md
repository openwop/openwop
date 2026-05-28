# vendor.myndhyve.market-intel-content-extraction

> `market-intel.content-extraction` — extract structured content from raw HTML via one AI call. Sits between `host.webResearch.fetchBatch` and `market-intel.voc-extraction` in the canonical pipeline. **Fifth marketIntel pack of the Stage 5 cohort.**

## Node

| typeId | Role | Behavior |
|---|---|---|
| `market-intel.content-extraction` | action (AI) | Single `ctx.callAI`. HTML truncated to `config.htmlTruncateChars` (default 50000) before prompt; `wasTruncated` flag returned in output. Validates JSON output; soft-defaults invalid fields. |

## Output shape

| Field | Notes |
|---|---|
| `title` | String (empty + warning when AI omits). |
| `content` | Cleaned main text body. |
| `author` | String or `null`. |
| `publishedAt` | ISO 8601 string or `null`. Invalid date inputs dropped to `null` with warning. |
| `contentType` | One of 7 enum values; invalid → `'other'` + warning. |
| `engagement` | `{ upvotes, comments, views, shares }` — all nullable ints. |
| `tags[]` | Non-empty string filter. |
| `summary` | 1-2 sentence string. |
| `relevantQuotes[]` | ≥5 chars each; shorter dropped with count warning. |
| `url` | Passthrough from inputs (for traceability). |
| `wasTruncated` | Boolean — was input HTML longer than `htmlTruncateChars`. |
| `warnings[]` | AI-emitted + validation warnings merged. |

## Required host capability

`peerDependencies: { "aiProviders": "supported" }`.

## Defaults

| Config | Default | Why |
|---|---|---|
| `temperature` | `0.2` | Extraction must be faithful to source. |
| `maxTokens` | `3000` | Compact structured output. |
| `htmlTruncateChars` | `50000` | Mirrors source-side cap. Long pages truncated, `wasTruncated: true` set. |

## Pipeline composition — full 6-step marketIntel→ads chain

```
market-intel.ai-discovery          ─►  sources[]
                                            │
                                            ▼  (host.webResearch.fetchBatch — vendor.myndhyve.web-research)
                                          fetched pages
                                            │
                                            ▼
                              market-intel.content-extraction   ◄── (this pack, ×N pages)
                                            │
                                            ▼
                              market-intel.voc-extraction   (×N extracted contents)
                                            │
                                            ▼  aggregate to vocRecords + communities
                                            │
                                            ▼
                              market-intel.opportunity-scoring
                                            │
                                            ▼
                                 market-intel.ad-angles
                                            │
                                            └─►  briefs[] → ads.copy.generate
```

All 6 packs in the chain are now published as standalone composable typeIds.

## Differences vs MyndHyve source

**Source-side has no workflow-node typeId** for content-extraction. It's used internally inside `market-intel.research` via `PromptPackExecutor`. Published here as a standalone typeId so workflow authors can compose it without the orchestrator.

**Source-side hardcoded 50000-char HTML truncation** → exposed as `config.htmlTruncateChars`. Both source and pack default to 50000. Pack reports `wasTruncated: true` in output for diagnostic traceability.

**Source-side throws on invalid JSON** → pack returns `success: true` with empty output + warning. Matches marketIntel-cohort soft-validation policy.

**Source-side `publishedAt`** is passed through as-is (could be any string). Pack validates with `new Date()` — invalid date → `null` + warning.

**`createScopedLogger('ContentExtraction')`** → `ctx.log` shim.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `contentExtraction` + helpers | `src/core/market-intel/prompts/discoveryPrompt.ts` (content-extraction section) | ~100 |

~100 LOC TS ported to ~220 LOC pure JS (validation expansion).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
