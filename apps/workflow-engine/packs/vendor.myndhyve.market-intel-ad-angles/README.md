# vendor.myndhyve.market-intel-ad-angles

> `market-intel.ad-angles` — generate 5-10 ad-angle briefs from VoC research + ICP/product context via one AI call. Each brief is scored on 5 dimensions, ranked by weighted total, and grounded in verbatim source quotes. Second marketIntel pack of the Stage 5 cohort.

## Node

| typeId | Role | Behavior |
|---|---|---|
| `market-intel.ad-angles` | action (AI) | Issues one `ctx.callAI`. Validates the JSON output. Sorts briefs by `score.total` descending. Rebuilds `segmentBreakdown` from validated briefs. Soft validation: invalid briefs are dropped with per-brief warnings (not errored). |

## Output shape

Each brief carries:

| Field | Notes |
|---|---|
| `angleId` | Stable id (`angle-1`, ...). |
| `angleName` | Descriptive — required, non-empty (else drop). |
| `segment` | One of `ready_now / researching / problem_aware / unaware`; invalid → defaults to `researching`. |
| `corePain` | Required, non-empty (else drop). |
| `promise` / `mechanism` / `rationale` | Strings (default `""`). |
| `proofNeeded[]` / `objectionsToHandle[]` | String arrays (default `[]`). |
| `hookVariants[]` | String array; empty triggers a warning but brief is still kept. |
| `recommendedCta` | One of `info_offer / demo / trial / audit / consult / buy_now / learn_more`; invalid → defaults to `learn_more`. |
| `sourceQuotes[]` | Quote ≥5 chars; URL+community optional. |
| `score` | `volume / intensity / commercialIntent / clarity / uniqueness` clamped to `1..10` (default `5`); `total` = `0.2·V + 0.25·I + 0.3·CI + 0.15·C + 0.1·U` when AI doesn't provide one. |

Sibling fields:
- `segmentBreakdown` — rebuilt from validated briefs.
- `crossAngleThemes[]` — pass-through from AI (string-filtered).
- `testingPriority[]` — `{ angleId, reason }` records; entries missing either field are dropped.
- `warnings[]` — AI-emitted + validation warnings merged.

## Defaults

| Config | Default | Why |
|---|---|---|
| `temperature` | `0.6` | Higher than VoC extraction (0.3) — angle generation benefits from creative variation. |
| `maxTokens` | `6000` | Ad-angle briefs are larger than VoC records (10 angles × ~500 tokens/angle + summary). |
| `targetAngleCount` (input) | `8` | PRD §10.3 — sweet spot for distinct angles vs. signal degradation. |
| `minSourceQuotesPerAngle` (input) | `2` | Soft constraint passed to the AI; not validation-enforced. |

## Required host capability

`peerDependencies: { "aiProviders": "supported" }`. Single `ctx.callAI` per invocation.

## Pipeline composition

```
market-intel.voc-extraction (×N sources)
            │
            └──┬─► aggregate VoC quotes by tagType
               │
               ▼
        market-intel.ad-angles
            │
            ├─► briefs[] (ranked) → ads.copy.generate (uses brief.hookVariants as angles)
            └─► testingPriority[] → A/B test seeding
```

Both packs are now published; the README example above is the canonical Stage 5 marketing flow.

## Differences vs MyndHyve source

**`aiService.complete(...)` → `ctx.callAI(...)`**: source invokes through `PromptPackExecutor` wrapping `aiService`.

**`validateAdAngleBriefOutput` throw → soft-validation drop**: source threw `AdAngleBriefValidationError` on any invalid record. Pack drops invalid briefs with per-brief warnings, so a partial parse returns the valid subset (matches `market-intel.voc-extraction` policy).

**TypeScript enum constraints** → plain string-literal arrays (`VALID_INTENT_STAGES`, `VALID_CTAS`).

**`createScopedLogger('AdAngleBrief')`** → `ctx.log` shim.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `adAngles` + helpers | `src/core/market-intel/prompts/adAngleBrief.ts` | 651 |

~651 LOC TS ported to ~390 LOC pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
