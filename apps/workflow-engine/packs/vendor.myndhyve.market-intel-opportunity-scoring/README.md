# vendor.myndhyve.market-intel-opportunity-scoring

> `market-intel.opportunity-scoring` — score and rank communities AND messaging angles on a 5-dimension scale (volume / intensity / commercialIntent / clarity / uniqueness, weighted total) given a VoC corpus + community metadata. **Fourth marketIntel pack of the Stage 5 cohort.**

## Node

| typeId | Role | Behavior |
|---|---|---|
| `market-intel.opportunity-scoring` | action (AI) | Single `ctx.callAI`. Validates JSON output. Returns two independently-ranked lists: communities (sorted by `score.total` desc) and angles (sorted by `priority` asc). Soft validation: invalid entries dropped with per-entry warnings; missing required fields use safe defaults. |

## Output shape

| Field | Notes |
|---|---|
| `rankedCommunities[]` | `community / platform / score / rationale / themes / focusAreas / risks`. Sorted by `score.total` desc. |
| `rankedAngles[]` | `angleId / angleName / segment / corePain / promise / score / evidence / rationale / communities / priority`. Sorted by `priority` ascending (1 = test first). |
| `insights` | `topOpportunity / marketGaps[] / competitiveAdvantages[] / recommendations[]` — strategic summary. |
| `methodology` | Free-form AI rationale string (default: `"Standard scoring"`). |
| `warnings[]` | AI-emitted + per-entry validation warnings merged. |

`score` is the same 5-dimension breakdown used by `market-intel.ad-angles`:
- volume / intensity / commercialIntent / clarity / uniqueness — each clamped to `1..10`
- total = `0.2·V + 0.25·I + 0.3·CI + 0.15·C + 0.1·U` when AI doesn't provide one

Default weights can be overridden via `inputs.scoringWeights`.

## Required host capability

`peerDependencies: { "aiProviders": "supported" }`. Single `ctx.callAI` per invocation.

## Soft validation policy
- `community` (string, non-empty) **required** — missing → drop
- `angleName` (string, non-empty) **required** — missing → drop
- Invalid `platform` → defaults to `'other'` (not dropped)
- Invalid `segment` → defaults to `'researching'` (not dropped)
- Invalid `priority` → falls back to source index + 1
- Invalid score values → default to `5` (per-dimension)
- `rankedCommunities` and `rankedAngles` validation are **independent** — a malformed angle won't drop the community list and vice versa

## Defaults

| Config | Default | Why |
|---|---|---|
| `temperature` | `0.3` | Scoring is precision-oriented. |
| `maxTokens` | `6000` | Output carries 2 ranked lists + insights + methodology. |
| `maxOpportunities` (input) | `10` | Soft target for each ranked list. |
| `scoringWeights` (input) | `0.2 / 0.25 / 0.3 / 0.15 / 0.1` | Volume / Intensity / CI / Clarity / Uniqueness. |

## Pipeline composition — 5-pack marketIntel→ads chain

```
market-intel.ai-discovery  ─►  sources[]
                                  │
                                  ▼  (host.webResearch.fetchBatch — vendor.myndhyve.web-research)
                          market-intel.voc-extraction (×N pages)
                                  │
                                  ├─► aggregate to vocRecords[] + communities[]
                                  │
                                  ▼
                       market-intel.opportunity-scoring   ◄── (this pack)
                                  │
                                  ▼
                          market-intel.ad-angles
                                  │
                                  └─► briefs[] → ads.copy.generate
```

All 5 packs are now published as standalone, composable typeIds.

## Differences vs MyndHyve source

**`aiService.complete(...)` → `ctx.callAI(...)`**: source invokes through `PromptPackExecutor`.

**`validateOpportunityScoringOutput` throw → soft drop**: source threw `OpportunityScoringValidationError` when `rankedCommunities` or `rankedAngles` was missing. Pack returns those lists as `[]` with a single warning when either is missing. Per-entry invalid records always dropped with warnings (matching source).

**Not exposed as a workflow-node typeId in the source** — used internally by `market-intel.research`. Published here as a standalone typeId so workflow authors can compose it directly without the orchestrator.

**TypeScript enum constraints** → plain `VALID_INTENT_STAGES` / `VALID_PLATFORMS` arrays.

**`createScopedLogger('OpportunityScoring')`** → `ctx.log` shim.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `opportunityScoring` + helpers | `src/core/market-intel/prompts/opportunityScoring.ts` | 709 |

~709 LOC TS ported to ~440 LOC pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
