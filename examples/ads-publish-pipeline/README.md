# ads-publish-pipeline

> Reference workflow composing the [vendor.myndhyve.ads-* pack catalog](https://packs.openwop.dev) into an end-to-end creative + publishing pipeline. **8 packs orchestrated declaratively** — replaces the ~600 LOC of orchestration logic in MyndHyve's Ads Studio canvas with a workflow definition the host runs through its standard engine.

## The pipelines

Three platform variants of the same 9-node pipeline. The first 8 nodes (creative generation + validation + export) are identical across all variants; only the terminal `publish-*` node and its credential-ref variables differ.

| Workflow | Platform | API version | Credentials | Notes |
|---|---|---|---|---|
| [`ads-creative-publish-meta.json`](./ads-creative-publish-meta.json) | Meta (Facebook + Instagram) | Marketing API v21.0 | 1 OAuth ref | `Authorization: Bearer`; PAUSED status; cascade-aware rollback. |
| [`ads-creative-publish-google.json`](./ads-creative-publish-google.json) | Google Ads | API v18 | 2 refs (OAuth + developer-token) | `customerId` + optional MCC `loginCustomerId`; camelCase fields; REVERSE-order REMOVE rollback. |
| [`ads-creative-publish-tiktok.json`](./ads-creative-publish-tiktok.json) | TikTok | Marketing API v1.3 | 1 OAuth ref | `Access-Token` header (NOT Bearer); business-code envelope; `ENABLE`/`DISABLE` enums; NO rollback (API limitation). |

## Conceptual pipeline (Meta single-platform)

```
┌─────────────────────────────────┐
│ ads.brief.build                 │  AI: goal + ICP + product → structured brief
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ ads.variant.plan                │  AI: brief → 5 variants × 3 placements
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ ads.platform.specs              │  Pure data: Meta placement specs catalog
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ ads.copy.generate               │  AI: per-placement copy with text-limit adaptation
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ ads.image.generate              │  ctx.callImageGenerator → batched images
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ ads.creative.validate           │  Pure logic: text rules + asset-format + text-length
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ ads.tracking.link               │  Pure logic: UTM links per variant
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ ads.export.pack                 │  Pure logic: bundle into AdExportPack
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│ ads.publish.meta                │  Meta Marketing API v21.0 → PAUSED campaign
└─────────────────────────────────┘
```

## Required host capabilities

| Capability | Used by |
|---|---|
| `aiProviders: supported` | `build-brief`, `plan-variants`, `generate-copy` |
| `aiProviders.imageGeneration: supported` | `generate-images` |
| `secrets.resolveInPack: supported` | `publish-meta` (resolves `metaCredentialRef` via `ctx.secrets.resolve`) |

## Authoring your own variant

The first 8 nodes (creative generation + validation + export) are platform-agnostic. Swap only the terminal `publish-*` node to retarget. The three published variants in this directory are the canonical reference for each platform's input shape — fork whichever matches your platform and adjust credentials + targeting + budget shape.

## Multi-platform fan-out

This reference workflow is the **single-platform linear path**. To publish to all three platforms in parallel, hosts with RFC 0007 `fanOutSupported: true` can:

1. After `export-pack`, dispatch the `pack` to three parallel `publish-*` nodes
2. Each platform-publish node consumes its own credential reference
3. Re-aggregate the platform-specific `publishedIds` into a single `publishedAds[]` collection

## Pack inventory

All 8 packs are published at `packs.openwop.dev`:

| Pack | typeId(s) | Pure logic? |
|---|---|---|
| [`vendor.myndhyve.ads-studio-core@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-studio-core/index.json) | `ads.brief.build`, `ads.variant.plan` | AI |
| [`vendor.myndhyve.ads-platforms@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-platforms/index.json) | `ads.platform.specs` | Pure data |
| [`vendor.myndhyve.ads-copy-generate@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-copy-generate/index.json) | `ads.copy.generate` | AI |
| [`vendor.myndhyve.ads-image-generate@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-image-generate/index.json) | `ads.image.generate` | ctx.callImageGenerator |
| [`vendor.myndhyve.ads-creative-validate@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-creative-validate/index.json) | `ads.creative.validate` | Pure logic |
| [`vendor.myndhyve.ads-tools@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-tools/index.json) | `ads.tracking.link` | Pure logic |
| [`vendor.myndhyve.ads-export@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-export/index.json) | `ads.export.pack` | Pure logic |
| [`vendor.myndhyve.ads-publish-meta@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-publish-meta/index.json) | `ads.publish.meta` | External HTTP + secrets |

## Credentials flow (NFR-7)

The workflow never carries plaintext credentials. Pattern:

1. **Host stores tokens out-of-band** (in MyndHyve's case: `PlatformConnection` Firestore docs encrypted with Cloud KMS).
2. **Workflow run variables carry only the credential reference** (`metaCredentialRef: "ws-123:meta:user-456"`).
3. **Pack resolves at execution time**: `ctx.secrets.resolve({ ref, purpose: 'ads.publish.meta:campaign.create' })` → `{ plaintext }`.
4. **Plaintext lives only in local pack variables**, sent only via `Authorization: Bearer` header, never logged via `ctx.log`, never returned in node outputs.

See the [secrets-resolve-in-pack](../../spec/v1/host-capabilities.md#secretsresolveInpack) spec section for the host-side contract.

## Activation

To use this workflow on an OpenWOP host:

1. Ensure the host advertises:
   - `aiProviders: supported` + `aiProviders.imageGeneration: supported`
   - `secrets.resolveInPack: supported`
2. Ensure the pack registry has the 8 listed packs available at the listed versions
3. Host's secrets store has Meta OAuth tokens under the credential reference scheme
4. POST the workflow JSON to `/v1/workflows` (host endpoint)
5. POST a run via `/v1/runs` with `{ workflowId: "vendor.myndhyve.ads-creative-publish-meta", variables: { campaignGoal, icpContext, productContext, destinationUrl, metaAdAccountId, metaCredentialRef, ... } }`

See [`spec/v1/rest-endpoints.md`](../../spec/v1/rest-endpoints.md) for the run lifecycle wire protocol.

## What's NOT in this JSON

- **Multi-platform fan-out** — left to host orchestrator (RFC 0007).
- **`ads.brief.extract`** — alternate brief-source node that parses raw user text. Use it as the first node when the input is an open-ended copy-paste rather than structured ICP + product context.
- **`ads.policy.check`** — included via `ads.creative.validate` (text-rule subset). Use `ads.policy.check` as a standalone gate before publish if you want a hard veto rather than a soft validation report.
- **`ads.video.generate`** — swap into `generate-images` when targeting `meta-reels` / TikTok-video / YouTube-pre-roll placements.
- **`ads.metrics.import`** — runs *after* publish (on a separate schedule); not part of the publish pipeline.
- **Composition with marketIntel** — to drive this workflow from marketIntel research output, chain `examples/market-intel-pipeline/market-intel-research.json` → `ads-creative-publish-meta.json` by mapping `market-intel.audience-targeting.outputs.targetingPacks.meta` into this workflow's `targeting` variable.

## License

Apache-2.0.
