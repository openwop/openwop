# vendor.myndhyve.landing-page

> Seven landing-page executors lifted from MyndHyve's Page Builder. Stage 5 Phase B per /plan + [openwop/openwop#11](https://github.com/openwop/openwop/pull/11) — second canvas-pack track after `vendor.myndhyve.ads-studio-core`.

## Nodes

| typeId | Role | What it does |
|---|---|---|
| `landing.content.generate` | action (AI) | Headlines, sections, CTAs, SEO metadata via `ctx.callAI`. Falls back to hardcoded defaults on AI failure. |
| `landing.structure.create` | action | Convert generated content to a CampaignPage with sections + default theme + tracking shell. |
| `landing.variants.generate` | action (AI) | Per-persona content variants via `ctx.callAI`. Splits traffic evenly. Falls back to identity copy on AI failure. |
| `landing.theme.apply` | action | Apply design-system tokens to a page + variants. Reads `inputs.designSystem` (workflow-supplied); defaults applied when absent. |
| `landing.tracking.setup` | action | Wire pixel IDs, default events, and UTM links. `inputs.trackingIntegrations` is the caller-supplied integration list. |
| `landing.page.validate` | action | Static SEO + accessibility + performance checks. Per-issue list + per-axis score + overall isValid. No external calls. |
| `landing.page.publish` | action | Publish an approved page. Returns URL + per-variant URLs + CDN asset paths. Refuses when `approved: false`. |

## Required host capability

`peerDependencies: { "aiProviders": "supported" }` — `landing.content.generate` and `landing.variants.generate` call `ctx.callAI` directly. The other 5 nodes are pure-logic and would work on any host; the pack-level peer-dep is sized for the heaviest consumer.

## Differences vs. MyndHyve source

**`getAIService().complete(...)` → `ctx.callAI(...)`**: the source pulls in `aiService` from `@/core/ai/services/AIOrchestrationService` and calls its `.complete()` method. The pack uses openwop's standard `ctx.callAI({ provider, model, systemPrompt, messages, temperature, maxTokens })` (returns `{ content, ... }`). Default provider/model is the host's choice; callers can override via `config.provider` + `config.model`.

**Design system reads → `inputs.designSystem` passthrough**: the source dynamically imports `useDesignSystemStore` and calls `.getState()` inside `landing.theme.apply`. The pack accepts an optional `inputs.designSystem` object — workflow author resolves the DS upstream (via a `host.canvas` read OR a future `host.designSystem` capability) and passes it in. When absent OR `designSystem.id !== themeId`, hardcoded defaults apply with a warning log.

**Tracking integrations reads → `inputs.trackingIntegrations` passthrough**: same pattern. The source reads `useIntegrationStore.getState().integrations`; the pack accepts `inputs.trackingIntegrations` as an array of `{ type, enabled, config }` rows.

**ID generators inlined**: `generateSecureId`, `generateShortId`, `generateSlug`, and the `CampaignPageIds.*` entity-prefix functions are inlined as plain `crypto.randomBytes(N).toString('hex')` builders. No `Math.random` fallback paths — Node 20 always has `node:crypto`.

**Rate limits + scoring thresholds inlined as constants**: `RATE_LIMITS.MAX_SECTIONS_PER_PAGE = 20`, `MAX_VARIANTS_PER_PAGE = 10`, `SCORING_THRESHOLDS.MIN_SEO_SCORE = 70`, `MIN_ACCESSIBILITY_SCORE_AA = 80`, `MIN_PERFORMANCE_SCORE = 60`. Pre-baked from `@/core/workflow/utils/constants`.

## Source lineage

| Pack function | MyndHyve TS source | LOC |
|---|---|---|
| 7 executors + helpers | `src/canvas-types/campaign-studio/nodes/pageBuilder/modules.ts` | 1158 |
| Inlined helpers | `src/core/workflow/utils/idGenerator.ts`, `constants.ts` | ~80 |

Roughly 1240 LOC of TypeScript source ported to ~600 LOC of pure JS in this pack.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
