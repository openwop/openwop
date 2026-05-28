/**
 * vendor.myndhyve.ads-image-generate
 *
 * Single typeId: `ads.image.generate`
 *
 * Generates ad creative images by batching prompts through the host's
 * ctx.callImageGenerator (specced in PR #48 — §host.aiProviders
 * imageGeneration sub-capability). Computes per-placement dimensions
 * from caller-supplied placementSpec (replacing the source's
 * PlatformSpecRegistry lookup), enhances prompts with platform/style/
 * brand-color context, and aggregates safety-filter stats.
 *
 * Source: src/canvas-types/campaign-studio/ads-studio/creative/image/
 *   AdImageGeneratorService.ts (237 LOC) +
 *   ads-studio/creative/promptUtils.ts (75 LOC, only image-style portion
 *   inlined; video-style portion lives in ads-video-generate pack).
 *
 * One ctx.callImageGenerator per prompt (batch loop). Pure-JS, Node-20.
 */

function makeLog(ctx) {
  const fn = typeof ctx?.log === 'function' ? ctx.log : null;
  return {
    debug: (msg, data) => { if (fn) fn('debug', msg, data); },
    info: (msg, data) => { if (fn) fn('info', msg, data); },
    warn: (msg, data) => { if (fn) fn('warn', msg, data); },
    error: (msg, data) => { if (fn) fn('error', msg, data); },
  };
}

function ensureCallImageGenerator(ctx) {
  if (typeof ctx.callImageGenerator !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.callImageGenerator — workflow-register should have refused this pack at peerDependency resolution time. Host must advertise aiProviders.imageGeneration: supported per spec/v1/host-capabilities.md §host.aiProviders.'),
      { code: 'host_capability_missing', capability: 'aiProviders.imageGeneration' },
    );
  }
}

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_COUNT_PER_PROMPT = 2;

const IMAGE_STYLE_DESCRIPTIONS = {
  'photorealistic': 'photorealistic, high quality photograph',
  'illustration': 'digital illustration, clean vectors',
  'flat-design': 'flat design, minimal shadows, solid colors',
  'minimalist': 'minimalist design, lots of whitespace',
  'bold-graphic': 'bold graphic design, strong typography',
  'lifestyle': 'lifestyle photography, natural lighting, authentic',
  'product-shot': 'professional product photography, studio lighting',
};

function enhanceCreativePrompt(opts) {
  const { prompt, style, platform, placement, extras } = opts;
  const parts = [prompt];
  if (style) {
    parts.push(IMAGE_STYLE_DESCRIPTIONS[style] || style);
  }
  if (Array.isArray(extras)) {
    for (const e of extras) {
      if (typeof e === 'string' && e.length > 0) parts.push(e);
    }
  }
  parts.push(`optimized for ${platform} ${placement} ads`);
  return parts.join('. ');
}

/**
 * Compute output dimensions for the image.
 *
 * Priority:
 *   1. Caller-supplied placementSpec.imageSpec.recommendedWidth/Height
 *      (replaces source's PlatformSpecRegistry.getSpecForPlacement lookup).
 *      Capped at maxDimension.
 *   2. Fallback: derive from aspectRatio + maxDimension.
 */
function computeDimensions(inputs, maxDimension) {
  const spec = inputs.placementSpec;
  if (spec?.imageSpec) {
    const recW = Number(spec.imageSpec.recommendedWidth);
    const recH = Number(spec.imageSpec.recommendedHeight);
    if (Number.isFinite(recW) && Number.isFinite(recH) && recW > 0 && recH > 0) {
      return {
        width: Math.min(recW, maxDimension),
        height: Math.min(recH, maxDimension),
      };
    }
  }

  const ar = inputs.aspectRatio ?? { width: 1, height: 1 };
  const ratioW = Number(ar.width);
  const ratioH = Number(ar.height);
  if (!Number.isFinite(ratioW) || !Number.isFinite(ratioH) || ratioW <= 0 || ratioH <= 0) {
    return { width: maxDimension, height: maxDimension };
  }
  if (ratioW >= ratioH) {
    return { width: maxDimension, height: Math.round(maxDimension * (ratioH / ratioW)) };
  }
  return { width: Math.round(maxDimension * (ratioW / ratioH)), height: maxDimension };
}

function buildExtras(inputs) {
  const extras = [];
  if (Array.isArray(inputs.brandColors) && inputs.brandColors.length > 0) {
    extras.push(`using brand colors: ${inputs.brandColors.join(', ')}`);
  }
  return extras;
}

export async function adsImageGenerate(ctx) {
  ensureCallImageGenerator(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const prompts = Array.isArray(inputs.prompts) ? inputs.prompts.filter((p) => typeof p === 'string' && p.length > 0) : [];
  if (prompts.length === 0) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.prompts must contain at least one non-empty string prompt', retryable: false },
    };
  }

  const platform = typeof inputs.platform === 'string' && inputs.platform.length > 0 ? inputs.platform : 'meta';
  const placement = typeof inputs.placement === 'string' && inputs.placement.length > 0 ? inputs.placement : `${platform}-feed`;

  const maxDimension = Number.isFinite(Number(config.maxDimension)) ? Number(config.maxDimension) : DEFAULT_MAX_DIMENSION;
  const countPerPrompt = Math.max(1, Math.min(8, Number(inputs.count) || DEFAULT_COUNT_PER_PROMPT));
  const dimensions = computeDimensions(inputs, maxDimension);
  const extras = buildExtras(inputs);

  log.debug('Generating ad images', {
    promptCount: prompts.length,
    platform,
    placement,
    countPerPrompt,
    dimensions,
  });

  const allImages = [];
  const perPromptStats = [];
  let totalFilteredCount = 0;
  let totalTimeMs = 0;
  let totalCost = 0;

  for (let i = 0; i < prompts.length; i++) {
    if (ctx.signal?.aborted) {
      log.info('Image generation aborted', { completed: i, total: prompts.length });
      break;
    }

    const enhancedPrompt = enhanceCreativePrompt({
      prompt: prompts[i],
      style: inputs.style,
      platform,
      placement,
      extras,
    });

    const startTime = Date.now();
    let batchResult;
    try {
      batchResult = await ctx.callImageGenerator({
        provider: config.provider,
        model: config.model,
        prompt: enhancedPrompt,
        negativePrompt: inputs.negativePrompt,
        width: dimensions.width,
        height: dimensions.height,
        count: countPerPrompt,
        seed: typeof inputs.seed === 'number' ? inputs.seed + i : undefined,
        brandColors: Array.isArray(inputs.brandColors) ? inputs.brandColors : undefined,
      });
    } catch (err) {
      const code = err?.code;
      // Per spec failure modes: image_safety_filtered_all is success-ish (just empty);
      // host_capability_missing should have been caught above. Other codes propagate.
      log.error('Image generation failed for prompt', {
        promptIndex: i,
        error: String(err?.message ?? err),
        code,
      });
      return {
        status: 'error',
        error: {
          code: code === 'image_safety_filtered_all' ? 'IMAGE_SAFETY_FILTERED_ALL' : 'IMAGE_GENERATE_FAILED',
          message: String(err?.message ?? err),
          retryable: code !== 'image_safety_filtered_all',
          details: {
            promptIndex: i,
            promptCount: prompts.length,
            generatedSoFar: allImages.length,
          },
        },
      };
    }

    const batchTime = Date.now() - startTime;
    const images = Array.isArray(batchResult?.images) ? batchResult.images : [];
    const filtered = Number.isFinite(Number(batchResult?.filteredCount)) ? Number(batchResult.filteredCount) : 0;

    // Normalize each image entry and attach prompt-index metadata.
    for (const img of images) {
      if (!img || typeof img !== 'object') continue;
      allImages.push({
        url: typeof img.url === 'string' ? img.url : undefined,
        base64: typeof img.base64 === 'string' ? img.base64 : undefined,
        mimeType: typeof img.mimeType === 'string' ? img.mimeType : 'image/png',
        width: Number.isFinite(Number(img.width)) ? Number(img.width) : dimensions.width,
        height: Number.isFinite(Number(img.height)) ? Number(img.height) : dimensions.height,
        seed: Number.isFinite(Number(img.seed)) ? Number(img.seed) : undefined,
        safetyFiltered: img.safetyFiltered === true,
        metadata: {
          ...(img.metadata && typeof img.metadata === 'object' ? img.metadata : {}),
          promptIndex: i,
          enhancedPrompt,
        },
      });
    }

    totalFilteredCount += filtered;
    totalTimeMs += batchTime;
    if (typeof batchResult?.usage?.totalCost === 'number') totalCost += batchResult.usage.totalCost;

    perPromptStats.push({
      promptIndex: i,
      generated: images.length,
      filtered,
      batchTimeMs: batchTime,
    });
  }

  log.info('Image generation complete', {
    promptCount: prompts.length,
    totalGenerated: allImages.length,
    totalFiltered: totalFilteredCount,
    totalTimeMs,
  });

  return {
    status: 'success',
    outputs: {
      assets: allImages,
      totalGenerated: allImages.length,
      filteredCount: totalFilteredCount,
      perPromptStats,
      dimensions,
      platform,
      placement,
      usage: { totalTimeMs, totalCost: totalCost > 0 ? totalCost : undefined },
      success: true,
    },
  };
}

const nodes = {
  'ads.image.generate': adsImageGenerate,
};

export default nodes;
