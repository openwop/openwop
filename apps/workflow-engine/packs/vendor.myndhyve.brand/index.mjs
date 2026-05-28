/**
 * vendor.myndhyve.brand — brand-workflow pack runtime.
 *
 * 14 nodes covering brand theme + persona workflows. Most route
 * through ctx.aiEnvelope.generate (AI-generative) or ctx.brand.*
 * (state mutation + validation + review).
 *
 * Architectural patterns:
 *   - AI-generative nodes (analyze, discovery, generate, templates,
 *     persona.discover/generate/keywordStrategy): emit typed envelope
 *     via ctx.aiEnvelope.generate with envelopeType = `<scope>.create`
 *     (e.g., `theme.create`, `persona.create`, `brand.templates.create`).
 *   - State-mutation nodes (theme.implement, theme.publish,
 *     persona.publish): route through ctx.brand.* adapter; idempotency-
 *     keyed for replay safety.
 *   - HITL review nodes (theme.review, persona.review): suspend via
 *     ctx.suspend({ reason: 'conversation-input', resumeKey, ... });
 *     decision enum: approve / reject / request-changes.
 *   - Validate nodes (theme.validate, persona.validate): rule-engine
 *     via ctx.brand.validate; returns passed + violations.
 *
 * @see docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md
 */

import { createHash } from 'node:crypto';

function ensureBrand(ctx) {
  if (!ctx.brand) {
    throw Object.assign(new Error('host does not expose ctx.brand'), { code: 'host_capability_missing' });
  }
}

function ensureAi(ctx) {
  if (!ctx.aiEnvelope || typeof ctx.aiEnvelope.generate !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.aiEnvelope'), { code: 'host_capability_missing' });
  }
}

function deriveIdempotencyKey(parts) {
  const h = createHash('sha256');
  for (const p of parts) {
    if (p === undefined || p === null) h.update('\0');
    else if (typeof p === 'string') h.update(p, 'utf8');
    else h.update(JSON.stringify(p), 'utf8');
    h.update('\x1e');
  }
  return 'openwop-' + h.digest('hex').slice(0, 16);
}

/**
 * Generic AI-generative node implementation. Used by 7 of the 14
 * nodes (analyze, discovery, generate, templates × theme + persona).
 */
function makeAiGenerator(envelopeType, systemPrompt) {
  return async function aiGen(ctx) {
    ensureAi(ctx);
    const { provider, model, temperature } = ctx.config;
    const { brandId, context, answers } = ctx.inputs ?? {};
    const idempotencyKey = deriveIdempotencyKey([
      String(ctx.runId), String(ctx.nodeId), envelopeType,
      brandId ?? '', context ?? null, answers ?? null,
    ]);
    const result = await ctx.aiEnvelope.generate({
      systemPrompt,
      envelopeType,
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      context: { brandId, ...context, answers },
      idempotencyKey,
    });
    return {
      status: 'success',
      outputs: {
        envelopeType: result?.envelopeType ?? envelopeType,
        payload: result?.payload ?? null,
        ...(result?.envelopeId ? { envelopeId: result.envelopeId } : {}),
        ...(result?.usage ? { usage: result.usage } : {}),
        ...(result?.model ? { model: result.model } : {}),
      },
    };
  };
}

// 7 AI-generative nodes — one factory call each
export const themeAnalyze = makeAiGenerator(
  'theme.analyze',
  'Analyze the provided brand inputs (logo, colors, sample copy). Extract a candidate theme: palette, typography, voice. Return as a theme draft.'
);
export const themeDiscovery = makeAiGenerator(
  'theme.discovery',
  'Take the discovery-questionnaire answers and synthesize them into a draft brand theme. Honor the user\'s stated tone, audience, and constraints.'
);
export const themeGenerate = makeAiGenerator(
  'theme.create',
  'Generate a complete brand theme from a brief. Include palette (3-5 colors), typography (heading + body fonts), voice guidelines.'
);
export const themeTemplates = makeAiGenerator(
  'brand.templates.create',
  'Given a brand theme, generate reusable templates: 3 social-post variants, 2 email-banner variants, 1 web-hero variant. Honor the theme exactly.'
);
export const personaDiscover = makeAiGenerator(
  'persona.discovery',
  'Take the discovery-questionnaire answers and synthesize them into a draft customer persona.'
);
export const personaGenerate = makeAiGenerator(
  'persona.create',
  'Generate a customer persona from market signals + brand context. Include demographics, pain points, search intent, day-in-the-life snapshot.'
);
export const personaKeywordStrategy = makeAiGenerator(
  'persona.keywordStrategy',
  'Derive an SEO keyword strategy from the persona\'s pain points + search intent. Output: 5-10 primary keywords, 10-20 long-tail, with search-intent classification (informational / transactional / navigational).'
);

/* ─── State-mutation nodes (implement / publish) ────────── */

async function applyOrPublish(ctx, op, envelopeType) {
  ensureBrand(ctx);
  if (typeof ctx.brand[op] !== 'function') {
    throw Object.assign(new Error(`host does not expose ctx.brand.${op}`), { code: 'host_capability_missing' });
  }
  const { force = false } = ctx.config;
  const { brandId, payload, targetCanvasId } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), op, brandId, payload, targetCanvasId ?? '', force,
  ]);
  const result = await ctx.brand[op]({
    brandId, payload, force,
    ...(targetCanvasId !== undefined ? { targetCanvasId } : {}),
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      brandId,
      artifactId: result?.artifactId ?? '',
      appliedAt: result?.appliedAt ?? new Date().toISOString(),
      idempotencyKey,
    },
  };
}

export const themeImplement = (ctx) => applyOrPublish(ctx, 'implementTheme', 'theme.implement');
export const themePublish = (ctx) => applyOrPublish(ctx, 'publishTheme', 'theme.publish');
export const personaPublish = (ctx) => applyOrPublish(ctx, 'publishPersona', 'persona.publish');

/* ─── HITL review nodes ────────────────────────────────── */

function makeReview(reviewType) {
  return async function review(ctx) {
    ensureBrand(ctx);
    if (typeof ctx.suspend !== 'function') {
      throw Object.assign(new Error('host does not expose ctx.suspend'), { code: 'host_capability_missing' });
    }
    const { reviewerRole, timeoutMs } = ctx.config;
    const { artifactId, summary } = ctx.inputs;

    // Surface the review card if host exposes chat/card adapter.
    if (typeof ctx.chat?.emitCard === 'function') {
      await ctx.chat.emitCard({
        cardId: `${reviewType}-${artifactId}`,
        cardType: `brand-${reviewType}-review`,
        payload: { artifactId, summary, reviewerRole },
        idempotencyKey: deriveIdempotencyKey([String(ctx.runId), String(ctx.nodeId), reviewType, artifactId, 'card']),
      });
    }

    const resumePayload = await ctx.suspend({
      reason: 'conversation-input',
      resumeKey: `${reviewType}-review-${artifactId}`,
      reviewerRole,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });

    if (resumePayload?.timedOut === true) {
      return {
        status: 'success',
        outputs: { artifactId, decision: 'reject', notes: 'timed out', respondedAt: new Date().toISOString(), timedOut: true },
      };
    }

    return {
      status: 'success',
      outputs: {
        artifactId,
        decision: resumePayload?.decision ?? 'request-changes',
        ...(resumePayload?.notes ? { notes: resumePayload.notes } : {}),
        ...(resumePayload?.respondent ? { respondent: resumePayload.respondent } : {}),
        respondedAt: resumePayload?.respondedAt ?? new Date().toISOString(),
      },
    };
  };
}

export const themeReview = makeReview('theme');
export const personaReview = makeReview('persona');

/* ─── Validate nodes ───────────────────────────────────── */

function makeValidate(validateOp) {
  return async function validate(ctx) {
    ensureBrand(ctx);
    if (typeof ctx.brand[validateOp] !== 'function') {
      throw Object.assign(new Error(`host does not expose ctx.brand.${validateOp}`), { code: 'host_capability_missing' });
    }
    const { ruleSet, failOnWarning = false } = ctx.config;
    const { artifactId } = ctx.inputs;
    const result = await ctx.brand[validateOp]({
      artifactId,
      ...(ruleSet !== undefined ? { ruleSet } : {}),
      failOnWarning,
    });
    const violations = Array.isArray(result?.violations) ? result.violations : [];
    const hasErrors = violations.some((v) => v.severity === 'error');
    const hasWarnings = violations.some((v) => v.severity === 'warning');
    const passed = !hasErrors && (!failOnWarning || !hasWarnings);
    return {
      status: 'success',
      outputs: {
        artifactId,
        passed,
        rulesRun: typeof result?.rulesRun === 'number' ? result.rulesRun : 0,
        ...(violations.length ? { violations } : {}),
      },
    };
  };
}

export const themeValidate = makeValidate('validateTheme');
export const personaValidate = makeValidate('validatePersona');

/* ─── Pack registry ───────────────────────────────────── */

export const nodes = {
  'brand.theme.analyze': themeAnalyze,
  'brand.theme.discovery': themeDiscovery,
  'brand.theme.generate': themeGenerate,
  'brand.theme.implement': themeImplement,
  'brand.theme.publish': themePublish,
  'brand.theme.review': themeReview,
  'brand.theme.templates': themeTemplates,
  'brand.theme.validate': themeValidate,
  'brand.persona.discover': personaDiscover,
  'brand.persona.generate': personaGenerate,
  'brand.persona.keywordStrategy': personaKeywordStrategy,
  'brand.persona.publish': personaPublish,
  'brand.persona.review': personaReview,
  'brand.persona.validate': personaValidate,
};

export default nodes;
