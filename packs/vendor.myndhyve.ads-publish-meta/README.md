# vendor.myndhyve.ads-publish-meta

> `ads.publish.meta` — publish an ad to **Meta Marketing API v21.0** (Facebook + Instagram). **First consumer of the `secrets.resolveInPack` sub-capability** ([spec PR #52](../../spec/v1/host-capabilities.md#host-secrets)).

## Node

| typeId | Role | Behavior |
|---|---|---|
| `ads.publish.meta` | action (external HTTP + credentials) | 4-step publish pipeline: resolve OAuth → upload creative → create campaign → create ad set → create ad. Best-effort rollback on partial failure. |

## Required host capability

```json
"peerDependencies": {
  "secrets.resolveInPack": "supported"
}
```

Per [spec §host.secrets](../../spec/v1/host-capabilities.md#host-secrets). The pack calls `ctx.secrets.resolve({ ref, purpose })` to get the OAuth access token plaintext, then calls Meta's Graph API directly via `fetch()`.

## Publish pipeline

```
1. ctx.secrets.resolve({ ref: inputs.credentialRef, purpose })
     → { plaintext: <OAuth token>, expiresAt? }
2. POST /v21.0/act_{adAccountId}/adcreatives
     → { creativeId }
3. POST /v21.0/act_{adAccountId}/campaigns
     → { campaignId }
4. POST /v21.0/act_{adAccountId}/adsets (with campaignId + targeting)
     → { adSetId }
5. POST /v21.0/act_{adAccountId}/ads (with adSetId + creativeId)
     → { adId }
```

## Rollback semantics

On partial failure, the pack runs best-effort rollback:

| Failed at | Rollback |
|---|---|
| Creative upload | none (no resources created) |
| Campaign | delete creative (orphan; ad creatives are account-level, independent of campaigns) |
| Ad set | delete campaign (cascade-deletes ad sets + ads) **and** delete orphan creative (creatives are NOT cascaded by campaign delete) |
| Ad | delete campaign (cascade) **and** delete orphan creative (only when `adId` was never assigned) |

`details.rolledBack: { campaign: bool, creative: bool }` reports what the rollback attempted. Rollback failures are logged but never re-raised — the original error is what surfaces to the caller.

## Hard rules (NFR-7 — Sensitive Data Redaction)

The OAuth plaintext from `ctx.secrets.resolve` flows through this pack and out to Meta's API. The pack obeys the hard rules from [spec §host.secrets](../../spec/v1/host-capabilities.md#host-secrets):

- Plaintext is held only in a local variable for the duration of the pipeline
- Never logged via `ctx.log` (token is only ever inside `Authorization: Bearer ...` headers)
- Never passed to other `ctx.*` methods
- Never returned in outputs
- `purpose` is required in the resolve call (audit-logged by host)

## Failure-mode mapping

`ctx.secrets.resolve` errors:
| Spec code | Pack code | retryable |
|---|---|---|
| `secret_not_found` | `CREDENTIAL_NOT_FOUND` | false |
| `secret_access_denied` | `CREDENTIAL_ACCESS_DENIED` | false |
| `secret_expired` | `CREDENTIAL_EXPIRED` | false |
| `secret_revoked` | `CREDENTIAL_REVOKED` | false |
| `secret_quota_exhausted` | `CREDENTIAL_RESOLVE_FAILED` | **true** |
| any other | `CREDENTIAL_RESOLVE_FAILED` | false |

Meta API errors:
| HTTP / Meta code | Pack code | retryable |
|---|---|---|
| `429` | `META_RATE_LIMIT` | **true** |
| `5xx` | `META_SERVER_ERROR` | **true** |
| `401` OR Meta code `190` | `META_AUTH_EXPIRED` | false |
| `403` | `META_PERMISSION_DENIED` | false |
| Meta code `100` | `META_INVALID_PARAMS` | false |
| any other | `META_PUBLISH_FAILED` | false |

`details.stage` reports where in the pipeline the failure happened: `pre-flight / creative / campaign / ad-set / ad`. `details.partialState` reports what IDs were created before the failure (helpful for callers debugging partial publishes).

## Pre-flight input validation

Every enum-typed Meta field is validated **before any host call** — saves spurious `ctx.secrets.resolve` calls when inputs are obviously wrong:

| Field | Enum |
|---|---|
| `campaign.objective` | 6 values: `OUTCOME_AWARENESS / ENGAGEMENT / LEADS / SALES / TRAFFIC / APP_PROMOTION` |
| `campaign.status` / `adSet.status` / `ad.status` | `ACTIVE / PAUSED` (default `PAUSED` — safe-by-default, no auto-spend) |
| `campaign.bidStrategy` | 3 values |
| `adSet.billingEvent` | `IMPRESSIONS / LINK_CLICKS / APP_INSTALLS` |
| `creative.videoId` OR `creative.linkUrl` | At least one required |

## Differences vs MyndHyve source

**Connection registry (`Map<id, PlatformConnection>`)** → dropped. Host owns credential storage; pack resolves opaque ref via `ctx.secrets.resolve`.

**Publish record cache (`Map<id, PublishRecord>`)** → dropped. Host emits run events; pack returns the success payload.

**Approval workflow gating** → dropped. Workflow author wires an `approvalGate` node upstream of this pack if approval is required.

**OAuth refresh** → dropped. Host's secret-resolve is expected to return a fresh token (rotated host-side). Pack treats every resolve as a fresh credential.

**Budget multiplication by 100 (dollars → cents)** → preserved exactly. Pack accepts dollars in inputs and multiplies for Meta's cents-integer wire format.

**Default `PAUSED` status** → preserved. No ad ever auto-publishes without explicit `ACTIVE` in inputs.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `adsPublishMeta` + helpers | `MetaAdsClient.ts` (400) + `AdPublishService.publishToMeta` extract | ~480 |

~480 LOC TS effectively compressed to ~370 LOC pure JS (connection cache + publish record + approval workflow + OAuth refresh moved to host).

## Activation note

Pack ships ready. Activates when a host:
1. Advertises `secrets.resolveInPack: supported` in `Capabilities`
2. Implements `ctx.secrets.resolve({ ref, purpose })` returning `{ plaintext, expiresAt? }`
3. Has Meta OAuth tokens stored in its credential namespace, retrievable by opaque ref

MyndHyve's host already stores Meta OAuth tokens (per `AdPublishService.PlatformConnection`); needs an adapter wrapping that store as `ctx.secrets.resolve` per the new sub-cap. Host-side work, separate from this pack.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
