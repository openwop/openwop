# vendor.myndhyve.ads-publish-google

> `ads.publish.google` — publish an ad to **Google Ads API v18** (Search + Display). Symmetric companion to [`ads-publish-meta`](../vendor.myndhyve.ads-publish-meta/README.md) but adapted for Google's `:mutate` REST pattern + 2-secret authentication.

## Node

| typeId | Role | Behavior |
|---|---|---|
| `ads.publish.google` | action (external HTTP + 2 credentials) | 4-step `:mutate` pipeline: resolve OAuth + developer-token → create budget → create campaign → create ad-group → create ad (responsive_search OR responsive_display). REVERSE-order REMOVE-rollback on failure. |

## Required host capability

```json
"peerDependencies": {
  "secrets.resolveInPack": "supported"
}
```

## 2 secrets required (vs Meta's 1)

Google Ads API needs **two** distinct credentials:

| Secret | Source | What it authorizes |
|---|---|---|
| OAuth access token | Per-user OAuth flow (refreshable; pack receives current value via secret-resolve) | Operations on the customer account |
| Developer token | Per-app registration with Google (long-lived; same across all callers) | Calling the Google Ads API at all (developer-token header gates the API) |

Pack resolves them as separate `ctx.secrets.resolve(ref, purpose)` calls with distinct purpose strings so the host audit log captures which was used for what.

## Publish pipeline

```
1. ctx.secrets.resolve({ ref: oauthCredentialRef, purpose: 'ads.publish.google:oauth:...' })
     → { plaintext: <access_token> }
2. ctx.secrets.resolve({ ref: developerTokenCredentialRef, purpose: 'ads.publish.google:developerToken:...' })
     → { plaintext: <developer_token> }
3. POST /v18/customers/{id}/campaignBudgets:mutate
     → budgetResourceName
4. POST /v18/customers/{id}/campaigns:mutate (with budget + bidding strategy)
     → campaignResourceName
5. POST /v18/customers/{id}/adGroups:mutate
     → adGroupResourceName
6. POST /v18/customers/{id}/adGroupAds:mutate (responsive_search OR responsive_display)
     → adGroupAdResourceName
```

Optional `loginCustomerId` for MCC accounts → sent as `login-customer-id` header.

## Rollback semantics (REVERSE order, no cascade)

Google Ads API has **no cascade-delete** semantics — every entity must be removed individually. Pack rolls back in REVERSE creation order:

```
ad → adGroup → campaign → budget
```

Each rollback is a `remove: <resourceName>` mutation. Failures are logged but never re-raised — the original error surfaces.

## Bidding strategy options (6 total)

| Strategy | Additional fields |
|---|---|
| `TARGET_CPA` | requires `campaign.targetCpaMicros` |
| `TARGET_ROAS` | requires `campaign.targetRoas` (1.0 = break-even; 4.0 = 4× return) |
| `MAXIMIZE_CONVERSIONS` | no extra |
| `MAXIMIZE_CONVERSION_VALUE` | no extra |
| `MAXIMIZE_CLICKS` | no extra |
| `MANUAL_CPC` | `adGroup.cpcBidMicros` is meaningful |

## Channel types (6 total)

`SEARCH` / `DISPLAY` / `SHOPPING` / `VIDEO` / `PERFORMANCE_MAX` / `DEMAND_GEN`

## Ad formats (2 in v1)

| Format | When to use | Required fields |
|---|---|---|
| `responsive_search` | SEARCH campaigns | `headlines[]`, `descriptions[]`, `finalUrls[]`, optional `path1` / `path2` |
| `responsive_display` | DISPLAY campaigns | All of the above + `longHeadline`, `businessName`, `marketingImages[]` (asset resource names) |

## NFR-7 plaintext discipline

Same rules as `ads-publish-meta` for BOTH secrets:
- Held only in local variables for the duration of the pipeline
- Never logged via `ctx.log`
- Never returned in outputs
- Never passed to other `ctx.*` methods
- `purpose` field required for each `resolve` call (audit-logged by host)

The developer-token + access-token combination is appendage to every `fetch()` call's headers; nowhere else.

## Failure-mode mapping

Secret-resolution errors (same map as `ads-publish-meta`):

| Spec code | Pack code | retryable |
|---|---|---|
| `secret_not_found` | `CREDENTIAL_NOT_FOUND` | false |
| `secret_access_denied` | `CREDENTIAL_ACCESS_DENIED` | false |
| `secret_expired` | `CREDENTIAL_EXPIRED` | false |
| `secret_revoked` | `CREDENTIAL_REVOKED` | false |
| `secret_quota_exhausted` | `CREDENTIAL_RESOLVE_FAILED` | **true** |

`details.credential` reports which of the two failed: `'oauth'` or `'developerToken'`.

Google Ads API errors:

| HTTP | Pack code | retryable |
|---|---|---|
| `429` | `GOOGLE_RATE_LIMIT` | **true** |
| `5xx` | `GOOGLE_SERVER_ERROR` | **true** |
| `401` | `GOOGLE_AUTH_EXPIRED` | false |
| `403` | `GOOGLE_PERMISSION_DENIED` | false |
| `400` | `GOOGLE_INVALID_PARAMS` | false |
| other | `GOOGLE_PUBLISH_FAILED` | false |

`details.stage` reports failure point: `pre-flight` / `budget` / `campaign` / `ad-group` / `ad`. `details.rolledBack` reports per-entity rollback success.

## Differences vs MyndHyve source

**`GAQL :search` for insights** → out of scope (use `vendor.myndhyve.ads-metrics-import` after fetching via separate workflow node).

**`listAccessibleCustomers`** → out of scope (host-side concern for credential setup).

**Connection registry / publish record cache / approval workflow** → host concerns (same as `ads-publish-meta`).

**Resource-name format validation for insights GAQL** → moot (no insights in this pack).

**Customer ID dash-stripping** → preserved exactly.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `adsPublishGoogle` + helpers | `GoogleAdsClient.ts` (398) + `AdPublishService.publishToGoogle` extract | ~480 |

~480 LOC TS ported to ~410 LOC pure JS.

## Activation note

Pack ships ready. Activates when a host:
1. Advertises `secrets.resolveInPack: supported`
2. Implements `ctx.secrets.resolve({ ref, purpose })`
3. Has both a Google OAuth token AND a developer-token stored, each retrievable by separate opaque refs

MyndHyve already stores both in its credential namespace; needs adapter wrapping that store as `ctx.secrets.resolve`.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
