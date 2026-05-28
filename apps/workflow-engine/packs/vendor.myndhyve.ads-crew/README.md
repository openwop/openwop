# `vendor.myndhyve.ads-crew`

Vendor showcase agent pack. Wraps 14 `vendor.myndhyve.ads-*` node typeIds into a single chat-driven Creative Director persona.

| Pack name | `vendor.myndhyve.ads-crew` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 (`creative-director`) |
| Signing key | `myndhyve-internal-1` |
| Required host capabilities | `aiProviders`, `aiProviders.imageGeneration`, `host.agentRuntime`, `openwop.agents.memoryBackends ≥ longTerm` |
| License | Apache-2.0 |

## Pipeline coverage

The Creative Director can dispatch any of:

- `ads.brief.extract` / `ads.brief.build` — brief intake + structuring
- `ads.variant.plan` — variant strategy
- `ads.platform.specs` — placement-spec lookups
- `ads.copy.generate` — AI multi-variant copy
- `ads.image.generate` / `ads.video.generate` / `ads.video.qa` — creative asset generation
- `ads.policy.check` / `ads.creative.validate` — pre-publish checks
- `ads.tracking.link` — UTM/click-id builder
- `ads.export.pack` — final asset bundling
- `ads.publish.{meta,google,tiktok}` — per-platform publish
- `ads.metrics.import` / `ads.winner.synthesize` — post-publish analysis

## Modes

- `plan` — produce the campaign spec only (no asset generation, no publish)
- `produce` — generate copy + assets, validate, export (no publish)
- `publish` — full pipeline to live ads on selected platforms
- `analyze` — post-publish metrics import + winner synthesis

## Long-term memory

Tracks `(campaign-id, brief, asset-refs, platform-publish-IDs, metrics-snapshots)` so subsequent runs (iteration, retargeting, A/B follow-up) can reuse the artifact history.

## Handoff schemas

- `schemas/creative-director.task.schema.json` — `{ mode, brief, platforms?, budget?, priorCampaignRef? }`
- `schemas/creative-director.return.schema.json` — `{ campaignSpec, assetRefs?, validationResults?, publishedIds?, metrics? }`
