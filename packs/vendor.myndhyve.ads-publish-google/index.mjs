/**
 * vendor.myndhyve.ads-publish-google
 *
 * Single typeId: `ads.publish.google`
 *
 * Publishes an ad to Google Ads API v18 (Search + Display). Symmetric
 * companion to ads-publish-meta but adapted for Google's :mutate /
 * :search REST pattern.
 *
 * Pipeline (matches MyndHyve source AdPublishService.publishToGoogle):
 *   1. Resolve OAuth access token via ctx.secrets.resolve(oauthRef)
 *   2. Resolve developer-token via ctx.secrets.resolve(developerTokenRef)
 *   3. Create campaign budget (campaignBudgets:mutate)
 *   4. Create campaign (campaigns:mutate, references budget + bidding strategy)
 *   5. Create ad group (adGroups:mutate, references campaign)
 *   6. Create ad (adGroupAds:mutate, responsive search OR display)
 *   7. Return all 4 resource names + budget resource name
 *
 * Rollback on partial failure: best-effort REMOVE-status mutation on
 * created entities (Google Ads doesn't support hard-delete; status:REMOVED
 * is the equivalent and is what Meta's DELETE maps to semantically).
 *
 * Source: src/canvas-types/campaign-studio/ads-studio/publish/
 *   GoogleAdsClient.ts (398 LOC) + AdPublishService.publishToGoogle extract.
 *
 * Pure-JS, Node-20 stdlib only (uses global fetch).
 */

const GOOGLE_API_BASE = 'https://googleads.googleapis.com/v18';

const VALID_CHANNEL_TYPES = ['SEARCH', 'DISPLAY', 'SHOPPING', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN'];
const VALID_CAMPAIGN_STATUSES = ['ENABLED', 'PAUSED', 'REMOVED'];
const VALID_AD_GROUP_STATUSES = ['ENABLED', 'PAUSED', 'REMOVED'];
const VALID_BIDDING_STRATEGIES = [
  'TARGET_CPA', 'TARGET_ROAS',
  'MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE',
  'MAXIMIZE_CLICKS', 'MANUAL_CPC',
];
const VALID_AD_FORMATS = ['responsive_search', 'responsive_display'];

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

function classifyGoogleError(status, apiError) {
  // Map Google Ads error codes to retryability semantics.
  if (status === 429) return { code: 'google_rate_limit', retryable: true };
  if (status >= 500) return { code: 'google_server_error', retryable: true };
  if (status === 401) return { code: 'google_auth_expired', retryable: false };
  if (status === 403) return { code: 'google_permission_denied', retryable: false };
  // Google Ads API surfaces validation errors with status='INVALID_ARGUMENT' (HTTP 400)
  if (status === 400) return { code: 'google_invalid_params', retryable: false };
  return { code: 'google_request_failed', retryable: false };
}

function stripDashes(id) {
  return String(id ?? '').replace(/-/g, '');
}

function buildHeaders(accessToken, developerToken, loginCustomerId) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'developer-token': developerToken,
  };
  if (loginCustomerId) {
    headers['login-customer-id'] = stripDashes(loginCustomerId);
  }
  return headers;
}

async function googleMutate(ctx_, customerId, entityType, operations, log) {
  const url = `${GOOGLE_API_BASE}/customers/${customerId}/${entityType}:mutate`;
  log.debug('Google mutate', { entityType, opCount: operations.length });

  const response = await fetch(url, {
    method: 'POST',
    headers: ctx_.headers,
    body: JSON.stringify({ operations }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const apiError = errorBody?.error;
    const cls = classifyGoogleError(response.status, apiError);
    const message = apiError?.message ?? `Google Ads API error: ${response.status}`;
    log.error('Google API error', { entityType, status: response.status, code: cls.code, apiError });
    throw Object.assign(new Error(message), {
      code: cls.code,
      retryable: cls.retryable,
      statusCode: response.status,
      apiError,
      entityType,
    });
  }

  return await response.json();
}

async function createCampaignBudget(httpCtx, customerId, params, log) {
  const result = await googleMutate(httpCtx, customerId, 'campaignBudgets', [{
    create: {
      name: `${params.name} Budget`,
      amountMicros: String(params.dailyBudgetMicros ?? 10000000),
      deliveryMethod: 'STANDARD',
    },
  }], log);
  return result.results[0].resourceName;
}

async function createCampaign(httpCtx, customerId, params, budgetResourceName, log) {
  const create = {
    name: params.name,
    advertisingChannelType: params.advertisingChannelType,
    status: params.status ?? 'PAUSED',
    campaignBudget: budgetResourceName,
  };

  switch (params.biddingStrategy) {
    case 'TARGET_CPA':
      create.targetCpa = { targetCpaMicros: String(params.targetCpaMicros) };
      break;
    case 'TARGET_ROAS':
      create.targetRoas = { targetRoas: Number(params.targetRoas) };
      break;
    case 'MAXIMIZE_CONVERSIONS':
      create.maximizeConversions = {};
      break;
    case 'MAXIMIZE_CONVERSION_VALUE':
      create.maximizeConversionValue = {};
      break;
    case 'MAXIMIZE_CLICKS':
      create.maximizeClicks = {};
      break;
    case 'MANUAL_CPC':
      create.manualCpc = {};
      break;
  }

  if (params.startDate) create.startDate = params.startDate;
  if (params.endDate) create.endDate = params.endDate;

  const result = await googleMutate(httpCtx, customerId, 'campaigns', [{ create }], log);
  return result.results[0].resourceName;
}

async function createAdGroup(httpCtx, customerId, params, log) {
  const create = {
    name: params.name,
    campaign: params.campaignResourceName,
    status: params.status ?? 'PAUSED',
  };
  if (Number.isFinite(Number(params.cpcBidMicros))) {
    create.cpcBidMicros = String(params.cpcBidMicros);
  }

  const result = await googleMutate(httpCtx, customerId, 'adGroups', [{ create }], log);
  return result.results[0].resourceName;
}

async function createResponsiveSearchAd(httpCtx, customerId, params, log) {
  const ad = {
    responsiveSearchAd: {
      headlines: params.headlines.map((text, i) => ({
        text,
        ...(i === 0 ? { pinnedField: 'HEADLINE_1' } : {}),
      })),
      descriptions: params.descriptions.map((text) => ({ text })),
      ...(params.path1 ? { path1: params.path1 } : {}),
      ...(params.path2 ? { path2: params.path2 } : {}),
    },
    finalUrls: params.finalUrls,
  };
  const result = await googleMutate(httpCtx, customerId, 'adGroupAds', [{
    create: { adGroup: params.adGroupResourceName, status: 'PAUSED', ad },
  }], log);
  return result.results[0].resourceName;
}

async function createResponsiveDisplayAd(httpCtx, customerId, params, log) {
  const ad = {
    responsiveDisplayAd: {
      headlines: params.headlines.map((text) => ({ text })),
      longHeadline: { text: params.longHeadline },
      descriptions: params.descriptions.map((text) => ({ text })),
      marketingImages: params.marketingImages.map((asset) => ({ asset })),
      businessName: params.businessName,
    },
    finalUrls: params.finalUrls,
  };
  const result = await googleMutate(httpCtx, customerId, 'adGroupAds', [{
    create: { adGroup: params.adGroupResourceName, status: 'PAUSED', ad },
  }], log);
  return result.results[0].resourceName;
}

async function rollbackEntity(httpCtx, customerId, entityType, resourceName, log) {
  if (!resourceName) return;
  try {
    await googleMutate(httpCtx, customerId, entityType, [{ remove: resourceName }], log);
    log.debug('Rollback entity removed', { entityType, resourceName });
  } catch (err) {
    log.warn('Rollback failed (continuing)', { entityType, resourceName, error: String(err?.message ?? err) });
  }
}

async function resolveSecret(ctx, ref, purpose, log) {
  try {
    const result = await ctx.secrets.resolve({ ref, purpose });
    if (!result || typeof result.plaintext !== 'string' || result.plaintext.length === 0) {
      throw new Error('host returned empty plaintext');
    }
    return result.plaintext;
  } catch (err) {
    log.error('Secret resolution failed', { ref, error: String(err?.message ?? err), code: err?.code });
    throw err;
  }
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

export async function adsPublishGoogle(ctx) {
  ensureSecretsResolve(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};

  // ── Pre-flight input validation ──
  if (typeof inputs.oauthCredentialRef !== 'string' || inputs.oauthCredentialRef.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.oauthCredentialRef is required (opaque ref for Google OAuth access token)', retryable: false } };
  }
  if (typeof inputs.developerTokenCredentialRef !== 'string' || inputs.developerTokenCredentialRef.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.developerTokenCredentialRef is required (opaque ref for Google Ads API developer-token)', retryable: false } };
  }
  if (typeof inputs.customerId !== 'string' || inputs.customerId.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.customerId is required (Google Ads customer id, with or without dashes)', retryable: false } };
  }

  const campaign = inputs.campaign ?? {};
  if (typeof campaign.name !== 'string' || campaign.name.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.campaign.name is required', retryable: false } };
  }
  if (!VALID_CHANNEL_TYPES.includes(campaign.advertisingChannelType)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.campaign.advertisingChannelType must be one of: ${VALID_CHANNEL_TYPES.join(', ')}`, retryable: false } };
  }
  if (!VALID_BIDDING_STRATEGIES.includes(campaign.biddingStrategy)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.campaign.biddingStrategy must be one of: ${VALID_BIDDING_STRATEGIES.join(', ')}`, retryable: false } };
  }
  if (campaign.status && !VALID_CAMPAIGN_STATUSES.includes(campaign.status)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.campaign.status invalid`, retryable: false } };
  }

  const adGroup = inputs.adGroup ?? {};
  if (typeof adGroup.name !== 'string' || adGroup.name.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.adGroup.name is required', retryable: false } };
  }
  if (adGroup.status && !VALID_AD_GROUP_STATUSES.includes(adGroup.status)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.adGroup.status invalid', retryable: false } };
  }

  const ad = inputs.ad ?? {};
  if (!VALID_AD_FORMATS.includes(ad.format)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.ad.format must be one of: ${VALID_AD_FORMATS.join(', ')}`, retryable: false } };
  }
  if (!Array.isArray(ad.headlines) || ad.headlines.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.ad.headlines must be a non-empty string array', retryable: false } };
  }
  if (!Array.isArray(ad.descriptions) || ad.descriptions.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.ad.descriptions must be a non-empty string array', retryable: false } };
  }
  if (!Array.isArray(ad.finalUrls) || ad.finalUrls.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.ad.finalUrls must be a non-empty string array', retryable: false } };
  }
  if (ad.format === 'responsive_display') {
    if (typeof ad.longHeadline !== 'string' || ad.longHeadline.length === 0) {
      return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.ad.longHeadline is required for responsive_display format', retryable: false } };
    }
    if (typeof ad.businessName !== 'string' || ad.businessName.length === 0) {
      return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.ad.businessName is required for responsive_display format', retryable: false } };
    }
    if (!Array.isArray(ad.marketingImages) || ad.marketingImages.length === 0) {
      return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.ad.marketingImages must be a non-empty array of asset resource names', retryable: false } };
    }
  }

  // ── Secret resolution (two secrets) ──
  let accessToken;
  let developerToken;
  try {
    accessToken = await resolveSecret(ctx, inputs.oauthCredentialRef, `ads.publish.google:oauth:${ctx.runId ?? 'unknown'}:campaign-${campaign.name}`, log);
  } catch (err) {
    const m = mapSecretError(err);
    return { status: 'error', error: { code: m.code, message: String(err?.message ?? err), retryable: m.retryable, details: { credential: 'oauth' } } };
  }
  try {
    developerToken = await resolveSecret(ctx, inputs.developerTokenCredentialRef, `ads.publish.google:developerToken:${ctx.runId ?? 'unknown'}:campaign-${campaign.name}`, log);
  } catch (err) {
    const m = mapSecretError(err);
    return { status: 'error', error: { code: m.code, message: String(err?.message ?? err), retryable: m.retryable, details: { credential: 'developerToken' } } };
  }

  const customerId = stripDashes(inputs.customerId);
  const httpCtx = {
    headers: buildHeaders(accessToken, developerToken, inputs.loginCustomerId),
  };

  log.info('Publishing ad to Google Ads', {
    customerId,
    campaignName: campaign.name,
    channelType: campaign.advertisingChannelType,
    biddingStrategy: campaign.biddingStrategy,
    adFormat: ad.format,
  });

  // ── Pipeline with rollback tracking ──
  let budgetResourceName = null;
  let campaignResourceName = null;
  let adGroupResourceName = null;
  let adGroupAdResourceName = null;

  try {
    // Step 1: Budget
    log.debug('Creating campaign budget');
    budgetResourceName = await createCampaignBudget(httpCtx, customerId, campaign, log);

    // Step 2: Campaign
    log.debug('Creating campaign');
    campaignResourceName = await createCampaign(httpCtx, customerId, campaign, budgetResourceName, log);

    // Step 3: Ad group
    log.debug('Creating ad group');
    adGroupResourceName = await createAdGroup(httpCtx, customerId, { ...adGroup, campaignResourceName }, log);

    // Step 4: Ad
    log.debug('Creating ad', { format: ad.format });
    if (ad.format === 'responsive_search') {
      adGroupAdResourceName = await createResponsiveSearchAd(httpCtx, customerId, {
        adGroupResourceName,
        headlines: ad.headlines,
        descriptions: ad.descriptions,
        finalUrls: ad.finalUrls,
        path1: ad.path1,
        path2: ad.path2,
      }, log);
    } else {
      adGroupAdResourceName = await createResponsiveDisplayAd(httpCtx, customerId, {
        adGroupResourceName,
        headlines: ad.headlines,
        longHeadline: ad.longHeadline,
        descriptions: ad.descriptions,
        finalUrls: ad.finalUrls,
        marketingImages: ad.marketingImages,
        businessName: ad.businessName,
      }, log);
    }

    log.info('Google Ads publish completed', {
      budgetResourceName, campaignResourceName, adGroupResourceName, adGroupAdResourceName,
    });

    return {
      status: 'success',
      outputs: {
        platform: 'google',
        customerId,
        budgetResourceName,
        campaignResourceName,
        adGroupResourceName,
        adGroupAdResourceName,
        publishedStatus: campaign.status ?? 'PAUSED',
        publishedAt: new Date().toISOString(),
        success: true,
      },
    };
  } catch (err) {
    log.error('Google publish failed', {
      error: String(err?.message ?? err),
      code: err?.code,
      partialState: { budgetResourceName, campaignResourceName, adGroupResourceName, adGroupAdResourceName },
    });

    // Best-effort rollback in REVERSE creation order — Google Ads has no
    // cascade, so each entity must be REMOVE'd individually.
    if (adGroupAdResourceName) await rollbackEntity(httpCtx, customerId, 'adGroupAds', adGroupAdResourceName, log);
    if (adGroupResourceName) await rollbackEntity(httpCtx, customerId, 'adGroups', adGroupResourceName, log);
    if (campaignResourceName) await rollbackEntity(httpCtx, customerId, 'campaigns', campaignResourceName, log);
    if (budgetResourceName) await rollbackEntity(httpCtx, customerId, 'campaignBudgets', budgetResourceName, log);

    return {
      status: 'error',
      error: {
        code: err?.code === 'google_rate_limit' ? 'GOOGLE_RATE_LIMIT'
          : err?.code === 'google_server_error' ? 'GOOGLE_SERVER_ERROR'
          : err?.code === 'google_auth_expired' ? 'GOOGLE_AUTH_EXPIRED'
          : err?.code === 'google_permission_denied' ? 'GOOGLE_PERMISSION_DENIED'
          : err?.code === 'google_invalid_params' ? 'GOOGLE_INVALID_PARAMS'
          : 'GOOGLE_PUBLISH_FAILED',
        message: String(err?.message ?? err),
        retryable: err?.retryable === true,
        details: {
          stage: adGroupResourceName
            ? (adGroupAdResourceName ? 'ad' : 'ad-group')
            : (campaignResourceName ? 'campaign' : (budgetResourceName ? 'budget' : 'pre-flight')),
          rolledBack: {
            budget: !!budgetResourceName,
            campaign: !!campaignResourceName,
            adGroup: !!adGroupResourceName,
            ad: !!adGroupAdResourceName,
          },
          partialState: { budgetResourceName, campaignResourceName, adGroupResourceName, adGroupAdResourceName: null },
          googleApiError: err?.apiError,
        },
      },
    };
  }
}

const nodes = {
  'ads.publish.google': adsPublishGoogle,
};

export default nodes;
