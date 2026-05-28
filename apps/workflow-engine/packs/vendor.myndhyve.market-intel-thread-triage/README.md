# vendor.myndhyve.market-intel-thread-triage

> `market-intel.thread-triage` — cost-aware pre-filter for VoC extraction. Triages candidate threads into priority tiers, predicts VoC value, estimates extraction tokens per thread, and builds an extraction queue within a token budget. **Sixth marketIntel pack of the Stage 5 cohort.**

## Node

| typeId | Role | Behavior |
|---|---|---|
| `market-intel.thread-triage` | action (AI) | Single `ctx.callAI`. Drops low-signal threads BEFORE voc-extraction runs on them — saves AI budget. Returns priority tier per thread + predicted intent stages + tag types + per-thread extraction risk + diversity coverage. |

## Why this pack

`voc-extraction` is the expensive step in the pipeline (~3000 tokens per thread). Running it on every fetched thread is wasteful — many threads are off-topic, promotional, or duplicates. `thread-triage` runs one cheap classification call to filter the candidate pool to high-signal threads before the costly extraction pass.

Typical effect: from 100 candidate threads → 20 high-priority + 10 medium → ~30 extractions instead of 100. Savings: ~70% of voc-extraction AI cost.

## Output shape

| Field | Notes |
|---|---|
| `triagedThreads[]` | Each: `id / url / title / priority (5-enum) / predictedVoCValue / predictedIntentStages / predictedTagTypes / triageRationale / estimatedExtractionTokens / extractionRisk / extractionRiskReason?`. |
| `extractionQueue[]` | Thread id list — AI's queue OR fallback (non-skip threads sorted by `predictedVoCValue` desc). |
| `skippedThreads[]` | `{ id, title, reason }`. |
| `diversityAnalysis` | `intentCoverage / platformCoverage / problemCoverage` — coverage maps. |
| `summary` | **Rebuilt from validated data** (not echoed from AI): `totalCandidates / totalSelected / totalSkipped / estimatedTotalTokens / avgPredictedVoCValue`. |
| `warnings[]` | AI-emitted + validation warnings merged. |

## Priority tiers (from system prompt)

| Tier | Score range | Includes |
|---|---|---|
| `critical` | 0.85-1.0 | ICP pain match + high engagement + comparison language + recent |
| `high` | 0.7-0.85 | Related to ICP problems + good engagement + experience-sharing |
| `medium` | 0.5-0.7 | Tangentially related, useful supplementary signals |
| `low` | 0.3-0.5 | Generic discussion without strong signals — extract only if budget allows |
| `skip` | <0.3 | Off-topic / promotional / duplicate / dead links |

## Defaults

| Config | Default | Why |
|---|---|---|
| `temperature` | `0.3` | Triage is a precision task — consistent prioritization matters. |
| `maxTokens` | `4096` | Output is large (per-thread metadata × N candidates + diversity + summary). |
| `maxThreads` (input) | `20` | Soft AI cap on extraction queue size. |
| `minEngagement` (input) | `0` | Soft AI hint for engagement floor. |
| `tokenBudgetRemaining` (input) | `50000` | Soft AI hint for cost-awareness. |

## Required host capability

`peerDependencies: { "aiProviders": "supported" }`.

## Soft validation
- `id` + `title` (both strings) **required** — missing → drop
- Invalid `priority` → defaults to `'medium'` (kept)
- Invalid `extractionRisk` → defaults to `'medium'` (kept)
- `predictedVoCValue` non-numeric → defaults to `0.5`
- `predictedIntentStages` / `predictedTagTypes` filtered to valid enum values (rest dropped silently)
- `estimatedExtractionTokens` non-numeric → defaults to `2000`
- `summary` always recomputed from validated data (AI claims ignored)

## Pipeline composition

```
market-intel.ai-discovery
  └─ host.webResearch.fetchBatch
       ├─►  market-intel.thread-triage    ◄── (this pack — pre-filter)
       │
       │     extractionQueue[]            (subset of fetched URLs)
       │           │
       │           ▼
       └─►  market-intel.content-extraction (×N for selected only)
              └─ market-intel.voc-extraction
                   └─ market-intel.opportunity-scoring
                        └─ market-intel.ad-angles
                             └─ ads.copy.generate
```

The triage step is optional — workflows can skip it for small candidate pools (<10 threads). For pools >50, it typically pays for itself in saved voc-extraction calls.

## Differences vs MyndHyve source

**`validateThreadTriageOutput` throw → soft drop**: source threw `ThreadTriageValidationError` when `triagedThreads` was missing. Pack returns empty arrays + warning. Per-thread invalid records always dropped with warnings (matches source).

**`createScopedLogger('ThreadTriage')`** → `ctx.log` shim.

**Source-side has no workflow-node typeId** — used internally inside the `market-intel.research` orchestrator. Published here as a standalone typeId.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `threadTriage` + helpers | `src/core/market-intel/prompts/threadTriage.ts` | 562 |

~562 LOC TS ported to ~350 LOC pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
