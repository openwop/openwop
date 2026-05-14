# OpenWOP Pack Catalog

> Snapshot of every signed pack published at [`packs.openwop.dev`](https://packs.openwop.dev) as of **2026-05-13**. Grouped by domain (not alphabetical) so workflow authors can find what they need by use case. Live registry: [`/v1/index.json`](https://packs.openwop.dev/v1/index.json). Authoring guide: [`docs/AUTHORING-CANVAS-PACKS.md`](AUTHORING-CANVAS-PACKS.md). Architecture rationale: [`docs/CANVAS-PACKS-INVENTORY.md`](CANVAS-PACKS-INVENTORY.md).

**Catalog status:** 48 packs published. All signed under one of three keychains (`openwop-registry-root` for framework + community packs, `myndhyve-internal-1` for `vendor.myndhyve.*`, `vendor.openwop.*` for the rust-hello demo). Catalog updates on each merged pack-publishing PR.

---

## Framework primitives (`core.openwop.*`)

Spec-canonical typeIds. Required by most non-trivial workflows. Signed by `openwop-registry-root`.

| Pack | Purpose |
|---|---|
| [`core.openwop.ai`](https://packs.openwop.dev/v1/packs/core.openwop.ai/index.json) | 4 nodes: `core.ai.chatCompletion` (free-form chat), `core.ai.structuredOutput` (typed-envelope output), `core.ai.toolCalling` (tool-use loop), `core.openwop.ai.embeddings`. The bedrock AI-call primitives every workflow consuming `host.aiProviders` uses. |
| [`core.openwop.triggers`](https://packs.openwop.dev/v1/packs/core.openwop.triggers/index.json) | Workflow trigger primitives — webhook, schedule, manual. |
| [`core.openwop.data`](https://packs.openwop.dev/v1/packs/core.openwop.data/index.json) | Data shaping + structural primitives — pure transforms over workflow state. |
| [`core.openwop.http`](https://packs.openwop.dev/v1/packs/core.openwop.http/index.json) | Generic HTTP request primitives for hosts that advertise general fetch. |
| [`core.openwop.integration`](https://packs.openwop.dev/v1/packs/core.openwop.integration/index.json) | Integration-layer primitives — connector glue + adapter shapes. |
| [`core.openwop.mcp`](https://packs.openwop.dev/v1/packs/core.openwop.mcp/index.json) | MCP (Model Context Protocol) bridge primitives. |
| [`core.openwop.examples`](https://packs.openwop.dev/v1/packs/core.openwop.examples/index.json) | Reference example workflows demonstrating multi-pack composition. |
| [`core.openwop.agent-examples`](https://packs.openwop.dev/v1/packs/core.openwop.agent-examples/index.json) | Reference agent-pack examples per RFC 0003. |
| [`community.openwop-team.demo`](https://packs.openwop.dev/v1/packs/community.openwop-team.demo/index.json) | Community-tier demo pack (separate `community.openwop-team-1` signing key). |
| [`vendor.openwop.rust-hello`](https://packs.openwop.dev/v1/packs/vendor.openwop.rust-hello/index.json) | "Hello world" Rust-wasm node demonstrating multi-language support per RFC 0008. |

## Identity + general-purpose (`vendor.myndhyve.*`)

Reference implementations of the broader OpenWOP host-capability surface from `spec/v1/host-capabilities.md`.

| Pack | Required host capability | Purpose |
|---|---|---|
| [`vendor.myndhyve.ai`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ai/index.json) | `host.aiEnvelope` | Typed-envelope AI calls (vs `core.openwop.ai`'s untyped). |
| [`vendor.myndhyve.brand`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.brand/index.json) | `host.brand` | Brand theme + persona state mutation. |
| [`vendor.myndhyve.canvas`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.canvas/index.json) | `host.canvas` | Canvas state CRUD + cross-canvas invocation. |
| [`vendor.myndhyve.chat`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.chat/index.json) | `host.chat` | Chat session messaging + card rendering. |
| [`vendor.myndhyve.entities`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.entities/index.json) | `host.entities` | Generic entity-store CRUD with type-discriminator routing. |
| [`vendor.myndhyve.kanban`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.kanban/index.json) | `host.kanban` | Kanban-style task workflow primitives. |
| [`vendor.myndhyve.web-research`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.web-research/index.json) | `host.webResearch` | Search + fetch + research orchestration over a host search adapter. |
| [`vendor.myndhyve.agent-orchestration`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.agent-orchestration/index.json) | `host.agentRuntime` | Multi-agent orchestration primitives per RFC 0006. |
| [`vendor.myndhyve.data-integration`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.data-integration/index.json) | `host.dataIntegration` | Inbound + outbound data pipeline glue. |
| [`vendor.myndhyve.launch-studio`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.launch-studio/index.json) | `host.launchStudio` | Launch Studio orchestration nodes (campaign launch checklists). |
| [`vendor.myndhyve.knowledge-tools`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.knowledge-tools/index.json) | `host.knowledge` | RAG retrieval: `knowledge.retrieve` + `knowledge.augment-prompt` composition primitives. **First consumer of `host.knowledge`** ([spec PR #37](#)). |
| [`vendor.myndhyve.wop-refinement`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.wop-refinement/index.json) | `aiProviders` | Iterative WOP-refinement primitives. |

## App Builder canvas

The auto-play screen-generation workflow lifted from MyndHyve's App Builder canvas type.

| Pack | Required host capability | Purpose |
|---|---|---|
| [`vendor.myndhyve.app-builder`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.app-builder/index.json) | `host.chat` + `host.aiEnvelope.await` | 2 typeIds: `app-builder.per-screen` (single-task screen generation) + `app-builder.iterate-tasks` (multi-task loop over plan steps with task-level failure isolation). |

## Landing Page canvas

| Pack | Required host capability | Purpose |
|---|---|---|
| [`vendor.myndhyve.landing-page`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.landing-page/index.json) | `aiProviders` | 7 typeIds: `landing.content.generate` / `landing.structure.create` / `landing.variants.generate` / `landing.theme.apply` / `landing.tracking.setup` / `landing.page.validate` / `landing.page.publish`. End-to-end landing-page authoring + publishing. |

## Market Intelligence (VoC pipeline → ad angles)

9 composable typeIds that together implement the VoC research pipeline from MyndHyve's marketIntel module. Compose freely via workflow definitions — see [`examples/market-intel-pipeline/`](../examples/market-intel-pipeline/) for the canonical 8-step DAG. All `aiProviders: supported` peer-dep (single `ctx.callAI` per typeId).

| Pack | typeId | Role |
|---|---|---|
| [`vendor.myndhyve.market-intel-query-builder`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-query-builder/index.json) | `market-intel.query-builder` | Generate intent-mapped search queries (4-8 groups × 4 intent stages) + per-competitor query packs + topic clusters from ICP + product. |
| [`vendor.myndhyve.market-intel-discovery`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-discovery/index.json) | `market-intel.ai-discovery` | AI-discover sources + communities + search queries from a topic. |
| [`vendor.myndhyve.market-intel-community-rank`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-community-rank/index.json) | `market-intel.community-rank` | Rank existing candidate communities by VoC fit. Distinct from `ai-discovery` (which generates new). |
| [`vendor.myndhyve.market-intel-thread-triage`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-thread-triage/index.json) | `market-intel.thread-triage` | Cost-aware pre-filter for VoC extraction — drops low-signal threads to save AI tokens downstream (~70% savings typical). |
| [`vendor.myndhyve.market-intel-content-extraction`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-content-extraction/index.json) | `market-intel.content-extraction` | Raw HTML → structured page content (title + cleaned body + author + engagement + relevantQuotes). |
| [`vendor.myndhyve.market-intel-voc`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-voc/index.json) | `market-intel.voc-extraction` | Extract Voice-of-Customer records (verbatim quotes + 6 tag types × 4 intent stages × confidence + rationale) from content. |
| [`vendor.myndhyve.market-intel-opportunity-scoring`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-opportunity-scoring/index.json) | `market-intel.opportunity-scoring` | Score + rank communities AND angles on 5-dim weighted scale (volume/intensity/commercialIntent/clarity/uniqueness). |
| [`vendor.myndhyve.market-intel-ad-angles`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-ad-angles/index.json) | `market-intel.ad-angles` | Generate 5-10 ad-angle briefs (segment + corePain + promise + mechanism + hooks + CTAs + score) from VoC. |
| [`vendor.myndhyve.market-intel-audience-targeting`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-audience-targeting/index.json) | `market-intel.audience-targeting` | Build per-platform targeting packs (interests + keywords + placements + audiences) for 6 ad platforms. Closes the marketIntel → paid-media loop. |

## Ads Studio (creative authoring + validation)

14 typeIds across 10 packs covering brief extraction → variant planning → creative generation → validation → export → post-publish metrics. Mix of pure-logic + `aiProviders` + `aiProviders.imageGeneration` + `aiProviders.videoGeneration` consumers.

| Pack | Peer-dep | typeIds |
|---|---|---|
| [`vendor.myndhyve.ads-tools`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-tools/index.json) | — (pure logic) | `ads.brief.extract` + `ads.tracking.link` (UTM/click-id builder for 9 platforms). |
| [`vendor.myndhyve.ads-studio-core`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-studio-core/index.json) | `aiProviders` | `ads.brief.build` + `ads.variant.plan` + `ads.video.qa` + `ads.winner.synthesize` (AI-orchestration cohort). |
| [`vendor.myndhyve.ads-platforms`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-platforms/index.json) | — (pure data) | `ads.platform.specs` — 9 platforms × 22 placements creative-spec catalog (text limits, image specs, video specs, CTA presets, safe zones, caption + audio guidance). |
| [`vendor.myndhyve.ads-policy`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-policy/index.json) | — (pure logic) | `ads.policy.check` — 7 built-in text rules (claims, trademark, prohibited content, discriminatory targeting). |
| [`vendor.myndhyve.ads-creative-validate`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-creative-validate/index.json) | — (pure logic) | `ads.creative.validate` — combined text rules + asset-format checks + placement text-length checks. Caller-supplied `placementSpecs`. |
| [`vendor.myndhyve.ads-export`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-export/index.json) | — (pure logic) | `ads.export.pack` — bundle copy variants + creative assets + tracking links into a structured AdExportPack. |
| [`vendor.myndhyve.ads-copy-generate`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-copy-generate/index.json) | `aiProviders` | `ads.copy.generate` — AI multi-variant ad copy with per-placement text-limit adaptation. |
| [`vendor.myndhyve.ads-image-generate`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-image-generate/index.json) | `aiProviders.imageGeneration` | `ads.image.generate` — batched image generation via `ctx.callImageGenerator`. **First consumer of `aiProviders.imageGeneration`** ([spec PR #48](#)). |
| [`vendor.myndhyve.ads-video-generate`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-video-generate/index.json) | `aiProviders.videoGeneration` | `ads.video.generate` — single-video generation via `ctx.callVideoGenerator` (host hides async polling). **First consumer of `aiProviders.videoGeneration`** ([spec PR #53](#)). |
| [`vendor.myndhyve.ads-metrics-import`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-metrics-import/index.json) | — (pure logic) | `ads.metrics.import` — caller-supplied-snapshots aggregation. Overall CTR/CPC/ROAS/conversion-rate + per-platform breakdown. |

## Ads platform-publish trio

3 packs covering the major paid-media platforms. All consume `secrets.resolveInPack` ([spec PR #52](#)). Each adapted to its platform's API conventions.

| Pack | API | Key shape |
|---|---|---|
| [`vendor.myndhyve.ads-publish-meta`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-publish-meta/index.json) | Meta Marketing API v21.0 | `ads.publish.meta`. 1 OAuth secret. 4-step pipeline (creative → campaign → ad-set → ad). Cascade-aware rollback. |
| [`vendor.myndhyve.ads-publish-google`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-publish-google/index.json) | Google Ads API v18 | `ads.publish.google`. **2 secrets** (OAuth + developer-token). 5-step pipeline (budget → campaign → ad-group → ad). REVERSE-order REMOVE rollback. MCC support via `login-customer-id`. |
| [`vendor.myndhyve.ads-publish-tiktok`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-publish-tiktok/index.json) | TikTok Marketing API v1.3 | `ads.publish.tiktok`. 1 OAuth secret. `Access-Token` header (not Bearer). Business-code envelope (HTTP 200 + `code !== 0` = error). 3-step pipeline. **NO rollback** (no hard-delete via this API). |

## Campaign Sequence (drip / orchestration)

| Pack | Required host capability | Purpose |
|---|---|---|
| [`vendor.myndhyve.campaign-sequence`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.campaign-sequence/index.json) | — (pure logic) | `campaign.sequence.{wait, tag, condition}` — pure-logic flow controls. |
| [`vendor.myndhyve.campaign-sequence-integration`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.campaign-sequence-integration/index.json) | `host.campaignMessaging` | `campaign.sequence.{email, sms, webhook}` — integration channels. |

---

## Use cases → which packs

| Use case | Compose these packs |
|---|---|
| **End-to-end VoC research → ad copy** | `market-intel-query-builder` → `market-intel-discovery` → (host fetch) → `market-intel-content-extraction` → `market-intel-voc` → `market-intel-opportunity-scoring` → `market-intel-ad-angles` → `market-intel-audience-targeting` → `ads-copy-generate`. See [`examples/market-intel-pipeline/`](../examples/market-intel-pipeline/). |
| **Publish a paid-ads campaign to Meta** | `ads-brief-build` → `ads-variant-plan` → `ads-platforms` (specs) → `ads-copy-generate` → `ads-image-generate` → `ads-creative-validate` → `ads-tools` (tracking links) → `ads-export` → `ads-publish-meta`. See [`examples/ads-publish-pipeline/ads-creative-publish-meta.json`](../examples/ads-publish-pipeline/ads-creative-publish-meta.json). |
| **Same, multi-platform (Google or TikTok)** | Replace terminal `publish-meta` with `publish-google` or `publish-tiktok` — see [`examples/ads-publish-pipeline/`](../examples/ads-publish-pipeline/) for the three sibling variants showing per-platform credential + targeting shape differences. |
| **App-Builder auto-play** | `app-builder.iterate-tasks` (composes `app-builder.per-screen` internally per task) |
| **Landing page generation** | `landing.content.generate` → `landing.structure.create` → `landing.theme.apply` → `landing.tracking.setup` → `landing.page.validate` → `landing.page.publish` |
| **RAG-grounded AI call** | `knowledge.augment-prompt` (composes `knowledge.retrieve` + Sources block) → `core.ai.chatCompletion`. See [`examples/rag-grounded-chat/`](../examples/rag-grounded-chat/) — 2-node reference for the `host.knowledge` extension. |
| **Drip campaign with conditional branching** | `campaign.sequence.condition` → `campaign.sequence.wait` → `campaign.sequence.email` (or `.sms`, `.webhook`). Note: these executors are host-scheduler-dispatched (the host enrollment scheduler decides when each fires); compose them as a sequence template, not an engine-edge-driven DAG. |

---

## Spec extensions referenced

Each peer-dep in this catalog traces to a section in [`spec/v1/host-capabilities.md`](../spec/v1/host-capabilities.md). The 4 extensions added during the 2026-05-13 Stage 5 push:

| Sub-capability | Used by | Spec PR |
|---|---|---|
| `host.knowledge` | `knowledge-tools` | #37 |
| `host.aiProviders` (`ctx.callAI` formalization + `imageGeneration` sub-cap) | All `aiProviders` consumers + `ads-image-generate` | #48 |
| `secrets.resolveInPack` | `ads-publish-meta`, `ads-publish-google`, `ads-publish-tiktok` | #52 |
| `aiProviders.videoGeneration` | `ads-video-generate` | #53 |

Future Phase D extensions are gated on [RFC 0013 (Workflow-chain packs)](../RFCS/0013-workflow-chain-packs.md) which proposes a new pack kind for the 55 editor-preset typeIds documented in [`docs/CANVAS-PACKS-INVENTORY.md`](CANVAS-PACKS-INVENTORY.md).

---

## See also

- [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) — node-pack manifest format + registry HTTP API
- [`spec/v1/host-capabilities.md`](../spec/v1/host-capabilities.md) — every `host.*` capability surface
- [`spec/v1/registry-operations.md`](../spec/v1/registry-operations.md) — namespace claims, signing keys, publish lifecycle
- [`docs/CANVAS-PACKS-INVENTORY.md`](CANVAS-PACKS-INVENTORY.md) — v3 closure: Phase A+B+C delivery log
- [`docs/AUTHORING-CANVAS-PACKS.md`](AUTHORING-CANVAS-PACKS.md) — how to author a pack from scratch
- [`registry/README.md`](../registry/README.md) — publish workflow against `packs.openwop.dev`
