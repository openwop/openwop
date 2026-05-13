/**
 * vendor.myndhyve.ads-publish-tiktok
 *
 * Single typeId: `ads.publish.tiktok`
 *
 * Publishes an ad to TikTok Marketing API v1.3. Third + final platform-
 * publish pack. Symmetric with ads-publish-meta + ads-publish-google but
 * adapted for TikTok's quirks:
 *   - Access-Token header (NOT Bearer) — single secret
 *   - Response envelope { code, message, data } where code !== 0 means
 *     business error even on HTTP 200
 *   - Snake_case API fields throughout
 *   - 3-step pipeline (no separate budget creation; budget lives on
 *     campaign + ad group)
 *   - DISABLE/ENABLE statuses (vs PAUSED/ACTIVE on Meta, PAUSED/ENABLED
 *     on Google)
 *   - Optional image upload by URL before ad creation
 *
 * Pipeline (matches MyndHyve source AdPublishService.publishToTikTok):
 *   1. Resolve OAuth access token via ctx.secrets.resolve(credentialRef)
 *   2. [optional] Upload image via /file/image/ad/upload/ (URL → image_id)
 *      when inputs.imageUploadUrl is supplied AND inputs.imageId is not
 *   3. POST /campaign/create/ → campaignId
 *   4. POST /adgroup/create/ → adGroupId (with budget + targeting + placements)
 *   5. POST /ad/create/ → adId (with creative payload)
 *   6. Return all entity IDs
 *
 * Rollback: TikTok API supports status changes (ENABLE/DISABLE) but no
 * hard-delete for created entities via this API — they accumulate as
 * DISABLED draft state. Pack does NOT attempt rollback (best practice
 * with TikTok); reports partialState in error details for manual cleanup.
 *
 * Source: src/canvas-types/campaign-studio/ads-studio/publish/
 *   TikTokAdsClient.ts (349 LOC) + AdPublishService.publishToTikTok extract.
 *
 * Pure-JS, Node-20 stdlib only (uses global fetch).
 */

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

const VALID_OBJECTIVES = [
  'REACH', 'TRAFFIC', 'VIDEO_VIEWS',
  'LEAD_GENERATION', 'CONVERSIONS',
  'APP_PROMOTION', 'PRODUCT_SALES',
];
const VALID_BUDGET_MODES = ['BUDGET_MODE_DAY', 'BUDGET_MODE_TOTAL', 'BUDGET_MODE_INFINITE'];
const VALID_OPTIMIZATION_GOALS = ['CLICK', 'CONVERT', 'IMPRESSION', 'REACH', 'VIDEO_VIEW', 'LEAD_GENERATION'];
const VALID_PLACEMENTS = ['PLACEMENT_TIKTOK', 'PLACEMENT_PANGLE', 'PLACEMENT_GLOBAL_APP_BUNDLE'];
const VALID_OPERATION_STATUSES = ['ENABLE', 'DISABLE'];
const VALID_GENDERS = ['GENDER_MALE', 'GENDER_FEMALE', 'GENDER_UNLIMITED'];

function makeLog(ctx) {
  const fn = typeof ctx?.log === 'function' ? ctx.log : null;
  return {
    debug: (msg, data) => { if (fn) fn('debug', msg, data); },
    info: (msg, data) => { if (fn) fn('info', msg, data); },
    warn: (msg, data) => { if (fn) fn('warn', msg, data); },
    error: (msg, data) => { if (fn) fn('error', msg, data); },
  };
}

function ensureSecretsResolve(ctx) {
  if (!ctx.secrets || typeof ctx.secrets.resolve !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.secrets.resolve — workflow-register should have refused this pack at peerDependency resolution time. Host must advertise secrets.resolveInPack: supported per spec/v1/host-capabilities.md §host.secrets.'),
      { code: 'host_capability_missing', capability: 'secrets.resolveInPack' },
    );
  }
}

// TikTok-specific error classifier. TikTok uses HTTP 200 even for business
// errors — failure is signaled via response.code !== 0. Pack treats both
// HTTP and business errors uniformly.
function classifyTikTokError(httpStatus, businessCode) {
  // Network-level
  if (httpStatus === 429) return { code: 'tiktok_rate_limit', retryable: true };
  if (httpStatus >= 500) return { code: 'tiktok_server_error', retryable: true };
  if (httpStatus === 401) return { code: 'tiktok_auth_expired', retryable: false };
  if (httpStatus === 403) return { code: 'tiktok_permission_denied', retryable: false };
  // Business-level (HTTP 200 + code != 0)
  if (businessCode === 40000 || businessCode === 40001) return { code: 'tiktok_invalid_params', retryable: false };
  if (businessCode === 40002) return { code: 'tiktok_auth_expired', retryable: false };
  if (businessCode === 40100 || businessCode === 40101) return { code: 'tiktok_permission_denied', retryable: false };
  if (businessCode === 50000) return { code: 'tiktok_server_error', retryable: true };
  if (businessCode === 51301) return { code: 'tiktok_rate_limit', retryable: true };
  return { code: 'tiktok_request_failed', retryable: false };
}

async function tiktokPost(accessToken, path, body, log) {
  const url = `${TIKTOK_API_BASE}${path}`;
  log.debug('TikTok POST', { path });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const cls = classifyTikTokError(response.status, undefined);
    const message = errorBody?.message ?? `TikTok Ads API error: ${response.status}`;
    log.error('TikTok HTTP error', { path, status: response.status, code: cls.code });
    throw Object.assign(new Error(message), {
      code: cls.code,
      retryable: cls.retryable,
      statusCode: response.status,
      apiError: errorBody,
      path,
    });
  }

  const result = await response.json();
  // TikTok envelope: { code, message, data, request_id }
  if (result.code !== 0) {
    const cls = classifyTikTokError(response.status, result.code);
    const message = result.message ?? `TikTok business error: code ${result.code}`;
    log.error('TikTok business error', { path, businessCode: result.code, message });
    throw Object.assign(new Error(message), {
      code: cls.code,
      retryable: cls.retryable,
      statusCode: response.status,
      businessCode: result.code,
      requestId: result.request_id,
      path,
    });
  }

  return result.data;
}

async function uploadImageByUrl(accessToken, advertiserId, imageUrl, fileName, log) {
  const data = await tiktokPost(accessToken, '/file/image/ad/upload/', {
    advertiser_id: advertiserId,
    image_url: imageUrl,
    file_name: fileName ?? 'image.jpg',
  }, log);
  return data?.id ?? null;
}

async function createCampaign(accessToken, advertiserId, params, log) {
  const body = {
    advertiser_id: advertiserId,
    campaign_name: params.name,
    objective_type: params.objective,
    budget_mode: params.budgetMode ?? 'BUDGET_MODE_INFINITE',
    operation_status: params.operationStatus ?? 'DISABLE',
  };
  if (Number.isFinite(Number(params.budget))) body.budget = Number(params.budget);

  const data = await tiktokPost(accessToken, '/campaign/create/', body, log);
  return data?.campaign_id ?? null;
}

async function createAdGroup(accessToken, advertiserId, params, log) {
  const body = {
    advertiser_id: advertiserId,
    campaign_id: params.campaignId,
    adgroup_name: params.name,
    optimization_goal: params.optimizationGoal,
    budget_mode: params.budgetMode ?? 'BUDGET_MODE_DAY',
    operation_status: params.operationStatus ?? 'DISABLE',
  };
  if (Array.isArray(params.placements) && params.placements.length > 0) body.placements = params.placements;
  if (Number.isFinite(Number(params.bidPrice))) body.bid_price = Number(params.bidPrice);
  if (Number.isFinite(Number(params.budget))) body.budget = Number(params.budget);
  if (params.scheduleStartTime) body.schedule_start_time = params.scheduleStartTime;
  if (params.scheduleEndTime) body.schedule_end_time = params.scheduleEndTime;

  // Targeting
  if (Array.isArray(params.locationIds)) body.location_ids = params.locationIds;
  if (Array.isArray(params.ageGroups)) body.age_groups = params.ageGroups;
  if (Array.isArray(params.genders)) body.gender = params.genders;
  if (Array.isArray(params.languages)) body.languages = params.languages;
  if (Array.isArray(params.interestCategoryIds)) body.interest_category_ids = params.interestCategoryIds;

  const data = await tiktokPost(accessToken, '/adgroup/create/', body, log);
  return data?.adgroup_id ?? null;
}

async function createAd(accessToken, advertiserId, params, log) {
  const creative = {
    ad_name: params.name,
    ad_text: params.adText,
    call_to_action: params.callToAction ?? 'LEARN_MORE',
  };
  if (params.landingPageUrl) creative.landing_page_url = params.landingPageUrl;
  if (params.displayName) creative.display_name = params.displayName;
  if (Array.isArray(params.imageIds) && params.imageIds.length > 0) creative.image_ids = params.imageIds;
  if (params.videoId) creative.video_id = params.videoId;

  const body = {
    advertiser_id: advertiserId,
    adgroup_id: params.adGroupId,
    creatives: [creative],
    operation_status: params.operationStatus ?? 'DISABLE',
  };

  const data = await tiktokPost(accessToken, '/ad/create/', body, log);
  // Response: { ad_ids: [...] }
  const adIds = Array.isArray(data?.ad_ids) ? data.ad_ids : [];
  return adIds[0] ?? null;
}

function mapSecretError(err) {
  const code = err?.code;
  if (code === 'secret_not_found') return { code: 'CREDENTIAL_NOT_FOUND', retryable: false };
  if (code === 'secret_access_denied') return { code: 'CREDENTIAL_ACCESS_DENIED', retryable: false };
  if (code === 'secret_expired') return { code: 'CREDENTIAL_EXPIRED', retryable: false };
  if (code === 'secret_revoked') return { code: 'CREDENTIAL_REVOKED', retryable: false };
  if (code === 'secret_quota_exhausted') return { code: 'CREDENTIAL_RESOLVE_FAILED', retryable: true };
  return { code: 'CREDENTIAL_RESOLVE_FAILED', retryable: false };
}

export async function adsPublishTiktok(ctx) {
  ensureSecretsResolve(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};

  // ── Pre-flight validation ──
  if (typeof inputs.credentialRef !== 'string' || inputs.credentialRef.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.credentialRef is required (opaque ref for TikTok OAuth access token)', retryable: false } };
  }
  if (typeof inputs.advertiserId !== 'string' || inputs.advertiserId.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.advertiserId is required (TikTok advertiser id)', retryable: false } };
  }

  const campaign = inputs.campaign ?? {};
  if (typeof campaign.name !== 'string' || campaign.name.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.campaign.name is required', retryable: false } };
  }
  if (!VALID_OBJECTIVES.includes(campaign.objective)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.campaign.objective must be one of: ${VALID_OBJECTIVES.join(', ')}`, retryable: false } };
  }
  if (campaign.budgetMode && !VALID_BUDGET_MODES.includes(campaign.budgetMode)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.campaign.budgetMode invalid`, retryable: false } };
  }
  if (campaign.operationStatus && !VALID_OPERATION_STATUSES.includes(campaign.operationStatus)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.campaign.operationStatus must be ENABLE or DISABLE`, retryable: false } };
  }

  const adGroup = inputs.adGroup ?? {};
  if (typeof adGroup.name !== 'string' || adGroup.name.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.adGroup.name is required', retryable: false } };
  }
  if (!VALID_OPTIMIZATION_GOALS.includes(adGroup.optimizationGoal)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.adGroup.optimizationGoal must be one of: ${VALID_OPTIMIZATION_GOALS.join(', ')}`, retryable: false } };
  }
  if (Array.isArray(adGroup.placements)) {
    const bad = adGroup.placements.filter((p) => !VALID_PLACEMENTS.includes(p));
    if (bad.length > 0) {
      return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.adGroup.placements contains invalid values: ${bad.join(', ')}. Must be one of: ${VALID_PLACEMENTS.join(', ')}`, retryable: false } };
    }
  }
  if (Array.isArray(adGroup.genders)) {
    const bad = adGroup.genders.filter((g) => !VALID_GENDERS.includes(g));
    if (bad.length > 0) {
      return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.adGroup.genders contains invalid values: ${bad.join(', ')}`, retryable: false } };
    }
  }

  const ad = inputs.ad ?? {};
  if (typeof ad.name !== 'string' || ad.name.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.ad.name is required', retryable: false } };
  }
  if (typeof ad.adText !== 'string' || ad.adText.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.ad.adText is required', retryable: false } };
  }
  const hasVideo = typeof ad.videoId === 'string' && ad.videoId.length > 0;
  const hasImageIds = Array.isArray(ad.imageIds) && ad.imageIds.length > 0;
  const hasImageUrl = typeof inputs.imageUploadUrl === 'string' && inputs.imageUploadUrl.length > 0;
  if (!hasVideo && !hasImageIds && !hasImageUrl) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'must provide one of: inputs.ad.videoId / inputs.ad.imageIds[] / inputs.imageUploadUrl (for url-upload)', retryable: false } };
  }

  // ── Resolve secret ──
  let accessToken;
  try {
    const resolution = await ctx.secrets.resolve({
      ref: inputs.credentialRef,
      purpose: `ads.publish.tiktok:${ctx.runId ?? 'unknown'}:campaign-${campaign.name}`,
    });
    if (!resolution || typeof resolution.plaintext !== 'string' || resolution.plaintext.length === 0) {
      throw new Error('host returned empty plaintext');
    }
    accessToken = resolution.plaintext;
  } catch (err) {
    const m = mapSecretError(err);
    return { status: 'error', error: { code: m.code, message: String(err?.message ?? err), retryable: m.retryable } };
  }

  log.info('Publishing ad to TikTok', {
    advertiserId: inputs.advertiserId,
    campaignName: campaign.name,
    objective: campaign.objective,
    hasVideo,
    hasImageIds,
    hasImageUrl,
  });

  // ── Pipeline (with partial-state tracking; no rollback per TikTok semantics) ──
  let uploadedImageId = null;
  let campaignId = null;
  let adGroupId = null;
  let adId = null;

  try {
    // Step 1: optional image upload by URL
    let resolvedImageIds = ad.imageIds;
    if (hasImageUrl && !hasImageIds && !hasVideo) {
      log.debug('Uploading image via URL');
      uploadedImageId = await uploadImageByUrl(accessToken, inputs.advertiserId, inputs.imageUploadUrl, inputs.imageFileName, log);
      if (uploadedImageId) resolvedImageIds = [uploadedImageId];
    }

    // Step 2: campaign
    log.debug('Creating TikTok campaign');
    campaignId = await createCampaign(accessToken, inputs.advertiserId, campaign, log);

    // Step 3: ad group
    log.debug('Creating TikTok ad group');
    adGroupId = await createAdGroup(accessToken, inputs.advertiserId, { ...adGroup, campaignId }, log);

    // Step 4: ad
    log.debug('Creating TikTok ad');
    adId = await createAd(accessToken, inputs.advertiserId, {
      ...ad,
      adGroupId,
      imageIds: resolvedImageIds,
    }, log);

    log.info('TikTok publish completed', { campaignId, adGroupId, adId, uploadedImageId });

    return {
      status: 'success',
      outputs: {
        platform: 'tiktok',
        advertiserId: inputs.advertiserId,
        campaignId,
        adGroupId,
        adId,
        uploadedImageId,
        publishedStatus: campaign.operationStatus ?? 'DISABLE',
        publishedAt: new Date().toISOString(),
        success: true,
      },
    };
  } catch (err) {
    log.error('TikTok publish failed', {
      error: String(err?.message ?? err),
      code: err?.code,
      businessCode: err?.businessCode,
      partialState: { uploadedImageId, campaignId, adGroupId, adId },
    });

    // TikTok API has no hard-delete via this surface — entities accumulate
    // as DISABLED draft state. Pack does NOT attempt rollback; surfaces
    // partial state for manual cleanup via partialState in details.
    return {
      status: 'error',
      error: {
        code: err?.code === 'tiktok_rate_limit' ? 'TIKTOK_RATE_LIMIT'
          : err?.code === 'tiktok_server_error' ? 'TIKTOK_SERVER_ERROR'
          : err?.code === 'tiktok_auth_expired' ? 'TIKTOK_AUTH_EXPIRED'
          : err?.code === 'tiktok_permission_denied' ? 'TIKTOK_PERMISSION_DENIED'
          : err?.code === 'tiktok_invalid_params' ? 'TIKTOK_INVALID_PARAMS'
          : 'TIKTOK_PUBLISH_FAILED',
        message: String(err?.message ?? err),
        retryable: err?.retryable === true,
        details: {
          stage: adGroupId
            ? (adId ? 'ad' : 'ad')
            : (campaignId ? 'ad-group' : (uploadedImageId ? 'campaign' : 'pre-flight')),
          partialState: { uploadedImageId, campaignId, adGroupId, adId: null },
          businessCode: err?.businessCode,
          requestId: err?.requestId,
          rollbackPolicy: 'tiktok-no-hard-delete — entities remain as DISABLED drafts; manual cleanup required',
        },
      },
    };
  }
}

const nodes = {
  'ads.publish.tiktok': adsPublishTiktok,
};

export default nodes;
