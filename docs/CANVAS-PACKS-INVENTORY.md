# Canvas Packs Inventory

> **Status: Phase A audit (2026-05-12).** Inventory of canvas-bound workflow node types that exist in a real OpenWOP host (myndhyve.ai) but are not yet published as packs at `packs.openwop.dev`. This document drives the publish plan for Phases B–D in the openwop-multi-agent integration track. Pairs with `spec/v1/host-capabilities.md` (the capability surface canvas packs consume).

---

## Why this exists

After the v1.0 publishing milestone (20 packs at `packs.openwop.dev` as of 2026-05-12), the openwop project has demonstrated:

- Pack primitives: framework-level nodes (`core.openwop.*`) signed by an online publisher key.
- Vendor namespaces: external orgs (vendor.myndhyve) hold their own signing key + namespace claim per `spec/v1/registry-operations.md` §Step 1.
- Host-capability mediation: published packs declare `peerDependencies: { "host.canvas": "supported", ... }` and rely on `spec/v1/host-capabilities.md` contracts for canvas state, AI envelope, brand, kanban, web research, etc.

What hasn't been demonstrated yet: **vertical-solution packs** — packs that bundle a coherent set of workflow nodes implementing a complete user-facing canvas (App Builder, Campaign Studio, Landing Page authoring, etc.). The patterns are in place; the proof packs are not.

The myndhyve.ai reference host carries 85 unpublished canvas-bound typeIds today. Publishing them validates the host-capability surface end-to-end and gives the ecosystem reference implementations for full verticals.

---

## Inventory: 85 unpublished canvas-bound typeIds

Source of truth:

- `src/canvas-types/app-builder/nodes/index.ts` — App Builder canvas's editor catalog
- `src/canvas-types/campaign-studio/nodes/index.ts` — Campaign Studio CS_NODE_TYPE_IDS array

Verified absent from `packs.openwop.dev` as of 2026-05-12 (cross-referenced against `GET /v1/index.json`).

### Proposed pack decomposition

The 85 typeIds split naturally along feature lines. Recommended grouping (7 sub-packs) keeps each pack reviewable and independently versionable. All sign with `myndhyve-internal-1` under the existing `vendor.myndhyve.*` namespace claim.

| Pack | typeIds | Count |
|---|---|---|
| `vendor.myndhyve.app-builder` | `app-builder.{checkpoint, generateAPI, generateComponent, generateDataModel, generateDesignSystem, generatePlan, generatePRD, generateScreen, getNextTask, refinePRD}` | 10 |
| `vendor.myndhyve.campaign-studio-ads` | `ads.{brief.extract, copy.generate, creative.validate, export.pack, image.generate, metrics.import, platform.specs, policy.check, publish.platform, tracking.link, video.generate}` | 11 |
| `vendor.myndhyve.campaign-studio-brief` | `brief.{ads.generate, campaign.finalize, carousel.generate, consistency.check, creation.gate, creative.generate, email.generate, kernel.generate, landingpage.generate, social.generate, validate}` | 11 |
| `vendor.myndhyve.campaign-studio-landing-page` | `landing.{content.generate, page.publish, page.validate, structure.create, theme.apply, tracking.setup, variants.generate}` + `lp.{ad-copy, ad-strategy, conversion-optimizer, copywriter, design-assistant, research.crawl, research.market, research.screenshots}` | 15 |
| `vendor.myndhyve.campaign-studio-orchestration` | `campaign.{attribute, create, forecast, launch, metrics, pause, rebalance}` + `setup.{brand.gate, knowledgeBase.gate, media.gate}` + `connector.ingest` + `knowledge.{collection.create, verify}` + `media.review` + `tracking.configure` + `intelligence.recommend` + `optimization.hypotheses` + `kanban.followup.populate` + `content.quality.check` + `brand.compliance.check` | 21 |
| `vendor.myndhyve.market-intel` | `market-intel.{ad-angles, ai-discovery, ai-first-research, research, voc-extraction}` | 5 |
| `vendor.myndhyve.marketing-skills` | `skill.{execute, leadmagnet-concepts, orchestrator, positioning}` + `repurpose.{carousel.generate, content.extract, outline.generate, social.generate, source.select}` + `social.{carousel.export, carousel.media.match, carousel.render, image.analyze}` | 13 |
| **Total** | | **85** |

---

## Category audit (Cat I / Cat II / Cat III)

For each typeId's executor we ask: what does it import beyond the openwop runtime + standard `host.*` capability surface?

**Method:** scanned all `src/canvas-types/*/nodes/**/*.ts` files (40 files), aggregated non-type imports. Heavy domain logic referenced by the executors lives in `src/core/<domain>/` and bundles into the pack tarball's `index.mjs` at build time.

### Category I — host-capability proxy (refactor in place)

Imports that map cleanly to existing OpenWOP host capabilities or engine utilities:

| Import | Maps to | Action |
|---|---|---|
| `@/core/utils/logger` (19 uses) | `ctx.log(...)` | Replace with engine-provided logger |
| `@/core/ai/services/AIOrchestrationService` (1) | `ctx.callAI(...)` (host.aiEnvelope) | Replace with `ctx.callAI()` |
| `@/core/workflow/services/approvalRequest` (5) | Engine-provided via ctx | Replace |
| `@/core/workflow/nodes/utils/legacyContextShim` (2) | Engine adapter (already openwop-compatible) | Drop on full rewrite |
| `@openwop/workflow-engine` (5) | Peer dependency (already correct) | Keep |
| `zod` (5) | Bundle in pack | Keep |

All 19 logger uses are trivially `ctx.log()`. The single `AIOrchestrationService` use refactors to `ctx.callAI()`. The approval-request uses already work through engine primitives in the new pack model.

### Category II — myndhyve-specific business logic

Imports that don't map to existing host capabilities. **All bundleable inside the pack tarball** (Category II.a) — no new `host.*` capability needs to be added to the spec for Phase A.

| Import | Used by | Bundling strategy |
|---|---|---|
| `@/core/market-intel/services/AIDiscoveryExecutor` (1) | `market-intel.ai-discovery` executor | Bundle service impl in `vendor.myndhyve.market-intel` pack |
| `@/core/wop/services/WopStackItemFirestoreService` (1) | Stack-item lifecycle helper | Bundle in pack (or refactor to use engine's stack-item API) |
| `@/core/wop/services/WopObjectiveBootstrap` (1) | Objective seeding helper | Bundle (or refactor) |

All three are myndhyve-specific helpers that don't generalize to other openwop hosts. Bundling them inside the pack means another host installing the pack gets the helper code — but the pack still relies on `host.entities`, `host.canvas`, `host.aiEnvelope` for the cross-host abstractions. This is the same pattern `vendor.myndhyve.web-research` (already published) uses.

### Category II.b — candidates for new `host.*` capabilities (NONE in Phase A)

Reserved for follow-up. The audit didn't surface a clear case where two or more canvas packs need a shared myndhyve-specific service that should be lifted to a new host capability. Phase B's actual implementation work may surface candidates — if so, `host-capabilities.md` gets new sections in those PRs, not in this one.

### Category III — myndhyve-specific data schemas

Type-only imports from `@/core/market-intel/types`, `@/core/workflow/types`, etc. Bundle the relevant type definitions inline in the pack's `pack.json` `nodes[].inputSchemaRef` / `outputSchemaRef` files. The legacy myndhyve TypeScript types don't ship with the pack — only their JSON Schema projection.

---

## Phase A → B → C → D delivery plan

### Phase A (this doc)

- Inventory + classification published as `docs/CANVAS-PACKS-INVENTORY.md` (this PR).
- No code changes. No new packs. No spec promotions.
- Establishes the per-pack scope + per-typeId classification that drives Phases B–D.

### Phase B — App Builder pack (forcing-function reference)

- Single PR adding `~/dev/openwop/packs/vendor.myndhyve.app-builder/` source tree.
- 10 nodes, all Category I after refactor.
- Executors call `ctx.callAI()` + `ctx.host.canvas.write()` + `ctx.host.entities.read()`.
- Bundles app-builder-specific JSON schemas for PRD / DesignSystem / Plan artifact types.
- Built + signed by `myndhyve-internal-1`, published via the WIF auto-deploy pipeline.
- Conformance scenario `pack-fetch-verify-vendor-myndhyve-app-builder.test.ts` validates against the openwop reference host.

### Phase C — Campaign Studio sub-packs (5 PRs)

One PR per sub-pack:

1. `vendor.myndhyve.campaign-studio-ads` (11 nodes)
2. `vendor.myndhyve.campaign-studio-brief` (11 nodes)
3. `vendor.myndhyve.campaign-studio-landing-page` (15 nodes)
4. `vendor.myndhyve.campaign-studio-orchestration` (21 nodes)
5. `vendor.myndhyve.market-intel` (5 nodes)
6. `vendor.myndhyve.marketing-skills` (13 nodes)

Same publish pipeline. Each pack is independently reviewable, versionable, deprecable.

### Phase D — Conformance + spec promotion

After all canvas packs are published:

- `spec/v1/host-capabilities.md` status DRAFT → ACTIVE (the published packs become the proof-of-implementation).
- Conformance suite gains a `canvas-packs.test.ts` scenario suite — one scenario per canvas pack, validating end-to-end fetch + sig-verify + dispatch + execute through host-capability indirection.
- `INTEROP-MATRIX.md` updated with the canvas-pack row.

After Phase D: `packs.openwop.dev` carries ~28 packs covering ~178 typeIds. Myndhyve canvas-bound workflows run entirely through the openwop host-capability layer. Another openwop host (e.g., the reference postgres host) can install the App Builder pack and execute its workflows without myndhyve-specific code.

---

## Out of scope for canvas packs

The audit found multiple typeId-shaped strings in myndhyve source that are **NOT** workflow nodes and **MUST NOT** be published as packs:

| Pattern | Count | What they are |
|---|---|---|
| `artifact.*` | ~18 | Discriminators for kinds of stored output (e.g., `artifact.appConcept` is "this entity is a PRD"). Belongs in canvas-state schema, not a node pack. |
| `collection.*` | ~22 | Discriminators for kinds of entity stores. Same as `artifact.*` — canvas-state schema. |
| Canvas type IDs | ~10 | Top-level canvas identifiers (`slides`, `cad`, `documents`, etc.) consumed by the canvas registry, not a node pack. |
| Email-blocklist strings | ~20 | False-positive matches from disposable-email blocklists in CRM modules (`tempmail`, `mailinator`, etc.). Not typeIds at all. |

These were filtered out of the 85-typeId inventory above. Publishing them would be a category error.

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
- [`docs/PUBLISHING.md`](./PUBLISHING.md) — SDK + conformance publishing (different artifact class, same release cadence)
