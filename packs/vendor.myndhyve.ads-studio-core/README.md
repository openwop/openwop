# vendor.myndhyve.ads-studio-core

> Four pure-logic Ads Studio executors. Stage 5 Phase A pilot per the executor-migration plan in [openwop/openwop#11](https://github.com/openwop/openwop/pull/11). All four are deterministic — no AI calls, no host capabilities required beyond the core NodeContext.

## Nodes

| typeId | Role | Source service | What it does |
|---|---|---|---|
| `ads.brief.build` | action | `CreativeBriefBuilder` | Builds a CreativeBrief in three modes: `manual` (from CreativeBriefInput + targetAudience/sellingPoints), `extraction` (extend an existing AdBrief with resolved fields), `merge` (overlay partial fields). |
| `ads.variant.plan` | action | `VariantPlanService` | Three modes: `create` a new VariantPlan from axes + constraints; `generate` a variant matrix (cartesian product → constraint filter → balanced/focused truncation → slug per naming convention); `validate` returns issues + estimated count. |
| `ads.video.qa` | action | `VideoQAService` | Runs 5 check categories on a video storyboard: legibility (reading speed + text scale), safe-zone compliance, duration limits, text density, claims policy. Returns per-check pass/fail + an overall score. |
| `ads.winner.synthesize` | action | `WinnerSynthesisService` | Synthesizes A/B test outcomes — aggregate stats, insights (winner/no_winner/low_data/trend/efficiency), priority-ordered next-test suggestions, optional markdown report. |

## Pure-logic guarantees

Every executor:

- Reads only `ctx.inputs` + `ctx.config` + optionally `ctx.log` for diagnostics
- Calls no host capabilities — no `ctx.callAI`, no `ctx.chat`, no `ctx.suspend`
- Returns deterministic output for deterministic input (modulo `crypto.randomUUID()` + `new Date().toISOString()` for record metadata)
- Never throws on validation failure — surfaces as `success: false` (brief) or `validation.valid: false` (variant plan) in outputs

## Differences vs. MyndHyve source

- `createScopedLogger` replaced with a `ctx.log` shim (when host provides one); silent otherwise
- `createSimpleService` singleton factory replaced with plain functions (no service mutation across calls)
- Zod schemas at the boundary replaced with the pack's JSON Schemas — the host validates inputs at dispatch time
- VideoQA's optional `PlatformSpecRegistry` + `AdComplianceBridge` dynamic imports **dropped**. Callers wanting safe-zone / duration / claims checks inject `safeZones` / `videoSpec` / `checkClaimsFn` via `inputs.options`. The MyndHyve in-tree executor still supports the registry fallback; the pack version surfaces the same checks via explicit injection only — keeps the pack self-contained.

## Source lineage

| Pack function | MyndHyve TS source | LOC |
|---|---|---|
| `briefBuild` + helpers | `src/canvas-types/campaign-studio/ads-studio/brief/CreativeBriefBuilder.ts` | 354 |
| `variantPlan` + helpers | `src/canvas-types/campaign-studio/ads-studio/strategy/variant-plan/VariantPlanService.ts` | 425 |
| `videoQA` + helpers | `src/canvas-types/campaign-studio/video-studio/qa/VideoQAService.ts` | 532 |
| `winnerSynthesize` + helpers | `src/canvas-types/campaign-studio/ads-studio/testing/synthesis/WinnerSynthesisService.ts` | 312 |

Roughly 1620 LOC of TypeScript source ported to ~700 LOC of pure JS in this pack.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
