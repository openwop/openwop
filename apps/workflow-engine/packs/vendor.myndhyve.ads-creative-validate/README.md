# vendor.myndhyve.ads-creative-validate

> `ads.creative.validate` — full compliance scanner combining text rules + asset-format checks + placement text-length checks.

## Node

| typeId | Behavior |
|---|---|
| `ads.creative.validate` | Runs 3 check categories: text policy rules (7 built-ins + custom), asset-format compliance (image dimensions, video duration, file sizes), and placement text-length validation. Returns full report + isValid + per-violation list. |

## Check categories

1. **Text policy rules** — same 7 built-ins as `vendor.myndhyve.ads-policy` (claims, trademark, prohibited content, discriminatory targeting). `config.customRules` adds caller rules.
2. **Asset format** — when `inputs.assets[]` is supplied along with `inputs.placementSpecs[<placement>]`, validates each asset against its placement's `imageSpec` / `videoSpec` for min dimensions, max file size, and video duration bounds.
3. **Placement text-length** — when `inputs.placementTextLimits[<placement>]` is supplied, validates headline/description/bodyText/ctaText against per-placement min/max/recommended.

When the corresponding spec input is absent, that category is skipped — keeps the pack usable with partial caller-supplied data.

## Caller-supplied spec inputs

Resolve upstream via `vendor.myndhyve.ads-platforms` pack OR a host.adPlatformSpecs capability:

```js
inputs.placementSpecs = {
  'meta-feed': {
    imageSpec: { minWidth: 600, minHeight: 600, maxFileSize: 30 * 1024 * 1024 },
    videoSpec: { minDuration: 1, maxDuration: 240, maxFileSize: 4 * 1024 * 1024 * 1024 },
  },
  // ...
};

inputs.placementTextLimits = {
  'meta-feed': {
    headline: { min: 1, max: 40, recommended: 27 },
    description: { min: 1, max: 125, recommended: 90 },
    bodyText: { min: 1, max: 2200, recommended: 125 },
  },
  // ...
};
```

## Differences vs MyndHyve source

MyndHyve's `AdApprovalGateService.runComplianceChecks` reads platform specs from `PlatformSpecRegistry`. This pack replaces that lookup with caller-supplied `inputs.placementSpecs` + `inputs.placementTextLimits`. Same outputs.

## Relationship to other packs

- `vendor.myndhyve.ads-policy` — text rules only, no asset checks
- `vendor.myndhyve.ads-creative-validate` — text rules + asset format + text length (this pack)
- `vendor.myndhyve.ads-platforms` — supplies the placement spec data that feeds this pack's inputs

## License

Apache-2.0 — see [LICENSE](./LICENSE).
