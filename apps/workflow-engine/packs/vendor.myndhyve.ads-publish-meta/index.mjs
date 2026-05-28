/**
 * vendor.myndhyve.ads-publish-meta
 *
 * Single typeId: `ads.publish.meta`
 *
 * Publishes an ad to Meta Marketing API v21.0 (Facebook/Instagram).
 * First consumer of the secrets.resolveInPack sub-capability (spec PR #52).
 *
 * Pipeline (matches MyndHyve source AdPublishService.publishToMeta):
 *   1. Resolve OAuth access token via ctx.secrets.resolve(credentialRef)
 *   2. Upload creative (adcreatives endpoint) — link or video format
 *   3. Create campaign (campaigns endpoint)
 *   4. Create ad set (adsets endpoint) with targeting + budget
 *   5. Create ad (ads endpoint) bound to campaign + ad set + creative
 *   6. Return all 4 entity IDs + creative_id + access metadata
 *
 * Failures roll back partial state via best-effort delete (campaign
 * cascade-deletes its ad sets + ads + creatives on Meta's side, so
 * single rollback of the campaign id is sufficient).
 *
 * Source: src/canvas-types/campaign-studio/ads-studio/publish/
 *   MetaAdsClient.ts (400 LOC) + AdPublishService publish-flow extract.
 *
 * Pure-JS, Node-20 stdlib only (uses global fetch).
 */

const META_API_BASE = 'https://graph.facebook.com/v21.0';

const VALID_OBJECTIVES = [
  'OUTCOME_AWARENESS',
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_LEADS',
  'OUTCOME_SALES',
  'OUTCOME_TRAFFIC',
  'OUTCOME_APP_PROMOTION',
];

const VALID_STATUSES = ['ACTIVE', 'PAUSED'];

const VALID_BID_STRATEGIES = ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'];

const VALID_BILLING_EVENTS = ['IMPRESSIONS', 'LINK_CLICKS', 'APP_INSTALLS'];

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

function formatTargeting(targeting) {
  const result = {};
  if (!targeting || typeof targeting !== 'object') return result;

  if (targeting.geoLocations) result.geo_locations = targeting.geoLocations;
  if (Number.isFinite(Number(targeting.ageMin))) result.age_min = Number(targeting.ageMin);
  if (Number.isFinite(Number(targeting.ageMax))) result.age_max = Number(targeting.ageMax);
  if (Array.isArray(targeting.genders)) result.genders = targeting.genders;
  if (Array.isArray(targeting.interests)) {
    result.flexible_spec = [{ interests: targeting.interests }];
  }
  if (Array.isArray(targeting.behaviors)) {
    const flexSpec = result.flexible_spec ?? [{}];
    flexSpec[0].behaviors = targeting.behaviors;
    result.flexible_spec = flexSpec;
  }
  if (Array.isArray(targeting.customAudiences)) result.custom_audiences = targeting.customAudiences;
  if (Array.isArray(targeting.excludedCustomAudiences)) result.excluded_custom_audiences = targeting.excludedCustomAudiences;

  return result;
}

function classifyMetaError(status, apiError) {
  // Map Meta error codes to retryability semantics per spec failure-mode glossary.
  if (status === 429) return { code: 'meta_rate_limit', retryable: true };
  if (status >= 500) return { code: 'meta_server_error', retryable: true };
  if (status === 401) return { code: 'meta_auth_expired', retryable: false };
  if (status === 403) return { code: 'meta_permission_denied', retryable: false };
  if (apiError?.code === 100) return { code: 'meta_invalid_params', retryable: false };
  if (apiError?.code === 190) return { code: 'meta_auth_expired', retryable: false };
  return { code: 'meta_request_failed', retryable: false };
}

async function metaPost(accessToken, path, body, log) {
  const url = `${META_API_BASE}/${path}`;
  log.debug('Meta POST', { path });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const apiError = errorBody?.error;
    const cls = classifyMetaError(response.status, apiError);
    const message = apiError?.message ?? `Meta Ads API error: ${response.status}`;
    log.error('Meta API error', { path, status: response.status, code: cls.code, apiError });
    throw Object.assign(new Error(message), {
      code: cls.code,
      retryable: cls.retryable,
      statusCode: response.status,
      apiError,
      path,
    });
  }

  return await response.json();
}

async function metaDelete(accessToken, path, log) {
  const url = `${META_API_BASE}/${path}`;
  log.debug('Meta DELETE', { path });
  try {
    await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
  } catch (err) {
    log.warn('Meta rollback DELETE failed (continuing)', { path, error: String(err?.message ?? err) });
  }
}

async function uploadCreative(accessToken, adAccountId, params, log) {
  const objectStorySpec = { page_id: params.pageId };

  if (params.videoId) {
    objectStorySpec.video_data = {
      video_id: params.videoId,
      title: params.title,
      message: params.body,
      ...(params.callToAction ? { call_to_action: { type: params.callToAction.type, value: params.callToAction.value } } : {}),
    };
  } else {
    objectStorySpec.link_data = {
      link: params.linkUrl,
      message: params.body,
      name: params.title,
      ...(params.imageHash ? { image_hash: params.imageHash } : {}),
      ...(params.callToAction ? { call_to_action: { type: params.callToAction.type, value: params.callToAction.value } } : {}),
    };
  }

  return metaPost(accessToken, `act_${adAccountId}/adcreatives`, {
    name: params.name,
    object_story_spec: objectStorySpec,
  }, log);
}

async function createCampaign(accessToken, adAccountId, params, log) {
  const body = {
    name: params.name,
    objective: params.objective,
    status: params.status ?? 'PAUSED',
    special_ad_categories: params.specialAdCategories ?? [],
  };
  if (Number.isFinite(Number(params.dailyBudget))) body.daily_budget = Math.round(Number(params.dailyBudget) * 100);
  if (Number.isFinite(Number(params.lifetimeBudget))) body.lifetime_budget = Math.round(Number(params.lifetimeBudget) * 100);
  if (params.bidStrategy) body.bid_strategy = params.bidStrategy;

  return metaPost(accessToken, `act_${adAccountId}/campaigns`, body, log);
}

async function createAdSet(accessToken, adAccountId, params, log) {
  const baseTargeting = formatTargeting(params.targeting);
  const targeting = params.placements
    ? {
        ...baseTargeting,
        device_platforms: params.placements.devicePlatforms,
        publisher_platforms: params.placements.publisherPlatforms,
        facebook_positions: params.placements.facebookPositions,
        instagram_positions: params.placements.instagramPositions,
      }
    : baseTargeting;

  const body = {
    name: params.name,
    campaign_id: params.campaignId,
    targeting,
    billing_event: params.billingEvent,
    optimization_goal: params.optimizationGoal,
    status: params.status ?? 'PAUSED',
  };
  if (Number.isFinite(Number(params.dailyBudget))) body.daily_budget = Math.round(Number(params.dailyBudget) * 100);
  if (Number.isFinite(Number(params.lifetimeBudget))) body.lifetime_budget = Math.round(Number(params.lifetimeBudget) * 100);
  if (params.startTime) body.start_time = params.startTime;
  if (params.endTime) body.end_time = params.endTime;

  return metaPost(accessToken, `act_${adAccountId}/adsets`, body, log);
}

async function createAd(accessToken, adAccountId, params, log) {
  const body = {
    name: params.name,
    adset_id: params.adSetId,
    creative: { creative_id: params.creativeId },
    status: params.status ?? 'PAUSED',
  };
  if (Array.isArray(params.trackingSpecs)) {
    body.tracking_specs = params.trackingSpecs.map((spec) => ({
      'action.type': spec.action_type,
      ...(spec.fbPixel ? { fb_pixel: spec.fbPixel } : {}),
    }));
  }
  return metaPost(accessToken, `act_${adAccountId}/ads`, body, log);
}

export async function adsPublishMeta(ctx) {
  ensureSecretsResolve(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  // Pre-flight input validation
  if (typeof inputs.credentialRef !== 'string' || inputs.credentialRef.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.credentialRef is required (opaque secret reference for Meta OAuth token)', retryable: false } };
  }
  if (typeof inputs.adAccountId !== 'string' || inputs.adAccountId.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.adAccountId is required (Meta ad account id, without the "act_" prefix)', retryable: false } };
  }
  if (typeof inputs.pageId !== 'string' || inputs.pageId.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.pageId is required (Facebook page id that owns the ad)', retryable: false } };
  }

  const campaign = inputs.campaign ?? {};
  if (typeof campaign.name !== 'string' || campaign.name.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.campaign.name is required', retryable: false } };
  }
  if (!VALID_OBJECTIVES.includes(campaign.objective)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.campaign.objective must be one of: ${VALID_OBJECTIVES.join(', ')}`, retryable: false } };
  }
  if (campaign.status && !VALID_STATUSES.includes(campaign.status)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.campaign.status must be ACTIVE or PAUSED`, retryable: false } };
  }
  if (campaign.bidStrategy && !VALID_BID_STRATEGIES.includes(campaign.bidStrategy)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.campaign.bidStrategy invalid`, retryable: false } };
  }

  const adSet = inputs.adSet ?? {};
  if (typeof adSet.name !== 'string' || adSet.name.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.adSet.name is required', retryable: false } };
  }
  if (!VALID_BILLING_EVENTS.includes(adSet.billingEvent)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.adSet.billingEvent must be one of: ${VALID_BILLING_EVENTS.join(', ')}`, retryable: false } };
  }
  if (typeof adSet.optimizationGoal !== 'string' || adSet.optimizationGoal.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.adSet.optimizationGoal is required', retryable: false } };
  }

  const creative = inputs.creative ?? {};
  if (typeof creative.name !== 'string' || creative.name.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.creative.name is required', retryable: false } };
  }
  if (!creative.videoId && !creative.linkUrl) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.creative must have either videoId (for video ads) or linkUrl (for link/image ads)', retryable: false } };
  }

  const ad = inputs.ad ?? {};
  if (typeof ad.name !== 'string' || ad.name.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.ad.name is required', retryable: false } };
  }

  // Step 1: Resolve OAuth access token via host secret-resolve
  log.debug('Resolving Meta OAuth token', { credentialRef: inputs.credentialRef });
  let secretResolution;
  try {
    secretResolution = await ctx.secrets.resolve({
      ref: inputs.credentialRef,
      purpose: `ads.publish.meta:${ctx.runId ?? 'unknown'}:campaign-${campaign.name}`,
    });
  } catch (err) {
    log.error('Secret resolution failed', { error: String(err?.message ?? err), code: err?.code });
    return {
      status: 'error',
      error: {
        code: err?.code === 'secret_not_found' ? 'CREDENTIAL_NOT_FOUND'
          : err?.code === 'secret_access_denied' ? 'CREDENTIAL_ACCESS_DENIED'
          : err?.code === 'secret_expired' ? 'CREDENTIAL_EXPIRED'
          : err?.code === 'secret_revoked' ? 'CREDENTIAL_REVOKED'
          : 'CREDENTIAL_RESOLVE_FAILED',
        message: String(err?.message ?? err),
        retryable: err?.code === 'secret_quota_exhausted',
      },
    };
  }

  const accessToken = secretResolution?.plaintext;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return { status: 'error', error: { code: 'CREDENTIAL_RESOLVE_FAILED', message: 'host returned empty plaintext for credential ref', retryable: false } };
  }

  log.info('Publishing ad to Meta', {
    adAccountId: inputs.adAccountId,
    campaignName: campaign.name,
    objective: campaign.objective,
  });

  // Track partial state for rollback
  let campaignId = null;
  let adSetId = null;
  let creativeId = null;
  let adId = null;

  try {
    // Step 2: Upload creative (Meta requires creative before ad)
    log.debug('Uploading creative');
    const creativeResp = await uploadCreative(accessToken, inputs.adAccountId, {
      name: creative.name,
      title: creative.title,
      body: creative.body,
      linkUrl: creative.linkUrl,
      imageHash: creative.imageHash,
      videoId: creative.videoId,
      callToAction: creative.callToAction,
      pageId: inputs.pageId,
    }, log);
    creativeId = creativeResp.id;

    // Step 3: Create campaign
    log.debug('Creating campaign');
    const campResp = await createCampaign(accessToken, inputs.adAccountId, campaign, log);
    campaignId = campResp.id;

    // Step 4: Create ad set
    log.debug('Creating ad set');
    const adSetResp = await createAdSet(accessToken, inputs.adAccountId, { ...adSet, campaignId }, log);
    adSetId = adSetResp.id;

    // Step 5: Create ad
    log.debug('Creating ad');
    const adResp = await createAd(accessToken, inputs.adAccountId, { ...ad, adSetId, creativeId }, log);
    adId = adResp.id;

    log.info('Meta ad published', { campaignId, adSetId, creativeId, adId });

    return {
      status: 'success',
      outputs: {
        platform: 'meta',
        adAccountId: inputs.adAccountId,
        campaignId,
        adSetId,
        creativeId,
        adId,
        publishedStatus: campaign.status ?? 'PAUSED',
        publishedAt: new Date().toISOString(),
        success: true,
      },
    };
  } catch (err) {
    log.error('Meta publish failed', {
      error: String(err?.message ?? err),
      code: err?.code,
      partialState: { campaignId, adSetId, creativeId, adId },
    });

    // Best-effort rollback: deleting the campaign cascades to ad sets + ads
    // Creative is independent and only orphans (no charges); we delete it separately
    if (campaignId) {
      log.debug('Rolling back campaign');
      await metaDelete(accessToken, campaignId, log);
    }
    if (creativeId && !adId) {
      // Only delete orphaned creative (when ad creation failed before referencing it)
      log.debug('Rolling back orphaned creative');
      await metaDelete(accessToken, creativeId, log);
    }

    return {
      status: 'error',
      error: {
        code: err?.code === 'meta_rate_limit' ? 'META_RATE_LIMIT'
          : err?.code === 'meta_server_error' ? 'META_SERVER_ERROR'
          : err?.code === 'meta_auth_expired' ? 'META_AUTH_EXPIRED'
          : err?.code === 'meta_permission_denied' ? 'META_PERMISSION_DENIED'
          : err?.code === 'meta_invalid_params' ? 'META_INVALID_PARAMS'
          : 'META_PUBLISH_FAILED',
        message: String(err?.message ?? err),
        retryable: err?.retryable === true,
        details: {
          stage: campaignId ? (adSetId ? (adId ? 'ad' : 'ad-set') : 'campaign') : (creativeId ? 'creative' : 'pre-flight'),
          rolledBack: {
            campaign: !!campaignId,
            creative: !!(creativeId && !adId),
          },
          partialState: { campaignId, adSetId, creativeId, adId: null },
          metaApiError: err?.apiError,
        },
      },
    };
  }
}

const nodes = {
  'ads.publish.meta': adsPublishMeta,
};

export default nodes;
