# vendor.myndhyve.market-intel-audience-targeting

> `market-intel.audience-targeting` — generate per-platform paid-media targeting packs (interests + keywords + community placements + audience definitions) for 6 ad platforms via one AI call. **Seventh marketIntel pack of the Stage 5 cohort.**

## Node

| typeId | Role | Behavior |
|---|---|---|
| `market-intel.audience-targeting` | action (AI) | Single `ctx.callAI`. Generates targeting packs for the requested ad platforms + cross-platform insights + testing sequence + budget allocation. Soft validation: invalid entries dropped per-target with no warning noise; invalid platforms rejected at input-validation time before the AI call. |

## Supported platforms

`meta` / `google` / `linkedin` / `tiktok` / `reddit` / `x`

Unsupported platforms in `inputs.targetPlatforms[]` fail fast with `INVALID_INPUTS` (no AI cost wasted).

## Output shape

Per-platform pack:

| Field | Notes |
|---|---|
| `interests[]` | `interest / platform / category / rationale / audienceSize (small/medium/large) / alignedAngles[]`. Missing `interest` → dropped. |
| `keywords[]` | `keyword / platform / matchType (broad/phrase/exact) / volumeEstimate (low/medium/high) / intent / related[]`. |
| `communities[]` | Community/placement targets: `community / platform / rationale / estimatedReach / recommendedAngles / contentRecommendations`. |
| `audiences[]` | `type (lookalike/custom/retargeting/seed) / name / platform / source / configuration / useCases[]`. Missing `name` → dropped. |
| `notes[]` | Platform-specific notes. |

Plus 4 cross-cutting outputs:
- `crossPlatformInsights` — `primaryAudience / secondaryAudiences / exclusionRecommendations / scalingPath`.
- `testingSequence[]` — `{ phase, platform, targetingType, rationale }`. Sorted by `phase` ascending. Entries with invalid platform OR missing fields dropped.
- `budgetAllocation[]` — `{ platform, percentage (0-100 clamped), rationale }`. Non-numeric percentages dropped.
- `warnings[]` — AI + validation merged.

## Soft validation policy
- Invalid platform → **drop entire platform pack** with warning (platform-level identity).
- Invalid enum values inside a pack → safe defaults (e.g. `audienceSize` invalid → `medium`).
- Missing required identity field (`interest`, `keyword`, `community`, audience `name`) → drop that target with no per-target warning (high-volume noise).
- Pre-AI input validation: empty `targetPlatforms` OR unsupported platforms in the list → `INVALID_INPUTS` (saves AI cost).

## Defaults

| Config | Default | Why |
|---|---|---|
| `temperature` | `0.4` | Moderate variation across platforms (vs 0.3 for VoC/triage precision). |
| `maxTokens` | `8000` | Output is large: per-platform packs × 4 sub-arrays + cross-platform + sequence + budget. |

## Pipeline composition — final consumer in the marketIntel chain

```
market-intel.opportunity-scoring  →  rankedCommunities[] + rankedAngles[]
                                              │
                                              ▼
                              market-intel.audience-targeting   ◄── (this pack)
                                              │
                                              ├─►  platformPacks[]      → ads.publish.platform (future)
                                              ├─►  testingSequence[]    → A/B test runner (future)
                                              └─►  budgetAllocation[]   → campaign budget setup (future)
```

This pack closes the marketIntel → paid-media loop: VoC research → scored opportunities → ad angles → **targeting + budget**. The remaining `ads.publish.platform` and `ads.metrics.import` typeIds need new openwop spec extensions for platform-specific ad APIs (Meta Marketing API, Google Ads API, etc.) — out of scope here.

## Required host capability

`peerDependencies: { "aiProviders": "supported" }`.

## Differences vs MyndHyve source

**`validateAudienceTargetingOutput` throw → soft drop**: source threw `AudienceTargetingValidationError` when `platformPacks` was missing. Pack returns empty arrays + warning. Per-pack and per-target invalid records always dropped (matches source).

**Source-side has no workflow-node typeId** — used internally inside `market-intel.research`. Published here as a standalone typeId.

**Pre-AI input validation expanded**: source-side passes `targetPlatforms[]` directly to the AI without validation. Pack validates at input-validation time and rejects unsupported platforms with `INVALID_INPUTS` (no AI cost).

**`createScopedLogger('AudienceTargeting')`** → `ctx.log` shim.

**`createKeywordTargetMap` + `validateBudgetAllocationSum` helpers** from source are out-of-scope — they're caller utilities, not part of the prompt-pack contract. Workflow authors can compute budget sums downstream of `outputs.budgetAllocation`.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `audienceTargeting` + helpers | `src/core/market-intel/prompts/audienceTargeting.ts` | 855 |

~855 LOC TS ported to ~500 LOC pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
