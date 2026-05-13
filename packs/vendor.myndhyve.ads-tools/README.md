# vendor.myndhyve.ads-tools

> Two pure-logic Ads Studio executors. Stage 5 continuation per [openwop/openwop#11](https://github.com/openwop/openwop/pull/11). No host capabilities required.

## Nodes

| typeId | Role | Behavior |
|---|---|---|
| `ads.brief.extract` | action | Derives an `AdBrief` from page sections — extracts headlines/descriptions/CTAs/bullets/testimonials/stats by section type, dedupes, infers selling points + tone, generates default angles. |
| `ads.tracking.link` | action | Builds UTM-tagged tracking URLs with platform-specific click ID macros. Supports 9 platforms; multi-platform batch mode emits one link per platform. |

## Pure-logic guarantees

Both executors:
- Read only `ctx.inputs` + `ctx.config` + optional `ctx.log`
- No `ctx.callAI`, no `ctx.chat`, no host capabilities
- Deterministic output for deterministic input (modulo `crypto.randomUUID()` + `new Date()` for record metadata)

## Differences vs MyndHyve source

**`useCampaignStudioStore.getState()` → `inputs.sections`/`pageTitle`/`pageDescription`**: MyndHyve's in-tree `ads.brief.extract` dynamically imports the campaign-studio store and reads `currentPage` + `sections` + `seoMetadata.description`. The pack accepts those values as inputs — workflow author resolves them upstream (via a `host.canvas` read OR direct passthrough from an earlier node).

**Service-factory + ScopedLogger** → plain functions + `ctx.log` shim.

**Type imports** stripped (TypeScript erases at compile time anyway).

**9 platform lookup tables** (PLATFORM_UTM_SOURCES, PLATFORM_UTM_MEDIUMS, PLATFORM_CLICK_ID_PARAMS, PLATFORM_MACROS) → inlined as plain JS objects in the pack. Same data; no separate types file.

## Tracking platforms supported

`meta`, `google`, `tiktok`, `linkedin`, `x`, `pinterest`, `snapchat`, `reddit`, `amazon`. Each has its own UTM source/medium convention + click-id macro (`fbclid` / `gclid` / `ttclid` / etc.) and creative-ID placeholder.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `briefExtract` + helpers | `ads-studio/brief/AdBriefExtractorService.ts` | 430 |
| `trackingLink` + helpers | `ads-studio/tracking/TrackingLinkBuilder.ts` + `constants.ts` + `tracking/types.ts` (lookup tables) | ~370 |

~800 LOC of TS ported to ~440 LOC of pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
