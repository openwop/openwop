# Canvas Packs Inventory

> **Status: Phases A+B+C COMPLETE as of 2026-05-13.** All 30 audited canvas-bound executors are now published at `packs.openwop.dev`, plus 6 additional packs that emerged during the publish work (decomposing multi-platform executors into platform-specific packs, separating compositional primitives from orchestrators). Phase D (spec promotion + workflow-chain RFC) remains. See "Delivery log — Phases B+C" below.
>
> **Revision history:**
> - v1 (2026-05-12): initial inventory — 85 typeIds across 7 sub-packs. **Incorrectly conflated editor presets with real executors.**
> - v2 (2026-05-12): corrected to **30 real `defineNode()` executors** across 4 sub-packs after auditing actual `defineNode(` call sites. The 55 dropped typeIds are editor presets (drag-tile abstractions that map to pre-configured `core.ai.callPrompt` workflows in the runtime). They are NOT pack-publishable as node typeIds; a separate publishing mechanism (workflow-template packs, future spec extension) is the right home.
> - **v3 (2026-05-13, this revision): closure status.** Phases B+C delivered across 23 PRs. The 30 audited executors decomposed into 17 published packs (more than the v2-proposed 4 sub-packs) — see decomposition log below.

---

## Delivery log — Phases B+C (2026-05-13)

The v2 plan proposed a 4-sub-pack decomposition. Actual delivery ended up with **17 packs** as decomposition choices became clearer during implementation. Each typeId is published at packs.openwop.dev under `vendor.myndhyve.*`:

| Audited typeId | Final pack | Notes |
|---|---|---|
| **app-builder** (2) | | |
| `app-builder.iterate-tasks` | `vendor.myndhyve.app-builder@1.0.0` | Multi-task loop; ports `iterateTasksExecutor.ts`. Drops host-side concerns (progress cards, telemetry, pilot materializer, engine-internal envelope routing). |
| `app-builder.per-screen` | `vendor.myndhyve.app-builder@1.0.0` | Single-screen; ports `perScreenExecutor.ts`. Shares `buildPerScreenPrompt` + `categorizeFailure` with iterate-tasks (same pack). |
| **ads-studio** (15 → split across 13 packs) | | |
| `ads.brief.extract` + `ads.tracking.link` | `vendor.myndhyve.ads-tools` | Pure-logic, no AI; bundled. |
| `ads.brief.build` + `ads.variant.plan` + `ads.video.qa` + `ads.winner.synthesize` | `vendor.myndhyve.ads-studio-core` | AI orchestration cohort; bundled per shared coupling. |
| `ads.platform.specs` | `vendor.myndhyve.ads-platforms` | Pure-data platform-spec registry. |
| `ads.policy.check` | `vendor.myndhyve.ads-policy` | Text rules only. |
| `ads.creative.validate` | `vendor.myndhyve.ads-creative-validate` | Text rules + asset-format + placement-length. |
| `ads.export.pack` | `vendor.myndhyve.ads-export` | Pure-logic export packager. |
| `ads.copy.generate` | `vendor.myndhyve.ads-copy-generate` | First `aiProviders` consumer in cohort. |
| `ads.image.generate` | `vendor.myndhyve.ads-image-generate` | First `aiProviders.imageGeneration` consumer (sub-cap added in spec PR #48). |
| `ads.video.generate` | `vendor.myndhyve.ads-video-generate` | First `aiProviders.videoGeneration` consumer (sub-cap added in spec PR #53). |
| `ads.metrics.import` | `vendor.myndhyve.ads-metrics-import` | Pure-logic aggregation; audit-corrected scope (source is client-side cache, not API fetcher). |
| `ads.publish.platform` → **split into 3 platform packs** | | |
| → `ads.publish.meta` | `vendor.myndhyve.ads-publish-meta` | Meta Marketing API v21.0. First `secrets.resolveInPack` consumer (spec PR #52). |
| → `ads.publish.google` | `vendor.myndhyve.ads-publish-google` | Google Ads API v18. 2-secret (OAuth + developer-token), REVERSE rollback. |
| → `ads.publish.tiktok` | `vendor.myndhyve.ads-publish-tiktok` | TikTok Marketing API v1.3. `Access-Token` header, business-code envelope, no rollback. |
| **landing-page** (7) | `vendor.myndhyve.landing-page` | Single pack with 7 typeIds. `peerDeps: { aiProviders: supported }` for the content-generate + variants-generate nodes. |
| **campaign-sequence** (6 → split into 2 packs) | | |
| `campaign.sequence.{wait, tag, condition}` | `vendor.myndhyve.campaign-sequence` | Pure-logic triggers; no host capability. |
| `campaign.sequence.{email, sms, webhook}` | `vendor.myndhyve.campaign-sequence-integration` | `peerDeps: { host.campaignMessaging: supported }` — integration channels. |

### Additional packs that emerged (beyond the audited 30)

The publish work surfaced 11 more publishable typeIds across 10 new packs that weren't in the v2 audit but proved tractable during the porting:

- `vendor.myndhyve.knowledge-tools` — 2 typeIds (`knowledge.retrieve`, `knowledge.augment-prompt`). First `host.knowledge` consumer (spec PR #37 added the sub-cap).
- `vendor.myndhyve.market-intel-voc` — `market-intel.voc-extraction`. Lifted from in-tree prompt-pack code that wasn't an explicit canvas-types executor but was workflow-published.
- `vendor.myndhyve.market-intel-ad-angles` — `market-intel.ad-angles`. Same provenance.
- `vendor.myndhyve.market-intel-discovery` — `market-intel.ai-discovery`. Same.
- `vendor.myndhyve.market-intel-opportunity-scoring` — `market-intel.opportunity-scoring`. Same.
- `vendor.myndhyve.market-intel-content-extraction` — `market-intel.content-extraction`. Same.
- `vendor.myndhyve.market-intel-thread-triage` — `market-intel.thread-triage`. Same.
- `vendor.myndhyve.market-intel-audience-targeting` — `market-intel.audience-targeting`. Same.
- `vendor.myndhyve.market-intel-query-builder` — `market-intel.query-builder`. Same.
- `vendor.myndhyve.market-intel-community-rank` — `market-intel.community-rank`. Same.

These market-intel packs were originally workflow-internal prompt-packs; publishing them as standalone composable nodes was an extension of the inventory scope (in the spirit of the audit, not strictly within it). They're documented separately in `examples/market-intel-pipeline/README.md`.

### Spec extensions that landed during Phases B+C

Four spec PRs added the host-capability surface the new packs depend on:

| PR | Spec section | Sub-capability | Used by |
|---|---|---|---|
| #37 | `§host.knowledge` | `host.knowledge` (RAG retrieval) | `knowledge-tools` |
| #48 | `§host.aiProviders` | `aiProviders.imageGeneration` (`ctx.callImageGenerator`) | `ads-image-generate` |
| #52 | `§host.secrets` | `secrets.resolveInPack` (`ctx.secrets.resolve`) | `ads-publish-{meta,google,tiktok}` |
| #53 | `§host.aiProviders` | `aiProviders.videoGeneration` (`ctx.callVideoGenerator`) | `ads-video-generate` |

PR #48 also formalized the de-facto `ctx.callAI` contract (which 14+ already-published packs depend on but wasn't normatively spec'd; the `core.openwop.ai` README explicitly noted this gap).

### Registry status (post-Phases B+C)

`packs.openwop.dev` now hosts **48 packs** with **44 vendor typeIds** under `vendor.myndhyve.*` (plus the framework `core.openwop.*` packs). The four canvas verticals from the v2 audit (App Builder, Ads Studio, Landing Page, Campaign Sequence) are fully expressible as DAGs of published packs.

Discovery surfaces:

- [`docs/PACK-CATALOG.md`](./PACK-CATALOG.md) — categorized inventory of every published pack with one-line descriptions, grouped by domain (framework / identity / canvas verticals / marketIntel / ads / campaign-sequence) plus a "Use cases → which packs" composition table.
- [`examples/market-intel-pipeline/`](../examples/market-intel-pipeline/) — VoC research → ad-angle pipeline (9 packs composed declaratively; 2 entry variants).
- [`examples/ads-publish-pipeline/`](../examples/ads-publish-pipeline/) — creative generation → platform publish (8 packs composed declaratively; 3 sibling variants targeting Meta / Google / TikTok). Composes downstream of the marketIntel pipeline via `audience-targeting.outputs.targetingPacks`.

---

## Why this exists

After the v1.0 publishing milestone (20 packs at `packs.openwop.dev` as of 2026-05-12), the openwop project has demonstrated:

- Pack primitives: framework-level nodes (`core.openwop.*`) signed by an online publisher key.
- Vendor namespaces: external orgs (vendor.myndhyve) hold their own signing key + namespace claim per `spec/v1/registry-operations.md` §Step 1.
- Host-capability mediation: published packs declare `peerDependencies: { "host.canvas": "supported", ... }` and rely on `spec/v1/host-capabilities.md` contracts for canvas state, AI envelope, brand, kanban, web research, etc.

What hasn't been demonstrated yet: **vertical-solution packs** — packs that bundle a coherent set of workflow nodes implementing a complete user-facing canvas (App Builder, Campaign Studio, Landing Page authoring, etc.). The patterns are in place; the proof packs are not.

The myndhyve.ai reference host carries 85 unpublished canvas-bound typeIds today. Publishing them validates the host-capability surface end-to-end and gives the ecosystem reference implementations for full verticals.

---

## Inventory: 30 real custom executors in `src/canvas-types/`

Source of truth: `grep -rE 'defineNode\(\{' src/canvas-types/` returns 30 unique `id:` values. Each one has a custom `execute` function and merits a pack entry. Editor-preset typeIds without `defineNode()` calls (drag-tile abstractions that the workflow author replaces with `core.ai.callPrompt` configurations) are documented separately in §"Editor presets — not pack-publishable".

Verified absent from `packs.openwop.dev` as of 2026-05-12 (cross-referenced against `GET /v1/index.json`).

### Proposed pack decomposition (30 executors → 4 sub-packs)

All sign with `myndhyve-internal-1` under the existing `vendor.myndhyve.*` namespace claim.

| Pack | typeIds | Count | LOC range (est.) |
|---|---|---|---|
| `vendor.myndhyve.app-builder` | `app-builder.{iterate-tasks, per-screen}` | 2 | 794 + 272 = 1066 |
| `vendor.myndhyve.ads-studio` | `ads.{brief.build, brief.extract, copy.generate, creative.validate, export.pack, image.generate, metrics.import, platform.specs, policy.check, publish.platform, tracking.link, variant.plan, video.generate, video.qa, winner.synthesize}` | 15 | ~3000–6000 |
| `vendor.myndhyve.campaign-sequence` | `campaign.sequence.{condition, email, sms, tag, wait, webhook}` | 6 | ~1500–3000 |
| `vendor.myndhyve.landing-page` | `landing.{content.generate, page.publish, page.validate, structure.create, theme.apply, tracking.setup, variants.generate}` | 7 | ~2000–4000 |
| **Total** | | **30** | **~7500–14000** |

### Per-executor refactor effort (REVISED ESTIMATE)

Earlier v1 of this doc claimed Category I (host-capability proxy) covered most executors. **That was wrong** — auditing real executor files shows tight coupling:

- `iterateTasksExecutor.ts` (794 LOC): 10+ myndhyve-specific imports incl. `@/core/workflow/services/ExecutionContextFactory`, `@/core/workflow/security/envelopeTypeMatcher`, `@/core/workflow/engine/stepNodeTracking`, `@/core/workflow/config/WorkflowRuntimeConfig`, `@/core/workflow/iteration/progressReporter`, `@/core/ai/types/models`.
- `adsBriefExtractNode` executor: reads `useCampaignStudioStore.getState()` directly + imports `AdBriefExtractorService` (myndhyve domain service).

Each executor needs:

1. **Map each myndhyve-internal import to a `host.*` capability call OR bundle the dependency into the pack tarball.** Engine-internal utilities (`stepNodeTracking`, `progressReporter`, `WorkflowRuntimeConfig`) should be exposed via the engine's NodeContext (`ctx`) — if they aren't already, the engine package needs the extension first.
2. **Zustand store access → host capability.** `useCampaignStudioStore.getState()` becomes `ctx.host.canvas.read({ scope: 'currentPage' })` or similar. This requires either an existing `host.canvas` method that returns the right shape, OR a new method added to `spec/v1/host-capabilities.md` §host.canvas.
3. **Re-author JSON schemas** for input/output/config. Existing TypeScript `z.object({...})` declarations project to JSON Schema, but the canonical openwop pack expects standalone `.json` files.
4. **Bundle domain services** that don't have host-capability equivalents into the pack's `index.mjs`.
5. **Replace logging** (`createScopedLogger`) with `ctx.log()`.

Realistic effort per executor: **2–8 hours** depending on coupling depth. The 30 executors total: **60–240 person-hours.**

This is real engineering, not docs work. The phased delivery in §"Phase A → B → C → D delivery plan" still holds, but each phase is a multi-PR commitment, not a single PR.

---

## Coupling audit — what each executor actually imports

**v1 categorized executors as mostly Category I (trivial host-capability proxy). v2 audit of two representative executors shows much deeper coupling.**

### Sample 1: `app-builder.iterate-tasks` (794 LOC)

Top of `src/canvas-types/app-builder/nodes/iterateTasksExecutor.ts`:

```typescript
import { createScopedLogger } from '@/core/utils/logger';
import type { ExecutionContext, WorkflowEvent } from '@/core/workflow/types';
import type { ExtendedExecutionContext } from '@/core/workflow/services/ExecutionContextFactory';
import type { ChatCardDefinition } from '@/core/workflow/types/chatIntegration';
import { matchEnvelopeTypeStrict } from '@/core/workflow/security/envelopeTypeMatcher';
import type { PlanModel, PlanStep, PrdModel, ThemeTokensModel } from '@/core/ai/types/models';
import { pushStepNode, popStepNodeForNode } from '@/core/workflow/engine/stepNodeTracking';
import { getConfigForRun, getWorkflowRuntimeConfig } from '@/core/workflow/config/WorkflowRuntimeConfig';
import { createIterationProgressReporter } from '@/core/workflow/iteration/progressReporter';
```

10 myndhyve-specific imports. Engine internals like `pushStepNode`, `popStepNodeForNode`, `getConfigForRun`, `WorkflowRuntimeConfig`, `progressReporter` are NOT currently exposed through `NodeContext` in the openwop engine package. Making this executor portable requires either extending the engine's `ctx` surface OR bundling shims for these internals into the pack.

### Sample 2: `ads.brief.extract` (~70 LOC executor body)

```typescript
const { getAdBriefExtractor } = await import('../../ads-studio/brief/AdBriefExtractorService');
const { useCampaignStudioStore } = await import('../../stores/campaignStudioStore');
// ...
const storeState = useCampaignStudioStore.getState();
const sections = storeState.sections ?? [];
const pageTitle = storeState.currentPage?.name ?? 'Untitled Page';
const pageDescription = storeState.seoMetadata?.description;
```

Reads myndhyve Zustand store directly. **No openwop-mediated equivalent exists.** Making this portable requires either:

1. Extending `spec/v1/host-capabilities.md` §host.canvas with a method returning current page state (sections, SEO metadata) — spec work.
2. OR the host shim wraps `useCampaignStudioStore` exposure behind `ctx.host.canvas.read({ scope: 'currentPage' })` at engine-registration time — host-implementation work; spec stays unchanged.

Either path is real engineering, not a docs change.

### Realistic per-executor classification

After auditing two executors, every remaining executor MUST be audited individually. The v1 categorization (Cat I / II / III with stage-based grouping) was too optimistic — the actual mix is:

- **Engine-internal API extensions needed**: many executors call `@/core/workflow/engine/*` or `@/core/workflow/services/*` utilities that should be exposed via `NodeContext` in the openwop engine package. Where the openwop engine doesn't already expose these, the engine package needs a release.
- **Zustand store reads**: every ads.* + landing.* executor likely reads `useCampaignStudioStore` or similar. Needs `host.canvas.read({ ... })` method extensions.
- **Domain services**: bundle inside the pack tarball (Category II.a from v1) — this part of v1 holds.
- **Type-only imports**: project to JSON Schema (Category III from v1) — this part holds.

Net effect: per-executor refactor effort is **2–8 hours**, not minutes. The 30 executors total: **60–240 person-hours**.

---

## Phase A → B → C → D delivery plan

### Phase A (this doc)

- Inventory + classification published as `docs/CANVAS-PACKS-INVENTORY.md` (this PR).
- No code changes. No new packs. No spec promotions.
- Establishes the per-pack scope + per-typeId classification that drives Phases B–D.

### Phase B — App Builder pack (forcing-function reference)

- Single PR adding `~/dev/openwop/packs/vendor.myndhyve.app-builder/` source tree.
- 2 real executors (`app-builder.iterate-tasks` + `app-builder.per-screen`), 1066 LOC combined in current myndhyve source.
- Refactor scope per executor: replace engine-internal imports with `ctx.*` accessors; bundle `iterateTasksExecutor` + `perScreenExecutor` business logic inside the pack tarball; project `z.object` schemas to standalone JSON Schema files.
- Likely needs new `host.canvas` methods for iteration state (the iterate executor tracks per-task progress via myndhyve-internal services). Add to `spec/v1/host-capabilities.md` §host.canvas in same PR.
- Estimated effort: **8–16 hours** of focused engineering (not minutes).
- Conformance scenario `pack-fetch-verify-vendor-myndhyve-app-builder.test.ts` validates against the openwop reference host.

### Phase C — Ads Studio + Landing Page + Campaign Sequence (3 PRs)

One PR per sub-pack, each independently reviewable + versionable:

1. `vendor.myndhyve.ads-studio` (15 executors) — biggest pack; biggest refactor effort. Each ads.* executor reads canvas state via `useCampaignStudioStore.getState()` directly today; needs `host.canvas.read({ scope: 'currentPage' })` or similar.
2. `vendor.myndhyve.landing-page` (7 executors)
3. `vendor.myndhyve.campaign-sequence` (6 executors) — likely the smallest coupling depth (sequence machinery is mostly time-based, less canvas-state-dependent).

Each PR's effort: **8–40 hours** depending on coupling depth + new host-capability additions.

### Phase D — Spec promotion + ecosystem

After all 4 canvas packs are published:

- `spec/v1/host-capabilities.md` status DRAFT → ACTIVE (the published packs become the proof-of-implementation).
- New RFC opened for workflow-chain packs (the right home for the 55 editor-preset typeIds dropped from Phase B–C scope).
- Conformance suite gains a `canvas-packs.test.ts` scenario suite — one scenario per canvas pack, validating end-to-end fetch + sig-verify + dispatch + execute through host-capability indirection.
- `INTEROP-MATRIX.md` updated with the canvas-pack row.

After Phase D: `packs.openwop.dev` carries ~24 packs covering ~123 typeIds (20 already-published + 4 new canvas packs adding 30 typeIds). Myndhyve canvas-bound runtime workflows run entirely through the openwop host-capability layer. Another openwop host (e.g., the reference postgres host) can install the App Builder pack and execute its workflows without myndhyve-specific code.

---

## Editor presets — not pack-publishable (55 typeIds)

The v1 inventory included 55 typeIds in `src/canvas-types/*/nodes/index.ts` declarations that **do NOT have `defineNode()` executor implementations**. They exist solely as editor catalog entries (e.g., `app-builder.generatePRD` shows up as a labeled tile in the App Builder palette). When the workflow author drops one onto the canvas, the editor expands it into a pre-configured `core.ai.callPrompt` node with a specific prompt template, envelope type, and config.

Confirmed by inspecting `src/seeds/workflows/app-builder/appCreationWorkflow.ts`: the running workflow uses `core.ai.callPrompt` (11 instances) + `app-builder.iterate-tasks` (1 instance), NOT `app-builder.generatePRD`. The "Generate PRD" tile is a UI abstraction over a callPrompt instance.

**Why they don't go to packs.openwop.dev as node packs:**

A pack entry's `typeId` MUST have a runtime executor (per `spec/v1/node-packs.md`). Publishing `app-builder.generatePRD` without an executor produces a pack that crashes at dispatch with `unknown_typeid` on any consumer host. The right home for these abstractions:

1. **Workflow-chain packs** (proposed future spec extension): a pack that bundles pre-configured workflow segments. Authors get the "drag a labeled tile" UX; the runtime gets concrete `core.*` typeIds. Spec work needed.
2. **Canvas-internal abstractions**: keep them in the host's canvas registry (where they live today), don't publish. Other hosts implementing the same canvas re-author their own preset library.

**Recommendation**: Phase D (after the 30 real executor publishes land) opens an RFC for workflow-chain packs as the principled long-term home for these 55 abstractions.

## Out of scope (NOT typeIds at all)

False-positive matches surfaced during the inventory pass:

| Pattern | Count | What they are |
|---|---|---|
| `artifact.*` | ~18 | Discriminators for kinds of stored output. Canvas-state schema, not a node pack. |
| `collection.*` | ~22 | Discriminators for kinds of entity stores. Canvas-state schema, not a node pack. |
| Canvas type IDs | ~10 | Top-level canvas identifiers (`slides`, `cad`, `documents`, etc.) consumed by the canvas registry, not a node pack. |
| Email-blocklist strings | ~20 | False-positive matches from disposable-email blocklists in CRM modules (`tempmail`, `mailinator`, etc.). Not typeIds at all. |

Publishing any of these as packs would be a category error.

---

## Open questions for Phase B

These don't block this PR but the Phase B (App Builder) PR will need answers:

1. **Bundling strategy for app-builder schemas.** App Builder's PRD artifact has a complex schema (sections, audiences, success metrics, etc.). Should the schemas be authored inline in the pack source tree, or imported from myndhyve and JSON-Schema-projected at build time? The latter is closer to the canonical source; the former is more portable.

2. **Multi-module pack contents.** `scripts/build-pack-tarball.mjs` today bundles a single `index.mjs` entry. App Builder's 10 executors are non-trivial — splitting into separate `*.node.js` files per typeId may improve maintainability. Verify the build script supports this OR extend it.

3. **App Builder's `iterateTasksExecutor`.** The per-task iteration pattern (auto-play through tasks) is currently myndhyve-specific. Should it be a pack-level concern or a host capability? Likely the latter, but Phase B will validate.

These get resolved during Phase B implementation, not now.

---

## See also

- [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) — pack manifest format, registry HTTP API, `peerDependencies` for host capabilities
- [`spec/v1/host-capabilities.md`](../spec/v1/host-capabilities.md) — `host.*` capability surface
- [`spec/v1/registry-operations.md`](../spec/v1/registry-operations.md) — namespace claims, signing keys, publish lifecycle
- [`registry/README.md`](../registry/README.md) — publish workflow against `packs.openwop.dev`
- [`PUBLISHING.md`](../PUBLISHING.md) — SDK + conformance publishing (different artifact class, same release cadence)
