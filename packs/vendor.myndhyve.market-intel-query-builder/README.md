# vendor.myndhyve.market-intel-query-builder

> `market-intel.query-builder` — generate intent-mapped search queries (4-8 query groups × 4 intent stages, variations + synonyms + platform hints) + per-competitor query packs + topic clusters from ICP + product context. **Eighth marketIntel pack of the Stage 5 cohort.**

## Node

| typeId | Role | Behavior |
|---|---|---|
| `market-intel.query-builder` | action (AI) | Single `ctx.callAI`. Produces search-engine-ready queries grouped by intent stage AND by competitor. Pairs with `ai-discovery`: query-builder = "what to search for", ai-discovery = "where to search". |

## Output shape

| Field | Notes |
|---|---|
| `queryGroups[]` | Per intent stage: `primaryQuery / variations[] / synonyms{} / rationale / expectedSignal (high/medium/low) / platformHints? { reddit / stackexchange / hn }`. Missing `primaryQuery` → drop. |
| `competitorQueries[]` | Per competitor: `comparisonQueries / switchingQueries / alternativeQueries`. Missing `competitor` → drop. |
| `topicClusters[]` | `clusterName / queries / relatedTerms`. Missing `clusterName` → drop. |
| `summary` | **Rebuilt from validated data** — AI claims ignored. `totalQueries` = primary + variations + competitor queries (NOT topic-cluster queries to avoid double-counting). |
| `warnings[]` | AI + validation merged. |

## Soft validation
- `primaryQuery` (string, non-empty) **required** — missing → drop
- `competitor` (string, non-empty) **required** — missing → drop
- `clusterName` (string, non-empty) **required** — missing → drop
- Invalid `intentStage` → defaults to `'researching'` (kept)
- Invalid `expectedSignal` → defaults to `'medium'` (kept)
- `synonyms` entries with empty key OR non-array value silently filtered
- `platformHints` filtered to known platforms (reddit/stackexchange/hn); empty → omitted

## Defaults

| Config | Default | Why |
|---|---|---|
| `temperature` | `0.4` | Variations benefit from moderate diversity. |
| `maxTokens` | `6000` | 4 stages × 8 groups × variations is substantial. |
| `maxQueriesPerStage` (input) | `8` | Soft AI cap. |

## Required host capability

`peerDependencies: { "aiProviders": "supported" }`.

## Pipeline composition — pairs with ai-discovery as a search seeder

```
market-intel.query-builder        →  queryGroups + competitorQueries + topicClusters
                                              │
                                              ▼  (workflow author selects queries to run)
                              market-intel.ai-discovery       (uses queries to find specific URLs)
                                              │
                                              ▼  (host.webResearch.search/fetchBatch)
                              market-intel.thread-triage      (optional pre-filter)
                                              │
                                              ▼
                              market-intel.content-extraction (×N pages)
                                              │
                                              ▼
                              market-intel.voc-extraction
                                              │
                                              ▼
                              market-intel.opportunity-scoring
                                              │
                                              ▼
                              market-intel.ad-angles
                                              │
                                              ├─►  market-intel.audience-targeting
                                              └─►  ads.copy.generate
```

9-pack composable chain end-to-end. `query-builder` extends the front of the pipeline with intent-aware query generation.

## Differences vs MyndHyve source

**`validateQueryBuilderOutput` throw → soft drop**: source threw `QueryBuilderValidationError` when `queryGroups` was missing. Pack returns empty arrays + warning.

**Source-side has no workflow-node typeId** — used internally inside `market-intel.research`. Published as a standalone typeId.

**Summary recomputed**: source builds `queriesByIntent` from validated groups (matches pack). Pack also recomputes `totalQueries` and `competitorCoverage` (source defers to AI's claim — pack rebuilds for consistency).

**`createScopedLogger('QueryBuilder')`** → `ctx.log` shim.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `queryBuilder` + helpers | `src/core/market-intel/prompts/queryBuilder.ts` | 547 |

~547 LOC TS ported to ~370 LOC pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
