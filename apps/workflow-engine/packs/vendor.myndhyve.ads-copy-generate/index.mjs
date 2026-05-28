/**
 * vendor.myndhyve.ads-copy-generate
 *
 * Single typeId: `ads.copy.generate`
 *
 * Lifted from src/canvas-types/campaign-studio/ads-studio/copy/AdCopyGeneratorService.ts
 * (316 LOC TypeScript). One AI-call site routes through ctx.callAI. The original
 * getSpecForPlacement(...) read of PlatformSpecRegistry is replaced with caller-supplied
 * `inputs.placementTextLimits` (resolve upstream from vendor.myndhyve.ads-platforms
 * OR a future host.adPlatformSpecs capability).
 *
 * Pure-JS, no MyndHyve internal imports. Node 20 stdlib only.
 */

import { randomUUID } from 'node:crypto';

function makeLog(ctx) {
  const fn = typeof ctx?.log === 'function' ? ctx.log : null;
  return {
    debug: (msg, data) => { if (fn) fn('debug', msg, data); },
    info: (msg, data) => { if (fn) fn('info', msg, data); },
    warn: (msg, data) => { if (fn) fn('warn', msg, data); },
    error: (msg, data) => { if (fn) fn('error', msg, data); },
  };
}

function ensureCallAI(ctx) {
  if (typeof ctx.callAI !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.callAI — workflow-register should have refused this pack at peerDependency resolution time'),
      { code: 'host_capability_missing', capability: 'aiProviders' },
    );
  }
}

const MAX_VARIANTS = 10;
const DEFAULT_VARIANT_COUNT = 3;
const DEFAULT_TEMPERATURE = 0.8;
const DEFAULT_MAX_TOKENS = 4096;

const COPY_SYSTEM_PROMPT = `You are an expert ad copywriter specializing in direct-response advertising across Meta, Google, TikTok, LinkedIn, and X.

Your copy must:
- Lead with benefits, not features
- Use the specified angle/hook for each variant
- Match the requested tone exactly
- Stay within character limits for each placement
- Include a clear call-to-action
- Be honest and not make unsubstantiated claims

Output ONLY valid JSON. No markdown formatting around the JSON array.`;

function buildLimitsBlock(placements, placementTextLimits) {
  if (!placementTextLimits || typeof placementTextLimits !== 'object') return '';
  const lines = [];
  for (const p of placements) {
    const limits = placementTextLimits[p];
    if (!limits) continue;
    const parts = [];
    if (limits.headline?.max != null) parts.push(`headline max ${limits.headline.max} chars`);
    if (limits.description?.max != null) parts.push(`description max ${limits.description.max} chars`);
    if (limits.bodyText?.max != null) parts.push(`body max ${limits.bodyText.max} chars`);
    if (parts.length > 0) lines.push(`- ${p}: ${parts.join(', ')}`);
  }
  return lines.join('\n');
}

function buildPrompt(inputs, variantCount) {
  const brief = inputs.brief ?? {};
  const placements = inputs.placements ?? [];
  const ctx = brief.contentContext ?? {};

  const limitsInfo = buildLimitsBlock(placements, inputs.placementTextLimits);

  const angles = Array.isArray(brief.angles) ? brief.angles : [];
  const anglesText = inputs.angle
    ? `Use this specific angle: "${inputs.angle}"`
    : angles.length > 0
      ? `Available angles: ${angles.map((a) => `"${a}"`).join(', ')}. Use a different angle for each variant.`
      : `Generate a different angle/hook for each variant.`;

  const sellingPoints = Array.isArray(brief.sellingPoints) ? brief.sellingPoints : [];

  return `Generate ${variantCount} ad copy variants for the following product/service:

**Business:** ${ctx.businessName || 'Not specified'}
**Product:** ${ctx.productName || 'Not specified'}
**Target Audience:** ${brief.targetAudience || ctx.targetAudience || 'Not specified'}
**Goal:** ${brief.goal || 'Not specified'}
**Tone:** ${inputs.tone || brief.tone || 'professional'}

**Key Selling Points:**
${sellingPoints.map((sp) => `- ${sp}`).join('\n')}

**Angles:**
${anglesText}

${limitsInfo ? `**Platform Character Limits:**\n${limitsInfo}\n` : ''}
${inputs.additionalInstructions ? `**Additional Instructions:** ${inputs.additionalInstructions}\n` : ''}
**Output Format (JSON array):**
\`\`\`json
[
  {
    "angle": "the angle/hook used",
    "headline": "the headline (within the most restrictive limit)",
    "description": "the description",
    "bodyText": "longer body text if applicable",
    "ctaText": "call to action text"
  }
]
\`\`\`

Generate exactly ${variantCount} variants. Each must use a different angle or hook. Keep headlines punchy and benefit-driven. Descriptions should expand on the headline's promise.`;
}

function truncateIfNeeded(text, maxLength) {
  if (typeof text !== 'string') return text;
  if (text.length <= maxLength) return text;
  // Truncate at word boundary with ellipsis
  const truncated = text.slice(0, maxLength - 1);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.6 ? truncated.slice(0, lastSpace) : truncated) + '…';
}

function adaptToPlacements(copy, placements, placementTextLimits) {
  return placements.map((placement) => {
    const limits = placementTextLimits?.[placement];
    if (!limits) {
      return {
        placement,
        headline: copy.headline || '',
        description: copy.description,
        bodyText: copy.bodyText,
        ctaText: copy.ctaText,
        wasTruncated: false,
      };
    }

    let wasTruncated = false;
    const trim = (val, max) => {
      if (val == null || max == null) return val;
      const out = truncateIfNeeded(String(val), max);
      if (out !== val) wasTruncated = true;
      return out;
    };

    return {
      placement,
      headline: trim(copy.headline || '', limits.headline?.max) || '',
      description: trim(copy.description, limits.description?.max),
      bodyText: trim(copy.bodyText, limits.bodyText?.max),
      ctaText: trim(copy.ctaText, limits.ctaText?.max),
      wasTruncated,
    };
  });
}

function parseVariants(content, placements, placementTextLimits, log) {
  // Match an array containing at least one object
  const jsonMatch = String(content ?? '').match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!jsonMatch) {
    log.warn('Failed to parse JSON from AI response, using fallback');
    return fallbackParse(content, placements, placementTextLimits);
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      log.warn('Parsed JSON is not an array, using fallback');
      return fallbackParse(content, placements, placementTextLimits);
    }
    return parsed.map((item, idx) => ({
      id: randomUUID(),
      angle: item?.angle || `Variant ${idx + 1}`,
      headline: item?.headline || '',
      description: item?.description,
      bodyText: item?.bodyText,
      ctaText: item?.ctaText,
      platformAdaptations: adaptToPlacements(
        {
          headline: item?.headline,
          description: item?.description,
          bodyText: item?.bodyText,
          ctaText: item?.ctaText,
        },
        placements,
        placementTextLimits,
      ),
    }));
  } catch (err) {
    log.warn('JSON parse failed', { error: String(err?.message ?? err) });
    return fallbackParse(content, placements, placementTextLimits);
  }
}

function fallbackParse(content, placements, placementTextLimits) {
  const lines = String(content ?? '').split('\n').filter((l) => l.trim());
  return [{
    id: randomUUID(),
    angle: 'Generated',
    headline: lines[0]?.slice(0, 40) || 'Generated Ad',
    description: lines[1],
    platformAdaptations: adaptToPlacements(
      { headline: lines[0] || 'Generated Ad', description: lines[1] },
      placements,
      placementTextLimits,
    ),
  }];
}

export async function copyGenerate(ctx) {
  ensureCallAI(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const placements = Array.isArray(inputs.placements) ? inputs.placements : [];
  if (placements.length === 0) {
    return {
      status: 'error',
      error: { code: 'COPY_NO_PLACEMENTS', message: 'inputs.placements must be non-empty', retryable: false },
    };
  }

  const sellingPoints = Array.isArray(inputs.brief?.sellingPoints) ? inputs.brief.sellingPoints : [];
  if (sellingPoints.length === 0) {
    return {
      status: 'error',
      error: { code: 'COPY_NO_SELLING_POINTS', message: 'inputs.brief.sellingPoints must be non-empty', retryable: false },
    };
  }

  const variantCount = Math.min(
    Math.max(1, inputs.variantCount || DEFAULT_VARIANT_COUNT),
    MAX_VARIANTS,
  );
  const prompt = buildPrompt(inputs, variantCount);

  log.debug('Generating copy', {
    placements: placements.length,
    variantCount,
    angle: inputs.angle,
  });

  let variants;
  let model;
  let usage;
  try {
    const result = await ctx.callAI({
      provider: config.provider,
      model: config.model,
      systemPrompt: COPY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      temperature: config.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    });
    variants = parseVariants(result?.content, placements, inputs.placementTextLimits, log);
    model = result?.model;
    usage = result?.usage
      ? {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        }
      : undefined;
  } catch (err) {
    log.error('AI copy generation failed', { error: String(err?.message ?? err) });
    return {
      status: 'error',
      error: { code: 'COPY_GENERATE_FAILED', message: String(err?.message ?? err), retryable: true },
    };
  }

  log.info('Copy generated', { variants: variants.length, model });

  return {
    status: 'success',
    outputs: {
      variants,
      messageMatchScores: [],
      model,
      usage,
      success: true,
    },
  };
}

const nodes = {
  'ads.copy.generate': copyGenerate,
};

export default nodes;
