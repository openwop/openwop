# vendor.myndhyve.ads-metrics-import

> `ads.metrics.import` — **pure-logic aggregation** of caller-supplied ad metric snapshots. Filters by `platformAdIds[]` + optional `platform` / `dateRange`, then computes overall CTR / CPC / ROAS / conversion-rate + per-platform breakdown. **Zero host capabilities required.**

## Node

| typeId | Role | Behavior |
|---|---|---|
| `ads.metrics.import` | action | Pure aggregation. No external API calls. Caller supplies snapshots (from a platform-fetch step OR persistent store); pack filters, validates, and aggregates. |

## Why pure-logic (not an API fetcher)

The MyndHyve source `AdMetricsService` is a **client-side cache** with cache lookup + aggregation math. Platform-API fetching is marked "Phase 2 (TBD)" in the source comments — the current `ads.metrics.import` executor reads from the in-memory cache + aggregates. **No external fetch happens.**

This pack mirrors that exactly via the `inputs.snapshots[]` input-passthrough pattern (same as `ads-policy`, `ads-creative-validate`, `opportunity-scoring`). External platform-API publish-side calls are handled by the platform-specific publish packs ([`ads-publish-meta`](../vendor.myndhyve.ads-publish-meta/), [`ads-publish-google`](../vendor.myndhyve.ads-publish-google/), [`ads-publish-tiktok`](../vendor.myndhyve.ads-publish-tiktok/)) via `ctx.secrets.resolve` (spec PR #52). A symmetric metrics-fetch counterpart for those platforms is not yet authored; callers run their own retrieval and pass snapshots into this pack.

## Output shape

| Field | Notes |
|---|---|
| `snapshots[]` | Filtered + validated subset of inputs.snapshots |
| `aggregated.totalSpend / totalImpressions / totalClicks / totalConversions / totalConversionValue` | Sums across filtered snapshots |
| `aggregated.overallCtr` | clicks / impressions × 100 (matches source) |
| `aggregated.overallCpc` | spend / clicks |
| `aggregated.overallRoas` | conversionValue / spend |
| `aggregated.overallConversionRate` | conversions / clicks × 100 |
| `aggregated.byPlatform` | Per-platform snapshot map. **Last snapshot per platform wins** (preserves source's `byPlatform[snapshot.platform] = snapshot` semantic). |
| `matchedCount` | snapshots that passed validation AND filter |
| `droppedCount` | validated snapshots that didn't match filter |
| `warnings[]` | Per-snapshot validation issues (omitted when empty) |

## Filter semantics

| Filter | Behavior |
|---|---|
| `platformAdIds[]` (required) | Snapshot's `entityId` MUST be in this set. Empty → `INVALID_INPUTS`. |
| `platform` (optional) | Snapshot's `platform` MUST equal this. Mismatches dropped. |
| `dateRange` (optional) | Snapshot's `dateRange.start` AND `dateRange.end` MUST exactly match (source's cache-key semantic). |

Empty `inputs.snapshots[]` is allowed — returns zero-valued aggregation + warning (callers can chain this safely; aggregation is well-defined for empty input).

## Soft validation

| Field | On invalid |
|---|---|
| Missing `entityId` / `platform` | Drop snapshot, append per-snapshot warning |
| Invalid `entityType` | Default to `'ad'` (kept) |
| Non-numeric core metrics | Clamp to `0` (matches source's implicit semantic) |
| Missing optional metrics | Stored as `null` |
| Missing `fetchedAt` | Default to current ISO timestamp |

## Composition with `ads.copy.generate` + the platform publish packs

```
(caller-supplied metrics retrieval — host or workflow-level)
  → vendor.myndhyve.ads-metrics-import  ◄── (this pack — aggregation)
       → reporting dashboards / optimization decisions
       → ads.copy.generate (refresh creative based on low-performing variants)
```

The platform publish packs (`ads-publish-meta` / `ads-publish-google` / `ads-publish-tiktok`) handle the *publish* side of each Marketing API surface; a symmetric metrics-fetch counterpart is not yet authored as an openwop pack, so callers run their own retrieval and pass snapshots into this pack.

Workflows that already have metrics in a persistent store can skip the fetch step and pipe stored snapshots directly to `ads.metrics.import` via `inputs.snapshots`.

## Differences vs MyndHyve source

**Client-side cache + TTL → caller-supplied snapshots**: source-side `AdMetricsService` maintains an in-memory `Map<cacheKey, CacheEntry>` with 5-min TTL. Pack replaces this with the input-passthrough pattern — callers manage caching/persistence upstream.

**`AdPlatform` enum constraint → string passthrough**: source enforces a closed enum; pack accepts any string (host MAY want to support vendor-extensions like `vendor.acme.custom-platform`).

**`createScopedLogger('AdMetricsService')`** → `ctx.log` shim.

**Phase-2 external API fetching (TBD in source)** → out of scope. The publish-side platform Marketing-API surfaces are covered by the `ads-publish-{meta,google,tiktok}` trio; the fetch-side metrics retrieval is not yet authored as a pack — callers run their own.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `adsMetricsImport` + helpers | `AdMetricsService.ts` (316) | ~316 |

~316 LOC TS ported to ~190 LOC pure JS (the cache layer dropped, math + filtering preserved).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
