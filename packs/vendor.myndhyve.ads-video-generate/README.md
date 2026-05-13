# vendor.myndhyve.ads-video-generate

> `ads.video.generate` — generate ad creative videos via the host's `ctx.callVideoGenerator`. **First consumer of the `aiProviders.videoGeneration` sub-capability** ([spec PR #53](../../spec/v1/host-capabilities.md#host-aiProviders)). Symmetric companion to [`ads-image-generate`](../vendor.myndhyve.ads-image-generate/README.md) adapted for video.

## Node

| typeId | Role | Behavior |
|---|---|---|
| `ads.video.generate` | action (video-gen) | Single `ctx.callVideoGenerator(...)` invocation. Host hides async polling internally (typical 30-120s latency). Pack honors `ctx.signal` — propagated to host as `video_generation_cancelled`. |

## Required host capability

```json
"peerDependencies": {
  "aiProviders.videoGeneration": "supported"
}
```

Per [spec §host.aiProviders → videoGeneration sub-capability](../../spec/v1/host-capabilities.md#host-aiProviders).

## Single-video-per-call (vs image-generate's batch)

`ads.image.generate` accepts `prompts[]` and iterates. `ads.video.generate` is single-video-per-call — multi-variant video generation = N separate `ads.video.generate` calls. Rationale: video generation is 30-100× more expensive than image; callers typically want one and decide based on its output whether to generate variants. Hosts MAY parallelize within a single call internally.

## Output shape

| Field | Notes |
|---|---|
| `asset.url` | Host-served URL. Videos are too large for inline base64. |
| `asset.durationSeconds / width / height / mimeType` | Final dimensions (host may have rounded provider-allowed values). |
| `asset.fileSizeBytes / thumbnailUrl` | Optional. |
| `asset.safetyFiltered` | `true` when host's safety filter triggered; `thumbnailUrl` MAY still be present (placeholder). |
| `asset.metadata` | Includes `enhancedPrompt`, `platform`, `placement`, plus optional host-side `{model, generationTimeMs, frameCount, fps, codec}`. |
| `platform / placement / dimensions / durationSeconds` | Echoed inputs. |
| `usage` | `{ totalTimeMs, totalCost? }`. |

## Dimension resolution priority

1. **`inputs.placementSpec.videoSpec.recommendedWidth/Height`** — caller-supplied, replaces source's `PlatformSpecRegistry`
2. **`inputs.aspectRatio` fallback** — preserves ratio; 1920-max landscape OR 1080-max portrait
3. Default `1920 × 1080` (16:9)

## Style enhancement

`inputs.style` maps through 7 known keys:

| Key | Appended |
|---|---|
| `cinematic` | "cinematic quality, professional color grading" |
| `motion-graphics` | "smooth motion graphics, animated elements" |
| `product-demo` | "clean product demonstration, professional lighting" |
| `lifestyle` | "lifestyle footage, natural movement, authentic" |
| `animated` | "high quality animation, smooth transitions" |
| `stop-motion` | "stop motion animation style" |
| `documentary` | "documentary style, natural footage" |

Unknown keys pass through. `durationSeconds` always appended as "{N} seconds". `brandColors[]` joined as "using brand colors: ...". All prompts end with "optimized for {platform} {placement} ads".

## Failure mapping

Maps spec failure codes from `ctx.callVideoGenerator`:

| Spec code (from host) | Pack code | retryable |
|---|---|---|
| `video_generation_timeout` | `VIDEO_GENERATION_TIMEOUT` | **true** |
| `video_generation_cancelled` | `VIDEO_GENERATION_CANCELLED` | false |
| any other thrown error | `VIDEO_GENERATE_FAILED` | false |
| missing `ctx.callVideoGenerator` | `host_capability_missing` (thrown) | — (workflow-register should refuse) |
| malformed host response (no `video.url`) | `VIDEO_GENERATE_FAILED` | true |

`video_safety_filtered` is **not** a thrown error per spec — it resolves with `video.safetyFiltered: true`. Pack passes through; caller decides how to surface (e.g., regenerate vs reject).

## Smoke test surface

```js
const fakeVideoGen = {
  callVideoGenerator: async ({ prompt, width, height, durationSeconds }) => ({
    video: {
      url: 'https://cdn.host/video-1.mp4',
      durationSeconds,
      width, height,
      mimeType: 'video/mp4',
      fileSizeBytes: 4_500_000,
      thumbnailUrl: 'https://cdn.host/thumb-1.jpg',
      safetyFiltered: false,
      metadata: { model: 'veo-2', generationTimeMs: 45000, fps: 30, codec: 'h264' },
    },
    totalTimeMs: 47000,
  }),
};

const r = await nodes['ads.video.generate']({
  callVideoGenerator: fakeVideoGen.callVideoGenerator,
  inputs: {
    prompt: 'A founder onboarding new users at a sunny coworking space',
    platform: 'meta',
    placement: 'meta-feed',
    style: 'lifestyle',
    durationSeconds: 15,
    includeAudio: true,
    aspectRatio: { width: 9, height: 16 },
  },
});
// r.outputs.asset.url === 'https://cdn.host/video-1.mp4'
// r.outputs.dimensions.height > r.outputs.dimensions.width (portrait)
```

## Differences vs MyndHyve source

**`submitJob → pollJob → waitForCompletion` pack-side polling → `ctx.callVideoGenerator` sync interface**: source maintains a 354-LOC service with in-memory job cache, polling loop, and abort plumbing. The spec hides ALL of that behind `ctx.callVideoGenerator` — Promise resolves only when terminal. Pack itself is ~150 LOC.

**In-memory `activeJobs` Map → removed**: host concern. Packs don't track jobs across calls.

**`getSpecForPlacement` PlatformSpecRegistry lookup → `inputs.placementSpec` passthrough**: same pattern used by `ads-image-generate`, `ads-creative-validate`, `ads-policy`.

**`AdStudioError('VIDEO_*')` → spec failure-code mapping**: pack maps `video_generation_timeout` / `cancelled` codes specifically; everything else falls into `VIDEO_GENERATE_FAILED`.

**`createScopedLogger('AdVideoGeneratorService')`** → `ctx.log` shim.

## Activation note

Pack ships ready. Activates when a host advertises `aiProviders.videoGeneration: supported` + exposes `ctx.callVideoGenerator`. MyndHyve has an internal `/aiProxy?action=generateVideo` Cloud Function (Veo-2) that needs an adapter wrapping the existing submitJob/pollJob loop as a single sync `ctx.callVideoGenerator` method — host-side work, separate from this pack.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `adsVideoGenerate` + helpers | `AdVideoGeneratorService.ts` (354 — but most was polling plumbing now in host) + `promptUtils.ts` video portion (~50) | ~150 |

~404 LOC TS effectively compressed to ~210 LOC pure JS (the async-polling layer moved to the host's responsibility per the spec).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
