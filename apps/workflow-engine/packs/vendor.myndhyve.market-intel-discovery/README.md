# vendor.myndhyve.market-intel-discovery

> `market-intel.ai-discovery` — AI-powered source discovery. Given a research topic (+ optional industry/audience/platforms), one AI call returns relevant URLs, communities (with platform / relevanceScore / estimatedPostCount), and search queries. Replaces the manual URL-input step of the marketIntel research pipeline. Third marketIntel pack of the Stage 5 cohort.

## Node

| typeId | Role | Behavior |
|---|---|---|
| `market-intel.ai-discovery` | action (AI) | Single `ctx.callAI`. Validates the JSON output. URLs filtered to `http(s)://` OR reddit-style `r/<subreddit>` identifiers (per source guidance). Communities sorted by `relevanceScore` descending. Invalid entries dropped with warnings. |

## Output shape

| Field | Notes |
|---|---|
| `sources[]` | URL or `r/<sub>` strings. Invalid entries dropped + warned. |
| `communities[]` | Sorted by `relevanceScore` descending. Each has `platform` (5 + `other`) + `name` + `url` + `relevanceScore` (0..1 clamped) + `estimatedPostCount` (or `null`) + `description`. |
| `searchQueries[]` | Filtered to non-empty strings. |
| `warnings[]` | Drops + AI-emitted warnings, merged. |

Communities with missing `name` OR `url` are dropped (not auto-defaulted — name/url are identity-critical). Invalid platform → `other` (not dropped).

## Required host capability

`peerDependencies: { "aiProviders": "supported" }`. Single `ctx.callAI` per invocation.

## Defaults

| Config | Default | Why |
|---|---|---|
| `temperature` | `0.3` | Discovery values precision (real communities/URLs) over creative variation. |
| `maxTokens` | `2048` | Smaller than ad-angles (6000); discovery output is structured but compact. |
| `minUrls` (input) | `10` | Soft target passed to AI; not validation-enforced. |
| `minCommunities` (input) | `5` | Soft target. |
| `minQueries` (input) | `5` | Soft target. |

## Pipeline composition

```
market-intel.ai-discovery           ─►  (host.webResearch.fetchBatch on sources[])
                                            │
                                            ▼
                                  market-intel.voc-extraction (×N fetched pages)
                                            │
                                            ▼
                                  market-intel.ad-angles
                                            │
                                            └─► briefs[] → ads.copy.generate
```

This is the canonical marketIntel-driven campaign flow. All four packs are now published. The `host.webResearch.fetchBatch` step in the middle is supplied by `vendor.myndhyve.web-research` (already shipped).

## Differences vs MyndHyve source

**`AIDiscoveryExecutor` + `aiSettingsStore` + BYOK secret resolution** → `ctx.callAI`. Source-side `getAIProviderConfigFromContext` lazy-requires `useAISettingsStore` to resolve BYOK secrets. The pack delegates secret resolution entirely to the host (per openwop's `host.aiProviders` contract).

**Source-side `getAIProviderConfigFromContext` `null`-fallback (no provider configured) returns `success: false`** → pack throws `host_capability_missing` only when `ctx.callAI` is absent (a register-time bug). When the host's `ctx.callAI` is present but returns an empty response, the pack returns `success: true` with empty arrays + a warning (matches the rest of the marketIntel cohort).

**`createScopedLogger('MarketIntel:AIDiscoveryNode')`** → `ctx.log` shim.

**`SourceDiscoveryResult.communities[]`** → identical shape; `estimatedPostCount` preserved (defaults to `null` when AI omits it).

## URL validation rule

The source-side prompt explicitly tells the AI to suggest both full URLs AND reddit identifiers (`r/SaaS`, `r/startups`). The pack accepts both formats:

```js
isValidUrl('https://news.ycombinator.com/news')   // true
isValidUrl('r/SaaS')                              // true (reddit identifier)
isValidUrl('   ')                                 // false (dropped + warned)
isValidUrl('not-a-url')                           // false (dropped + warned)
```

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `aiDiscovery` + helpers | `src/canvas-types/.../aiDiscoveryExecutor.ts` + `src/core/market-intel/prompts/discoveryPrompt.ts` (source-discovery section) | ~200 + ~100 |

~300 LOC TS ported to ~220 LOC pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
