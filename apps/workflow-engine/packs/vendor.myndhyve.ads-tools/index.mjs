/**
 * vendor.myndhyve.ads-tools — 2 pure-logic ads-studio executors.
 *
 * Lifted from MyndHyve's `src/canvas-types/campaign-studio/ads-studio/`:
 *   - brief/AdBriefExtractorService.ts (430 LOC) → ads.brief.extract
 *   - tracking/TrackingLinkBuilder.ts  (172 LOC) → ads.tracking.link
 *   - tracking/types.ts                (lookup tables, ~30 LOC inlined)
 *   - constants.ts (PLATFORM_MACROS)   (~80 LOC inlined)
 *
 * Both deterministic — no AI calls, no host capabilities. brief.extract
 * accepts page sections via inputs (MyndHyve's in-tree executor reads
 * them from useCampaignStudioStore; pack consumers supply them upstream).
 */

/* ─── shared helpers ────────────────────────────────────── */

function makeLog(ctx) {
  const fn = typeof ctx?.log === 'function' ? ctx.log : null;
  return {
    info: (msg, data) => { if (fn) fn('info', msg, data); },
    debug: (msg, data) => { if (fn) fn('debug', msg, data); },
    warn: (msg, data) => { if (fn) fn('warn', msg, data); },
    error: (msg, data) => { if (fn) fn('error', msg, data); },
  };
}

/* ─── inlined platform tables (TrackingLinkBuilder + constants) ─ */

const PLATFORM_UTM_SOURCES = {
  meta: 'facebook',
  google: 'google',
  tiktok: 'tiktok',
  linkedin: 'linkedin',
  x: 'twitter',
  pinterest: 'pinterest',
  snapchat: 'snapchat',
  reddit: 'reddit',
  amazon: 'amazon',
};

const PLATFORM_UTM_MEDIUMS = {
  meta: 'paid_social',
  google: 'cpc',
  tiktok: 'paid_social',
  linkedin: 'paid_social',
  x: 'paid_social',
  pinterest: 'paid_social',
  snapchat: 'paid_social',
  reddit: 'paid_social',
  amazon: 'cpc',
};

const PLATFORM_CLICK_ID_PARAMS = {
  meta: 'fbclid',
  google: 'gclid',
  tiktok: 'ttclid',
  linkedin: 'li_fat_id',
  x: 'twclid',
  pinterest: 'epik',
  snapchat: 'ScCid',
  reddit: 'rdt_cid',
  amazon: 'amzn_clid',
};

const PLATFORM_MACROS = {
  meta: { clickId: '{{ad.id}}', campaignId: '{{campaign.id}}', adsetId: '{{adset.id}}', adId: '{{ad.id}}', placement: '{{placement}}' },
  google: { clickId: '{gclid}', campaignId: '{campaignid}', adsetId: '{adgroupid}', adId: '{creative}', placement: '{network}' },
  tiktok: { clickId: '__CLICKID__', campaignId: '__CAMPAIGN_ID__', adsetId: '__AID__', adId: '__CID__', placement: '__PLACEMENT__' },
  linkedin: { clickId: '{{CLICK_ID}}', campaignId: '{{CAMPAIGN_ID}}', adsetId: '{{CAMPAIGN_GROUP_ID}}', adId: '{{CREATIVE_ID}}', placement: '{{PLACEMENT}}' },
  x: { clickId: '{{click_id}}', campaignId: '{{campaign_id}}', adsetId: '{{line_item_id}}', adId: '{{promoted_tweet_id}}', placement: '{{placement}}' },
  pinterest: { clickId: '{{click_id}}', campaignId: '{{campaign_id}}', adsetId: '{{ad_group_id}}', adId: '{{pin_promotion_id}}', placement: '{{placement}}' },
  snapchat: { clickId: '{{snap_click_id}}', campaignId: '{{campaign_id}}', adsetId: '{{ad_squad_id}}', adId: '{{ad_id}}', placement: '{{placement}}' },
  reddit: { clickId: '{{click_id}}', campaignId: '{{campaign_id}}', adsetId: '{{ad_group_id}}', adId: '{{ad_id}}', placement: '{{placement}}' },
  amazon: { clickId: '{{click_id}}', campaignId: '{{campaign_id}}', adsetId: '{{ad_group_id}}', adId: '{{ad_id}}', placement: '{{placement}}' },
};

function sanitizeUTMValue(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9\-_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function appendParams(baseUrl, params, log) {
  try {
    const url = new URL(baseUrl);
    params.forEach((value, key) => url.searchParams.set(key, value));
    return url.toString();
  } catch {
    log?.warn('Invalid base URL — falling back to string concatenation', { baseUrl: baseUrl.slice(0, 100) });
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}${params.toString()}`;
  }
}

function buildUTMParams(input) {
  return {
    source: PLATFORM_UTM_SOURCES[input.platform],
    medium: PLATFORM_UTM_MEDIUMS[input.platform],
    campaign: sanitizeUTMValue(input.campaignName),
    term: input.utmTerm ? sanitizeUTMValue(input.utmTerm) : undefined,
    content: input.utmContent || input.variantId || undefined,
  };
}

function buildTrackingLink(input, log) {
  const utm = buildUTMParams(input);
  const params = new URLSearchParams();
  params.set('utm_source', utm.source);
  params.set('utm_medium', utm.medium);
  params.set('utm_campaign', utm.campaign);
  if (utm.term) params.set('utm_term', utm.term);
  if (utm.content) params.set('utm_content', utm.content);

  let hasClickId = false;
  if (input.includeClickId !== false) {
    const clickIdParam = PLATFORM_CLICK_ID_PARAMS[input.platform];
    const macros = PLATFORM_MACROS[input.platform];
    if (clickIdParam && macros) {
      params.set(clickIdParam, macros.clickId);
      hasClickId = true;
    }
  }
  if (input.variantId) params.set('ad_variant', input.variantId);
  if (input.customParams && typeof input.customParams === 'object') {
    for (const [key, value] of Object.entries(input.customParams)) {
      const sanitizedKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
      if (sanitizedKey.length > 0) params.set(sanitizedKey, String(value));
    }
  }

  const fullUrl = appendParams(input.destinationUrl, params, log);
  return { fullUrl, utm, platform: input.platform, hasClickId };
}

function createTrackingLink(input, log) {
  const result = buildTrackingLink(input, log);
  return {
    id: crypto.randomUUID(),
    destinationUrl: input.destinationUrl,
    utm: result.utm,
    clickIdParam: result.hasClickId ? PLATFORM_CLICK_ID_PARAMS[input.platform] : undefined,
    variantId: input.variantId,
    fullUrl: result.fullUrl,
    platform: input.platform,
    createdAt: new Date().toISOString(),
  };
}

/* ─── tracking.link executor ────────────────────────────── */

export async function trackingLink(ctx) {
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  if (!inputs.destinationUrl || !inputs.campaignName) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'destinationUrl + campaignName required', retryable: false } };
  }

  // Multi-platform mode wins when `platforms[]` is set.
  if (Array.isArray(inputs.platforms) && inputs.platforms.length > 0) {
    const links = inputs.platforms.map((platform) =>
      createTrackingLink({ ...inputs, platform }, log),
    );
    log.info('Built multi-platform tracking links', { count: links.length });
    return { status: 'success', outputs: { links, success: true } };
  }

  if (!inputs.platform) {
    return { status: 'error', error: { code: 'MISSING_PLATFORM', message: 'platform OR platforms[] required', retryable: false } };
  }
  const link = createTrackingLink(inputs, log);
  log.info('Tracking link built', { platform: inputs.platform });
  return { status: 'success', outputs: { link, success: true } };
}

/* ─── AdBriefExtractor (lifted verbatim, minus types) ─── */

function briefDedupe(arr) {
  const seen = new Set();
  return arr.filter((item) => {
    const lower = String(item).toLowerCase().trim();
    if (seen.has(lower) || lower.length === 0) return false;
    seen.add(lower);
    return true;
  });
}

function extractTextField(content, field, target) {
  const value = content[field];
  if (typeof value === 'string' && value.trim().length > 0) target.push(value.trim());
}

function extractArrayItems(content, field, target, subFields) {
  const items = content[field];
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    for (const sub of subFields) {
      const v = item[sub];
      if (typeof v === 'string' && v.trim().length > 0) target.push(v.trim());
    }
  }
}

function extractSection(section) {
  const content = (section.content && typeof section.content === 'object') ? section.content : {};
  const result = {
    sectionId: section.id,
    sectionType: section.type,
    headlines: [],
    descriptions: [],
    ctaTexts: [],
    bulletPoints: [],
    testimonials: [],
    stats: [],
  };

  extractTextField(content, 'headline', result.headlines);
  extractTextField(content, 'title', result.headlines);
  extractTextField(content, 'subheadline', result.descriptions);
  extractTextField(content, 'subtitle', result.descriptions);
  extractTextField(content, 'description', result.descriptions);
  extractTextField(content, 'bodyText', result.descriptions);
  extractTextField(content, 'ctaText', result.ctaTexts);
  extractTextField(content, 'buttonText', result.ctaTexts);

  switch (section.type) {
    case 'hero':
      extractTextField(content, 'tagline', result.descriptions);
      break;
    case 'features':
      extractArrayItems(content, 'features', result.bulletPoints, ['title', 'description']);
      extractArrayItems(content, 'items', result.bulletPoints, ['title', 'description']);
      break;
    case 'pricing': {
      const plans = content.plans || content.items;
      if (Array.isArray(plans)) {
        for (const plan of plans) {
          if (typeof plan !== 'object' || plan === null) continue;
          if (typeof plan.name === 'string') {
            const price = typeof plan.price === 'string' ? ` - ${plan.price}` : '';
            (result.pricingInfo ||= []).push(`${plan.name}${price}`);
          }
          extractArrayItems({ features: plan.features }, 'features', result.bulletPoints, ['text', 'name']);
        }
      }
      break;
    }
    case 'testimonials': {
      const items = content.testimonials || content.items;
      if (Array.isArray(items)) {
        for (const t of items) {
          if (typeof t !== 'object' || t === null) continue;
          if (typeof t.quote === 'string') result.testimonials.push(t.quote);
          if (typeof t.text === 'string') result.testimonials.push(t.text);
        }
      }
      break;
    }
    case 'stats': {
      const items = content.stats || content.items;
      if (Array.isArray(items)) {
        for (const s of items) {
          if (typeof s !== 'object' || s === null) continue;
          const value = s.value ?? s.number;
          const label = s.label ?? s.title;
          if (typeof value === 'string' && typeof label === 'string') {
            result.stats.push(`${value} ${label}`);
          }
        }
      }
      break;
    }
    case 'faq':
      extractArrayItems(content, 'items', result.bulletPoints, ['question']);
      break;
    case 'cta':
      extractTextField(content, 'primaryCtaText', result.ctaTexts);
      extractTextField(content, 'secondaryCtaText', result.ctaTexts);
      break;
  }

  return result;
}

function extractRawContent(sections, pageTitle, pageDescription) {
  const extractedSections = sections.map(extractSection);
  return {
    sections: extractedSections,
    pageTitle,
    pageDescription,
    allHeadlines: briefDedupe(extractedSections.flatMap((s) => s.headlines)),
    allCtas: briefDedupe(extractedSections.flatMap((s) => s.ctaTexts)),
    allSellingPoints: briefDedupe([
      ...extractedSections.flatMap((s) => s.bulletPoints),
      ...extractedSections.flatMap((s) => s.descriptions),
    ]),
  };
}

function deriveContentContext(extraction, objective) {
  const goalMap = {
    awareness: 'awareness',
    traffic: 'awareness',
    engagement: 'awareness',
    leads: 'lead-generation',
    conversions: 'sales',
    sales: 'sales',
  };
  return {
    businessName: '',
    productName: extraction.pageTitle,
    targetAudience: '',
    uniqueSellingPoints: extraction.allSellingPoints.slice(0, 5),
    brandVoice: '',
    pageGoal: goalMap[objective] ?? 'awareness',
  };
}

function identifySellingPoints(extraction) {
  const candidates = [
    ...extraction.allSellingPoints,
    ...extraction.sections.flatMap((s) => s.stats),
    ...extraction.sections.flatMap((s) => s.testimonials.map((t) => `"${t.slice(0, 80)}"`)),
  ];
  return briefDedupe(candidates).slice(0, 10);
}

function deriveDefaultAngles(extraction, objective, count) {
  const angles = [];
  if (extraction.allHeadlines.length > 0) {
    angles.push({
      id: crypto.randomUUID(),
      name: 'Value Proposition',
      description: `Lead with the main value prop: "${extraction.allHeadlines[0]}"`,
      priority: 'high',
    });
  }
  const testimonials = extraction.sections.flatMap((s) => s.testimonials);
  if (testimonials.length > 0) {
    angles.push({
      id: crypto.randomUUID(),
      name: 'Social Proof',
      description: 'Lead with customer validation and testimonials',
      emotionalTrigger: 'trust',
      priority: 'high',
    });
  }
  const stats = extraction.sections.flatMap((s) => s.stats);
  if (stats.length > 0) {
    angles.push({
      id: crypto.randomUUID(),
      name: 'Authority/Data',
      description: `Lead with impressive numbers: ${stats[0]}`,
      emotionalTrigger: 'credibility',
      priority: 'medium',
    });
  }
  if (objective === 'conversions' || objective === 'sales') {
    angles.push({
      id: crypto.randomUUID(),
      name: 'Urgency/Scarcity',
      description: 'Create time pressure or limited availability framing',
      emotionalTrigger: 'fomo',
      priority: 'medium',
    });
  }
  if (extraction.allSellingPoints.length > 2) {
    angles.push({
      id: crypto.randomUUID(),
      name: 'Problem/Solution',
      description: 'Frame the pain point, then present the solution',
      emotionalTrigger: 'relief',
      priority: 'medium',
    });
  }
  return angles.slice(0, count);
}

function inferTone(extraction, context) {
  if (context.brandVoice) return context.brandVoice;
  const allText = [...extraction.allHeadlines, ...extraction.allSellingPoints].join(' ').toLowerCase();
  if (allText.includes('free') || allText.includes('limited') || allText.includes('now')) return 'urgent';
  if (allText.includes('enterprise') || allText.includes('professional') || allText.includes('trusted')) return 'professional';
  if (allText.includes('fun') || allText.includes('easy') || allText.includes('simple')) return 'casual';
  return 'professional';
}

/* ─── brief.extract executor ────────────────────────────── */

export async function briefExtract(ctx) {
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  if (!inputs.pageId || !Array.isArray(inputs.sections)) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'pageId + sections[] required', retryable: false } };
  }

  if (inputs.sections.length === 0) {
    return { status: 'error', error: { code: 'EMPTY_SECTIONS', message: `No sections found for page '${inputs.pageId}'. Ensure the page has content before extracting a brief.`, retryable: false } };
  }

  const objective = inputs.objective || 'conversions';
  const angleCount = inputs.angleCount ?? config.defaultAngleCount ?? 3;
  const pageTitle = inputs.pageTitle ?? 'Untitled Page';

  log.info('Extracting ad brief from page', { pageId: inputs.pageId, sectionCount: inputs.sections.length });

  const rawExtraction = extractRawContent(inputs.sections, pageTitle, inputs.pageDescription);
  const context = inputs.contentContext ?? deriveContentContext(rawExtraction, objective);
  const sellingPoints = identifySellingPoints(rawExtraction);
  const angles = deriveDefaultAngles(rawExtraction, objective, angleCount);
  const tone = inferTone(rawExtraction, context);

  const now = new Date().toISOString();
  const brief = {
    id: crypto.randomUUID(),
    campaignId: undefined,
    contentContext: context,
    sellingPoints,
    targetAudience: context.targetAudience || 'General audience',
    tone,
    goal: objective,
    angles,
    constraints: [],
    source: {
      pageId: inputs.pageId,
      funnelId: inputs.funnelId,
      stepId: inputs.stepId,
      sectionIds: inputs.sections.map((s) => s.id),
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    status: 'success',
    outputs: {
      brief,
      sellingPoints: brief.sellingPoints,
      suggestedAngles: brief.angles.map((a) => a.name),
      success: true,
    },
  };
}

/* ─── default export ────────────────────────────────────── */

const nodes = {
  'ads.brief.extract': briefExtract,
  'ads.tracking.link': trackingLink,
};

export default nodes;
