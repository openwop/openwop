# vendor.myndhyve.market-intel-community-rank

> `market-intel.community-rank` — rank candidate communities by VoC research relevance. Single AI call. Distinct from `market-intel.ai-discovery` (which **generates** community suggestions): this pack **ranks existing candidates** from a connector or earlier discovery step. **Ninth marketIntel pack of the Stage 5 cohort.**

## Node

| typeId | Role | Behavior |
|---|---|---|
| `market-intel.community-rank` | action (AI) | Single `ctx.callAI`. Per-community: relevanceScore (0..1 clamped) + signalQuality (high/medium/low) + ICP problem alignment + expected intent stages + search strategy + risk factors. Selected community list sorted by relevanceScore desc; platformCoverage + summary recomputed from validated data. |

## Output shape

| Field | Notes |
|---|---|
| `selectedCommunities[]` | `id / name / platform / url / relevanceScore / signalQuality / relevantProblems / expectedIntentStages / rankingRationale / searchStrategy / riskFactors`. Sorted by relevanceScore desc. |
| `rejectedCommunities[]` | `{ id, name, reason }`. |
| `platformCoverage[]` | **Computed from validated selected** — AI's claim ignored. `{ platform, communityCount, avgRelevance }`, sorted by count desc. |
| `summary` | **Rebuilt from validated data**: `totalCandidates / totalSelected / avgRelevanceScore / topPlatform`. |
| `warnings[]` | AI + validation merged. |

## Why this pack (distinct from `market-intel.ai-discovery`)

| Pack | Input | Output |
|---|---|---|
| **`market-intel.ai-discovery`** | Topic + ICP/audience | NEW community suggestions + URLs + search queries |
| **`market-intel.community-rank`** (this) | EXISTING candidate communities (with initial scores) | Refined ranking + per-community search strategy + risk flags |

Use ai-discovery to **find** candidates; use community-rank to **prioritize** them.

## Soft validation
- `id` + `name` (both non-empty strings) **required** — missing → drop entry
- Invalid `platform` → defaults to `'other'` (kept)
- Invalid `signalQuality` → defaults to `'medium'` (kept)
- Non-numeric `relevanceScore` → defaults to `0.5`; out-of-range clamped to `[0, 1]`
- Rejected community without `id` → drop
- `platformCoverage` always recomputed (sorted by count desc; ties broken by avgRelevance)
- `summary` always recomputed; `topPlatform` from platformCoverage; falls back to `'other'` when empty

## Defaults

| Config | Default |
|---|---|
| `temperature` | `0.3` |
| `maxTokens` | `4096` |
| `maxCommunities` (input) | `10` |
| `minRelevance` (input) | `0.3` |

## Required host capability

`peerDependencies: { "aiProviders": "supported" }`.

## Pipeline composition — refinement after discovery

```
market-intel.ai-discovery
  └─►  candidates (URLs + communities + queries)
       │
       ▼
market-intel.community-rank   ◄── (this pack — refine + add search strategy)
  └─►  selectedCommunities (with searchStrategy per community)
       │
       ▼  (for each: run host.webResearch.search with the community-specific strategy)
       │
       ▼
market-intel.thread-triage / content-extraction / voc-extraction / ...
```

This pack is the natural follow-up to ai-discovery when the candidate pool needs refining before running expensive downstream extraction.

## Differences vs MyndHyve source

**`validateCommunityDiscoveryOutput` throw → soft drop**: source threw when `selectedCommunities` was missing. Pack returns empty array + warning.

**`platformCoverage` + `summary` always rebuilt** from validated data. Source defers to AI's claimed values; pack rebuilds for consistency with the rest of the marketIntel cohort.

**Source-side has no workflow-node typeId** — used internally inside `market-intel.research`. Published as a standalone typeId here. Named `market-intel.community-rank` (not `community-discovery`) to disambiguate from the existing `vendor.myndhyve.market-intel-discovery` pack which DOES discovery (generates NEW communities from a topic).

**`createScopedLogger('CommunityDiscovery')`** → `ctx.log` shim.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `communityRank` + helpers | `src/core/market-intel/prompts/communityDiscovery.ts` | 513 |

~513 LOC TS ported to ~340 LOC pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
