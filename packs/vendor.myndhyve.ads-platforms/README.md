# vendor.myndhyve.ads-platforms

> Pure-data executor exposing 9 ad-platform spec sets (22 placements). Zero host capabilities.

## Node

| typeId | Behavior |
|---|---|
| `ads.platform.specs` | Returns the creative-spec set for the requested platforms (+ optional placement filter). Each spec carries `platform` / `placement` ids, `displayName`, `supportedTypes`, per-field text limits, image + video specs, CTA presets, safe zones, caption + audio guidance. |

## Platforms covered

| Platform | Placements |
|---|---|
| meta (Facebook + Instagram) | feed, stories, reels, right-column, marketplace, messenger |
| google | search, display, youtube-instream, youtube-bumper, discovery, performance-max |
| linkedin | feed, message |
| tiktok | feed, spark |
| x (Twitter) | timeline, explore |
| pinterest | feed, search |
| snapchat | feed, stories |
| reddit | feed, promoted-post |
| amazon | display, video, audio |

~1500 LOC of platform spec data inlined verbatim from `src/canvas-types/campaign-studio/ads-studio/platforms/specs/`.

## Differences vs MyndHyve source

- The 9 platform spec files (`amazon.ts` + `google.ts` + ...) and `PlatformSpecRegistry.ts` are folded into a single `index.mjs`. Same data, no behavioral change.
- Helper functions beyond `getSpecSet` (`validateTextForPlacement`, `getCharacterCountState`, `getMostRestrictiveLimits`, `getSafeZones`, `getCaptionGuidance`, `getAudioGuidance`) are **NOT exposed** by this pack — they have no caller in the wrapping `ads.platform.specs` node. Future packs needing them can either bundle their own copy of the data OR depend on this pack via `dependencies` once openwop adds inter-pack import support.
- `: PlatformInfo` / `: CreativeSpec[]` TypeScript annotations stripped. `as const` assertion removed.
- Per-platform `COMMON_CTA_PRESETS` constants renamed to `<PLATFORM>_CTA_PRESETS` to avoid module-scope collision across the 9 inlined files.

## Smoke test

```js
const { specSet, specCount } = (await nodes['ads.platform.specs']({
  inputs: { platforms: ['meta', 'google'] },
})).outputs;
// specCount === 14 (6 meta + 8 google)
```

```js
const filtered = (await nodes['ads.platform.specs']({
  inputs: { platforms: ['meta'], placements: ['meta-stories', 'meta-feed'] },
})).outputs;
// filtered.specCount === 2
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
