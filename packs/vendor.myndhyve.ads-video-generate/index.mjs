/**
 * vendor.myndhyve.ads-video-generate
 *
 * Single typeId: `ads.video.generate`
 *
 * Generates ad creative videos via the host's ctx.callVideoGenerator
 * (specced in PR #53 — §host.aiProviders.videoGeneration sub-capability).
 * Single-video-per-call (vs ads-image-generate's batch); host hides async
 * polling internally (typical 30-120s latency). Pack honors ctx.signal
 * for abort.
 *
 * Source: src/canvas-types/campaign-studio/ads-studio/creative/video/
 *   AdVideoGeneratorService.ts (354 LOC, but most was async-polling
 *   plumbing now handled by the host — pack itself is ~150 LOC) +
 *   promptUtils.ts video portion (~50 LOC).
 *
 * Pure-JS, Node-20 stdlib only.
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

function ensureCallVideoGenerator(ctx) {
  if (typeof ctx.callVideoGenerator !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.callVideoGenerator — workflow-register should have refused this pack at peerDependency resolution time. Host must advertise aiProviders.videoGeneration: supported per spec/v1/host-capabilities.md §host.aiProviders.'),
      { code: 'host_capability_missing', capability: 'aiProviders.videoGeneration' },
    );
  }
}

const DEFAULT_DURATION_SECONDS = 8;

const VIDEO_STYLE_DESCRIPTIONS = {
  'cinematic': 'cinematic quality, professional color grading',
  'motion-graphics': 'smooth motion graphics, animated elements',
  'product-demo': 'clean product demonstration, professional lighting',
  'lifestyle': 'lifestyle footage, natural movement, authentic',
  'animated': 'high quality animation, smooth transitions',
  'stop-motion': 'stop motion animation style',
  'documentary': 'documentary style, natural footage',
};

function enhanceCreativePrompt(opts) {
  const { prompt, style, platform, placement, extras } = opts;
  const parts = [prompt];
  if (style) {
    parts.push(VIDEO_STYLE_DESCRIPTIONS[style] || style);
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
 * Compute output dimensions for the video.
 *
 * Priority:
 *   1. Caller-supplied placementSpec.videoSpec.recommendedWidth/Height
 *      (replaces source's PlatformSpecRegistry.getSpecForPlacement lookup).
 *   2. Fallback: derive from aspectRatio with reasonable defaults
 *      (1920 max for landscape, 1080 max for portrait).
 */
function computeDimensions(inputs) {
  const spec = inputs.placementSpec;
  if (spec?.videoSpec) {
    const recW = Number(spec.videoSpec.recommendedWidth);
    const recH = Number(spec.videoSpec.recommendedHeight);
    if (Number.isFinite(recW) && Number.isFinite(recH) && recW > 0 && recH > 0) {
      return { width: recW, height: recH };
    }
  }

  const ar = inputs.aspectRatio ?? { width: 16, height: 9 };
  const ratioW = Number(ar.width);
  const ratioH = Number(ar.height);
  if (!Number.isFinite(ratioW) || !Number.isFinite(ratioH) || ratioW <= 0 || ratioH <= 0) {
    return { width: 1920, height: 1080 };
  }
  if (ratioW >= ratioH) {
    return { width: 1920, height: Math.round(1920 * (ratioH / ratioW)) };
  }
  return { width: Math.round(1080 * (ratioW / ratioH)), height: 1080 };
}

function buildExtras(inputs, durationSeconds) {
  const extras = [`${durationSeconds} seconds`];
  if (Array.isArray(inputs.brandColors) && inputs.brandColors.length > 0) {
    extras.push(`using brand colors: ${inputs.brandColors.join(', ')}`);
  }
  return extras;
}

export async function adsVideoGenerate(ctx) {
  ensureCallVideoGenerator(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const prompt = typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '';
  if (prompt.length === 0) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.prompt is required (non-empty string)', retryable: false },
    };
  }

  const platform = typeof inputs.platform === 'string' && inputs.platform.length > 0 ? inputs.platform : 'meta';
  const placement = typeof inputs.placement === 'string' && inputs.placement.length > 0 ? inputs.placement : `${platform}-feed`;
  const durationSeconds = Number.isFinite(Number(inputs.durationSeconds)) && Number(inputs.durationSeconds) > 0
    ? Number(inputs.durationSeconds)
    : DEFAULT_DURATION_SECONDS;

  const dimensions = computeDimensions(inputs);
  const enhancedPrompt = enhanceCreativePrompt({
    prompt,
    style: inputs.style,
    platform,
    placement,
    extras: buildExtras(inputs, durationSeconds),
  });

  log.debug('Generating ad video', {
    platform,
    placement,
    durationSeconds,
    dimensions,
    includeAudio: inputs.includeAudio === true,
  });

  let result;
  try {
    result = await ctx.callVideoGenerator({
      provider: config.provider,
      model: config.model,
      prompt: enhancedPrompt,
      negativePrompt: inputs.negativePrompt,
      width: dimensions.width,
      height: dimensions.height,
      durationSeconds,
      includeAudio: inputs.includeAudio === true,
      seed: typeof inputs.seed === 'number' ? inputs.seed : undefined,
      brandColors: Array.isArray(inputs.brandColors) ? inputs.brandColors : undefined,
    });
  } catch (err) {
    const code = err?.code;
    log.error('Video generation failed', {
      error: String(err?.message ?? err),
      code,
    });
    // Map spec failure modes
    const retryable = code === 'video_generation_timeout';
    return {
      status: 'error',
      error: {
        code: code === 'video_generation_cancelled' ? 'VIDEO_GENERATION_CANCELLED'
          : code === 'video_generation_timeout' ? 'VIDEO_GENERATION_TIMEOUT'
          : 'VIDEO_GENERATE_FAILED',
        message: String(err?.message ?? err),
        retryable,
        details: { platform, placement, durationSeconds, dimensions },
      },
    };
  }

  const video = result?.video;
  if (!video || typeof video !== 'object' || typeof video.url !== 'string') {
    log.error('Host returned malformed video result', { result });
    return {
      status: 'error',
      error: { code: 'VIDEO_GENERATE_FAILED', message: 'host ctx.callVideoGenerator returned malformed video object (missing url)', retryable: true },
    };
  }

  log.info('Video generation complete', {
    url: video.url,
    durationSeconds: video.durationSeconds,
    safetyFiltered: video.safetyFiltered,
    fileSizeBytes: video.fileSizeBytes,
    totalTimeMs: result.totalTimeMs,
  });

  return {
    status: 'success',
    outputs: {
      asset: {
        url: video.url,
        durationSeconds: Number.isFinite(Number(video.durationSeconds)) ? Number(video.durationSeconds) : durationSeconds,
        width: Number.isFinite(Number(video.width)) ? Number(video.width) : dimensions.width,
        height: Number.isFinite(Number(video.height)) ? Number(video.height) : dimensions.height,
        mimeType: typeof video.mimeType === 'string' ? video.mimeType : 'video/mp4',
        fileSizeBytes: Number.isFinite(Number(video.fileSizeBytes)) ? Number(video.fileSizeBytes) : null,
        thumbnailUrl: typeof video.thumbnailUrl === 'string' ? video.thumbnailUrl : null,
        seed: Number.isFinite(Number(video.seed)) ? Number(video.seed) : undefined,
        safetyFiltered: video.safetyFiltered === true,
        metadata: {
          ...(video.metadata && typeof video.metadata === 'object' ? video.metadata : {}),
          enhancedPrompt,
          platform,
          placement,
        },
      },
      platform,
      placement,
      dimensions,
      durationSeconds,
      usage: {
        totalTimeMs: Number.isFinite(Number(result?.totalTimeMs)) ? Number(result.totalTimeMs) : undefined,
        totalCost: typeof result?.usage?.totalCost === 'number' ? result.usage.totalCost : undefined,
      },
      success: true,
    },
  };
}

const nodes = {
  'ads.video.generate': adsVideoGenerate,
};

export default nodes;
