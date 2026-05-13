# vendor.myndhyve.ads-publish-tiktok

> `ads.publish.tiktok` — publish an ad to **TikTok Marketing API v1.3**. Third + final platform-publish pack of the Stage 5 cohort. Closes the Meta/Google/TikTok trio. See also [`ads-publish-meta`](../vendor.myndhyve.ads-publish-meta/README.md) + [`ads-publish-google`](../vendor.myndhyve.ads-publish-google/README.md).

## Node

| typeId | Role | Behavior |
|---|---|---|
| `ads.publish.tiktok` | action (external HTTP + credentials) | 3-step publish pipeline (with optional URL-image-upload pre-step). Handles TikTok's envelope quirk: HTTP 200 + `code !== 0` means business error. |

## Required host capability

```json
"peerDependencies": {
  "secrets.resolveInPack": "supported"
}
```

## Key differences vs Meta + Google

| Aspect | Meta | Google | TikTok |
|---|---|---|---|
| Auth header | `Authorization: Bearer <token>` | `Authorization: Bearer <token>` + `developer-token` | `Access-Token: <token>` (NOT Bearer) |
| Secrets resolved | 1 | 2 | **1** |
| Pipeline steps | 4 | 5 | **3** (no separate budget) |
| Success signal | HTTP 2xx | HTTP 2xx | HTTP 2xx **AND** body `code === 0` |
| Failure signal | HTTP non-2xx | HTTP non-2xx | HTTP non-2xx **OR** body `code !== 0` |
| Status enums | `ACTIVE`/`PAUSED` | `ENABLED`/`PAUSED` | `ENABLE`/`DISABLE` (no D!) |
| Rollback | Cascade-aware | REVERSE-order REMOVE | **None — no hard-delete via API** |
| Field naming | `snake_case` | `camelCase` | `snake_case` |

## Pipeline

```
1. ctx.secrets.resolve({ ref: credentialRef, purpose: 'ads.publish.tiktok:...' })
     → { plaintext: <access_token> }
2. [optional] POST /open_api/v1.3/file/image/ad/upload/  (when imageUploadUrl supplied)
     → { id: <image_id> }
3. POST /open_api/v1.3/campaign/create/                 → { campaign_id }
4. POST /open_api/v1.3/adgroup/create/                  → { adgroup_id }
5. POST /open_api/v1.3/ad/create/                       → { ad_ids: [...] }
```

## TikTok response envelope quirk

Every TikTok API response is wrapped:

```json
{
  "code": 0,           // 0 = success; non-zero = business error
  "message": "OK",
  "data": { /* payload */ },
  "request_id": "..."
}
```

Pack treats HTTP 200 + `code !== 0` as a thrown error — mapped to retryability per a business-code lookup:

| Business code | Pack code | retryable |
|---|---|---|
| `40000` / `40001` | `TIKTOK_INVALID_PARAMS` | false |
| `40002` | `TIKTOK_AUTH_EXPIRED` | false |
| `40100` / `40101` | `TIKTOK_PERMISSION_DENIED` | false |
| `50000` | `TIKTOK_SERVER_ERROR` | **true** |
| `51301` | `TIKTOK_RATE_LIMIT` | **true** |
| other | `TIKTOK_REQUEST_FAILED` | false |

HTTP-level errors mapped same as Meta/Google: `429` → rate-limit (retryable), `5xx` → server-error (retryable), `401` → auth-expired, `403` → permission-denied.

`details.businessCode` + `details.requestId` carry TikTok's audit-trail identifiers — useful for support tickets.

## No-rollback policy

TikTok Marketing API v1.3 does **not** expose a hard-delete endpoint via this surface. Created entities (campaigns, ad groups, ads) accumulate as DISABLED draft state on failure. Pack does NOT attempt rollback — `details.partialState` surfaces the created entity IDs for **manual cleanup** via TikTok's Ads Manager UI.

This is a deliberate design choice (matches MyndHyve source). Auto-rolling-back via repeated status updates would be both error-prone (TikTok may not allow status changes on partially-created entities) and could mask real failures from operators.

## Image input modes (3 options, pick one)

| Mode | Inputs | When |
|---|---|---|
| Pre-uploaded image | `ad.imageIds[]` | When the workflow uploaded image earlier OR has cached image_ids |
| In-pack URL upload | `imageUploadUrl` (+ optional `imageFileName`) | When generating fresh from `ads.image.generate`-pack output (use the asset URL) |
| Video ad | `ad.videoId` | When using a pre-uploaded video |

Pre-flight validation requires exactly one of these to be present.

## Campaign objectives (7 total)

`REACH` / `TRAFFIC` / `VIDEO_VIEWS` / `LEAD_GENERATION` / `CONVERSIONS` / `APP_PROMOTION` / `PRODUCT_SALES`

## Optimization goals (6 total) + placements (3 total)

Goals: `CLICK` / `CONVERT` / `IMPRESSION` / `REACH` / `VIDEO_VIEW` / `LEAD_GENERATION`
Placements: `PLACEMENT_TIKTOK` / `PLACEMENT_PANGLE` / `PLACEMENT_GLOBAL_APP_BUNDLE`

## Targeting (5 fields, all optional)

`locationIds[]` / `ageGroups[]` / `genders[]` (3 enums) / `languages[]` / `interestCategoryIds[]`

## NFR-7 plaintext discipline

Same rules as `ads-publish-meta` + `ads-publish-google`:
- Access-Token held only in local variable
- Never logged via `ctx.log`
- Never returned in outputs
- Only sent via `Access-Token` HTTP header

## Differences vs MyndHyve source

**`uploadImage(imageFile: Blob)` path** → dropped. Pack only supports URL upload (no Blob support in pure-JS Node-20 pack). Source-side Blob upload was browser-specific anyway.

**`getAdInsights` GAQL-like /report/integrated/get/** → out of scope (use `vendor.myndhyve.ads-metrics-import` after fetching via separate node).

**`getAdvertiserInfo`** → host concern.

**Connection registry / publish record cache / approval workflow** → host concerns.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `adsPublishTiktok` + helpers | `TikTokAdsClient.ts` (349) + `AdPublishService.publishToTikTok` extract | ~400 |

~400 LOC TS ported to ~370 LOC pure JS.

## Activation note

Pack ships ready. Activates when a host:
1. Advertises `secrets.resolveInPack: supported`
2. Implements `ctx.secrets.resolve({ ref, purpose })`
3. Has TikTok OAuth tokens stored in its credential namespace

MyndHyve already stores TikTok OAuth tokens (per `PlatformConnection` for `platform: 'tiktok'`); needs adapter wrapping that store as `ctx.secrets.resolve`.

## Stage 5 ads-cohort closure

With this pack, **all 3 platform-publish packs are shipped**:

- `vendor.myndhyve.ads-publish-meta@1.0.0` — Meta Marketing API v21.0
- `vendor.myndhyve.ads-publish-google@1.0.0` — Google Ads API v18
- `vendor.myndhyve.ads-publish-tiktok@1.0.0` — TikTok Marketing API v1.3

Workflow authors can compose any subset based on their target audience. The shared `secrets.resolveInPack` spec sub-cap (PR #52) handles credentials uniformly across all three.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
