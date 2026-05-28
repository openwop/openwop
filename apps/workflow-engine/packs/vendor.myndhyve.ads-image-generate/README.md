# vendor.myndhyve.ads-image-generate

> `ads.image.generate` — generate ad creative images via the host's `ctx.callImageGenerator`. **First consumer of the `aiProviders.imageGeneration` sub-capability** ([spec PR #48](../../spec/v1/host-capabilities.md#host-aiProviders)).

## Node

| typeId | Role | Behavior |
|---|---|---|
| `ads.image.generate` | action (image-gen) | Batches `inputs.prompts[]` through one `ctx.callImageGenerator(...)` per prompt. Resolves per-placement dimensions from caller-supplied `placementSpec` (replaces source's `PlatformSpecRegistry` registry lookup). Enhances prompts with platform/style/brand-color context. Aborts mid-batch on `ctx.signal`. |

## Required host capability

```json
"peerDependencies": {
  "aiProviders.imageGeneration": "supported"
}
```

`ctx.callImageGenerator({ provider, model, prompt, negativePrompt, width, height, count, seed, brandColors })` per [spec §host.aiProviders → imageGeneration sub-capability](../../spec/v1/host-capabilities.md#host-aiProviders).

Pack uses every parameter in the spec contract. Hosts that advertise the sub-capability flag MUST expose the method per the spec.

## Output shape

| Field | Notes |
|---|---|
| `assets[]` | Generated images across all prompts. Each: `url? / base64? / mimeType / width / height / seed? / safetyFiltered / metadata.{promptIndex, enhancedPrompt, ...}`. |
| `totalGenerated` | Sum of `assets.length` across prompts. |
| `filteredCount` | Total safety-filtered images. |
| `perPromptStats[]` | Per-prompt: `{ promptIndex, generated, filtered, batchTimeMs }`. |
| `dimensions` | Resolved output dimensions used for all prompts. |
| `platform / placement` | Echoed from input (or defaulted to `meta` / `<platform>-feed`). |
| `usage` | `{ totalTimeMs, totalCost? }`. |

## Dimension resolution priority

1. **`inputs.placementSpec.imageSpec.recommendedWidth/Height`** — capped at `config.maxDimension` (default 2048)
2. **`inputs.aspectRatio` + `config.maxDimension`** — preserves the ratio, picks max-dim along the longer axis
3. Both axes default to `maxDimension` when nothing resolves

## Style enhancement

`inputs.style` maps through 7 known keys to descriptive phrases appended to the prompt:

| Key | Appended |
|---|---|
| `photorealistic` | "photorealistic, high quality photograph" |
| `illustration` | "digital illustration, clean vectors" |
| `flat-design` | "flat design, minimal shadows, solid colors" |
| `minimalist` | "minimalist design, lots of whitespace" |
| `bold-graphic` | "bold graphic design, strong typography" |
| `lifestyle` | "lifestyle photography, natural lighting, authentic" |
| `product-shot` | "professional product photography, studio lighting" |

Unknown keys pass through as free-form text. `brandColors[]` joined as "using brand colors: A, B, C". All prompts end with "optimized for {platform} {placement} ads".

## Smoke test surface

```js
const fakeImageGen = {
  callImageGenerator: async ({ prompt, width, height, count }) => ({
    images: [
      { url: 'https://cdn.host/img-1.png', mimeType: 'image/png', width, height, safetyFiltered: false },
      { url: 'https://cdn.host/img-2.png', mimeType: 'image/png', width, height, safetyFiltered: true },
    ],
    filteredCount: 1,
    totalTimeMs: 1500,
  }),
};

const r = await nodes['ads.image.generate']({
  callImageGenerator: fakeImageGen.callImageGenerator,
  inputs: {
    prompts: ['A founder at a laptop, sunrise lighting', 'Team huddled over kanban board'],
    platform: 'meta',
    placement: 'meta-feed',
    style: 'lifestyle',
    brandColors: ['#ff5500'],
    placementSpec: { imageSpec: { recommendedWidth: 1080, recommendedHeight: 1080 } },
  },
});
// r.outputs.totalGenerated === 4 (2 prompts × 2 images)
// r.outputs.filteredCount === 2 (1 per prompt)
// r.outputs.dimensions === { width: 1080, height: 1080 }
```

## Failure handling

Maps spec failure codes from `ctx.callImageGenerator`:

| Spec code (from host) | Pack code | retryable |
|---|---|---|
| `image_safety_filtered_all` | `IMAGE_SAFETY_FILTERED_ALL` | false |
| any other thrown error | `IMAGE_GENERATE_FAILED` | true |
| missing `ctx.callImageGenerator` | `host_capability_missing` (thrown) | — (workflow-register should refuse) |

`details.{promptIndex, promptCount, generatedSoFar}` carry partial-progress info so the host can decide whether to surface partial results.

## Differences vs MyndHyve source

**`createExternalApiClient` + `client.post('/aiProxy', { provider:'gemini', action:'generateImage' })` → `ctx.callImageGenerator(...)`**: source-side directly POSTs to MyndHyve's `/aiProxy` Cloud Function. The pack uses openwop's standardized image-gen primitive — host owns provider routing, retry, auth.

**`getSpecForPlacement` PlatformSpecRegistry lookup → `inputs.placementSpec` passthrough**: same pattern used by `ads-creative-validate` and `ads-policy`. Workflow author resolves the spec upstream (e.g. via `vendor.myndhyve.ads-platforms` pack) and passes it as input.

**Source-side concurrency loop (`Promise.all` batches of `concurrency`) → serial prompt iteration**: openwop hosts MAY implement their own concurrency inside `ctx.callImageGenerator` (the spec's `count` parameter accepts batch). Pack iterates prompts serially, letting the host batch within a prompt.

**`AdImageGeneratorService.generate` returns `ImageGenBatchResult` (single-prompt shape) — source executor loops over prompts externally**: pack collapses both layers — single typeId iterates over prompts and aggregates.

**`promptUtils.enhanceCreativePrompt` (75 LOC, shared with video)** → only image-style portion inlined. Video styles live in the separate `ads-video-generate` pack (future).

**`createScopedLogger('AdImageGeneratorService')`** → `ctx.log` shim.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `adsImageGenerate` + helpers | `AdImageGeneratorService.ts` (237) + `promptUtils.ts` image portion (~50) | ~290 |

~290 LOC TS ported to ~220 LOC pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
