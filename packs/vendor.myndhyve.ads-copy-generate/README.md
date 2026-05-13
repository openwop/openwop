# vendor.myndhyve.ads-copy-generate

> `ads.copy.generate` — AI-powered multi-variant ad-copy generator with per-placement text-limit adaptation. Stage 5 continuation per [openwop/openwop#11](https://github.com/openwop/openwop/pull/11).

## Node

| typeId | Role | Behavior |
|---|---|---|
| `ads.copy.generate` | action (AI) | Calls `ctx.callAI` once per invocation; produces N variants (default 3, max 10), each with a distinct angle + headline + optional description / bodyText / ctaText. Each variant carries a `platformAdaptations[]` array — one entry per requested placement — with field-level truncation to caller-supplied limits. Falls back to a single-variant heuristic when the AI response cannot be JSON-parsed. |

## Required host capability

`peerDependencies: { "aiProviders": "supported" }` — the executor calls `ctx.callAI` directly. The host's default provider/model routes the call; override per-execution via `config.provider` + `config.model`.

## Caller-supplied placement limits

Resolve upstream via `vendor.myndhyve.ads-platforms` pack OR a host.adPlatformSpecs capability:

```js
inputs.placementTextLimits = {
  'meta-feed': {
    headline:    { max: 40 },
    description: { max: 125 },
    bodyText:    { max: 2200 },
    ctaText:     { max: 30 },
  },
  'google-search': {
    headline:    { max: 30 },
    description: { max: 90 },
  },
  // ...
};
```

When `inputs.placementTextLimits[placement]` is absent, that placement's adaptation passes the AI output through unchanged with `wasTruncated: false`.

## Smoke test

```js
const result = await nodes['ads.copy.generate']({
  callAI: async () => ({ content: '[{"angle":"benefit","headline":"Launch faster","description":"Ship in days, not months","ctaText":"Start free"}]' }),
  inputs: {
    brief: { sellingPoints: ['fast', 'reliable'], angles: ['benefit', 'outcome'], goal: 'sign-up', tone: 'punchy' },
    placements: ['meta-feed', 'google-search'],
    placementTextLimits: {
      'meta-feed':     { headline: { max: 40 } },
      'google-search': { headline: { max: 30 } },
    },
    variantCount: 1,
  },
});
// result.outputs.variants[0].platformAdaptations.length === 2
// result.outputs.variants[0].platformAdaptations[0].headline === 'Launch faster'
// result.outputs.variants[0].platformAdaptations[1].headline === 'Launch faster'  // 13 chars ≤ 30
```

## Differences vs MyndHyve source

**`AIProxy.generate` → `ctx.callAI`**: the source uses a typed `AIGenerateFn` injected at service construction (defaulting to `@/core/ai/services/AIProxy.generate`). The pack uses openwop's standard `ctx.callAI({ provider, model, systemPrompt, messages, temperature, maxTokens })` — same shape, host routes the call.

**`getSpecForPlacement(p)` → `inputs.placementTextLimits[p]`**: the source dynamically reads `PlatformSpecRegistry` to discover per-placement text-limit data. The pack accepts those limits as an input — workflow author resolves them upstream (often via a preceding `vendor.myndhyve.ads-platforms` node).

**Service-factory + `AdStudioError`** → plain function returning `{status:'error',error:{code,message,retryable}}`. The two source-side error codes (`COPY_NO_PLACEMENTS`, `COPY_NO_SELLING_POINTS`) are preserved verbatim.

**`createScopedLogger('AdCopyGeneratorService')`** → `ctx.log` shim — same level set (`debug` / `info` / `warn` / `error`).

**`crypto.randomUUID()`** is Node-20 stdlib, used as-is for variant `id`s. No `Math.random` fallback.

## Source lineage

| Pack function | MyndHyve TS source | LOC |
|---|---|---|
| `copyGenerate` + helpers | `src/canvas-types/campaign-studio/ads-studio/copy/AdCopyGeneratorService.ts` | 316 |

~316 LOC of TS ported to ~250 LOC of pure JS in this pack.

## What this pack does NOT include

The source repository also ships `ChannelCopyFormatterService` (~600 LOC) + `platformProfiles` (~520 LOC) + `MessageMatchService` (~293 LOC). Those services produce additional per-channel formatting passes and message-match scoring that **are not exposed by the in-tree `ads.copy.generate` node** — they're consumed by separate orchestrator code paths. A follow-up pack can expose `ads.copy.format` + `ads.copy.match` for callers that need them.

## Relationship to other packs

- `vendor.myndhyve.ads-platforms` — supplies the placement spec data (specSet.specs[].textLimits) that feeds this pack's inputs.placementTextLimits
- `vendor.myndhyve.ads-creative-validate` — runs after copy generation to enforce policy + asset format checks
- `vendor.myndhyve.ads-tools` — pure-logic siblings (`ads.brief.extract`, `ads.tracking.link`) feeding into the same campaign flow

## License

Apache-2.0 — see [LICENSE](./LICENSE).
