/**
 * vendor.myndhyve.market-intel-voc
 *
 * Single typeId: `market-intel.voc-extraction`
 *
 * Lifted from src/core/market-intel/prompts/vocExtraction.ts (404 LOC TS) +
 * the executor wrapper in src/canvas-types/campaign-studio/nodes/marketIntel/
 * executors.ts. One AI call site routes through ctx.callAI.
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

function ensureCallAI(ctx) {
  if (typeof ctx.callAI !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.callAI — workflow-register should have refused this pack at peerDependency resolution time'),
      { code: 'host_capability_missing', capability: 'aiProviders' },
    );
  }
}

const VALID_TAG_TYPES = ['pain', 'desire', 'objection', 'trigger', 'proof_request', 'alternative'];
const VALID_INTENT_STAGES = ['ready_now', 'researching', 'problem_aware', 'unaware'];

const SYSTEM_PROMPT = `You are a Voice of Customer (VoC) extraction specialist. Your task is to extract verbatim quotes from content that reveal customer pains, desires, objections, triggers, proof requests, and alternatives they've tried.

## Core Principles

1. **Verbatim First**: Extract exact quotes as written. Do not paraphrase or clean up language.
2. **Evidence-Based**: Only extract quotes that genuinely reveal customer insight. Skip generic statements.
3. **Conservative Confidence**: Rate confidence based on clarity and specificity. Vague statements get lower scores.
4. **Grounding Required**: Every quote must be traceable to the source content.

## Tag Type Definitions

- **pain**: Frustrations, problems, struggles the customer explicitly mentions
- **desire**: Goals, outcomes, wishes the customer wants to achieve
- **objection**: Concerns, doubts, reasons for not taking action
- **trigger**: Events, moments, situations that prompt action
- **proof_request**: Questions about evidence, case studies, social proof
- **alternative**: Competing solutions, workarounds, other products mentioned

## Intent Stage Definitions

- **ready_now**: Actively looking to buy/switch, comparing options, asking for recommendations
- **researching**: Gathering information, evaluating options, not urgently buying
- **problem_aware**: Knows the problem exists but not actively seeking solutions
- **unaware**: Discussing adjacent topics, may not realize they have the problem

## Confidence Scoring (0-1)

- **0.9-1.0**: Crystal clear, specific, actionable insight with strong emotional language
- **0.7-0.89**: Clear insight but somewhat general or could apply broadly
- **0.5-0.69**: Relevant but vague, requires interpretation
- **0.3-0.49**: Tangentially relevant, weak signal
- **0.0-0.29**: Very weak, speculative, or ambiguous

## Output Requirements

1. Extract 5-15 high-quality quotes (or fewer if content is sparse)
2. Prefer longer quotes (2-4 sentences) over single-word snippets
3. Include context if quote alone is ambiguous
4. Skip quotes that are:
   - Too generic to be actionable
   - Off-topic for the ICP/product context
   - Unclear or ambiguous
   - Just opinions with no underlying need`;

function buildUserPrompt(inputs) {
  const maxRecords = inputs.maxRecords ?? 15;
  const icp = inputs.icpContext ?? {};
  const prod = inputs.productContext ?? {};

  const roles = Array.isArray(icp.roles) ? icp.roles : [];
  const problems = Array.isArray(icp.problems) ? icp.problems : [];
  const outcomes = Array.isArray(icp.outcomes) ? icp.outcomes : [];
  const differentiators = Array.isArray(prod.differentiators) ? prod.differentiators : [];

  return `## Task
Extract Voice of Customer (VoC) records from the following content. Focus on quotes that would be valuable for marketing messaging and product positioning.

## ICP Context
- **Roles**: ${roles.join(', ')}
- **Industry**: ${icp.industry ?? 'Not specified'}
- **Problems they face**: ${problems.join('; ')}
- **Outcomes they want**: ${outcomes.join('; ')}

## Product Context
- **Product**: ${prod.name ?? 'Not specified'}
- **Category**: ${prod.category ?? 'Not specified'}
- **Differentiators**: ${differentiators.join('; ')}

## Source Information
- **URL**: ${inputs.sourceUrl ?? ''}
- **Title**: ${inputs.sourceTitle ?? ''}
- **Platform**: ${inputs.platform ?? ''}
- **Community**: ${inputs.community ?? ''}

## Content to Analyze
\`\`\`
${inputs.content}
\`\`\`

## Instructions
1. Read the content carefully
2. Identify quotes that reveal pains, desires, objections, triggers, proof requests, or alternatives
3. For each quote, determine the tag type, intent stage, and confidence
4. Extract up to ${maxRecords} high-quality records
5. If the content has fewer than 3 valuable quotes, note this in warnings

## Required Output Format
Respond with valid JSON matching this structure:
\`\`\`json
{
  "records": [
    {
      "quote": "The exact verbatim quote from the content",
      "tagType": "pain|desire|objection|trigger|proof_request|alternative",
      "intentStage": "ready_now|researching|problem_aware|unaware",
      "impliedOutcome": "What the person wants to achieve (optional)",
      "confidence": 0.0-1.0,
      "classificationRationale": "Why this tag and intent stage"
    }
  ],
  "summary": {
    "totalQuotesFound": number,
    "highConfidenceCount": number,
    "tagDistribution": { "pain": n, "desire": n, ... },
    "intentDistribution": { "ready_now": n, ... }
  },
  "warnings": ["Any issues encountered"]
}
\`\`\``;
}

function parseJSONFromAI(content) {
  const cleaned = String(content ?? '').replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function validateOutput(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      records: [],
      summary: emptySummary(),
      warnings: ['Output was not an object'],
    };
  }
  if (!Array.isArray(raw.records)) {
    return {
      records: [],
      summary: emptySummary(),
      warnings: ['Output missing records array'],
    };
  }

  const validated = [];
  const validationWarnings = [];

  for (let i = 0; i < raw.records.length; i++) {
    const rec = raw.records[i];
    if (!rec || typeof rec !== 'object') {
      validationWarnings.push(`Record ${i} is not an object, skipping`);
      continue;
    }
    if (typeof rec.quote !== 'string' || rec.quote.length < 10) {
      validationWarnings.push(`Record ${i} has invalid quote, skipping`);
      continue;
    }
    if (!VALID_TAG_TYPES.includes(rec.tagType)) {
      validationWarnings.push(`Record ${i} has invalid tagType "${rec.tagType}", skipping`);
      continue;
    }
    if (!VALID_INTENT_STAGES.includes(rec.intentStage)) {
      validationWarnings.push(`Record ${i} has invalid intentStage "${rec.intentStage}", skipping`);
      continue;
    }
    const conf = Number(rec.confidence);
    const confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5;
    if (!Number.isFinite(conf)) {
      validationWarnings.push(`Record ${i} has invalid confidence "${rec.confidence}", defaulting to 0.5`);
    }
    validated.push({
      quote: rec.quote,
      tagType: rec.tagType,
      intentStage: rec.intentStage,
      impliedOutcome: typeof rec.impliedOutcome === 'string' ? rec.impliedOutcome : undefined,
      confidence,
      classificationRationale: typeof rec.classificationRationale === 'string'
        ? rec.classificationRationale
        : 'No rationale provided',
    });
  }

  const tagDistribution = { pain: 0, desire: 0, objection: 0, trigger: 0, proof_request: 0, alternative: 0 };
  const intentDistribution = { ready_now: 0, researching: 0, problem_aware: 0, unaware: 0 };
  let highConfidenceCount = 0;
  for (const r of validated) {
    tagDistribution[r.tagType]++;
    intentDistribution[r.intentStage]++;
    if (r.confidence >= 0.7) highConfidenceCount++;
  }

  const upstreamWarnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w) => typeof w === 'string')
    : [];

  return {
    records: validated,
    summary: {
      totalQuotesFound: validated.length,
      highConfidenceCount,
      tagDistribution,
      intentDistribution,
    },
    warnings: [...upstreamWarnings, ...validationWarnings],
  };
}

function emptySummary() {
  return {
    totalQuotesFound: 0,
    highConfidenceCount: 0,
    tagDistribution: { pain: 0, desire: 0, objection: 0, trigger: 0, proof_request: 0, alternative: 0 },
    intentDistribution: { ready_now: 0, researching: 0, problem_aware: 0, unaware: 0 },
  };
}

export async function vocExtraction(ctx) {
  ensureCallAI(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const content = String(inputs.content ?? '').trim();
  if (content.length === 0) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.content is required (non-empty string)', retryable: false },
    };
  }
  if (!inputs.icpContext || typeof inputs.icpContext !== 'object') {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.icpContext is required (object with roles/industry/problems/outcomes)', retryable: false },
    };
  }
  if (!inputs.productContext || typeof inputs.productContext !== 'object') {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.productContext is required (object with name/category/differentiators)', retryable: false },
    };
  }

  log.debug('Extracting VoC records', {
    contentLen: content.length,
    platform: inputs.platform,
    maxRecords: inputs.maxRecords ?? 15,
  });

  let aiResult;
  try {
    aiResult = await ctx.callAI({
      provider: config.provider,
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(inputs) }],
      temperature: config.temperature ?? 0.3,
      maxTokens: config.maxTokens ?? 4096,
    });
  } catch (err) {
    log.error('AI VoC extraction failed', { error: String(err?.message ?? err) });
    return {
      status: 'error',
      error: { code: 'VOC_EXTRACTION_FAILED', message: String(err?.message ?? err), retryable: true },
    };
  }

  const parsed = parseJSONFromAI(aiResult?.content);
  if (!parsed) {
    log.warn('AI response could not be parsed as JSON, returning empty record set');
    return {
      status: 'success',
      outputs: {
        records: [],
        summary: emptySummary(),
        warnings: ['AI response could not be parsed as JSON'],
        recordCount: 0,
        model: aiResult?.model,
        usage: aiResult?.usage,
        success: true,
      },
    };
  }

  const validated = validateOutput(parsed);

  log.info('VoC extraction completed', {
    records: validated.records.length,
    highConfidence: validated.summary.highConfidenceCount,
    warnings: validated.warnings.length,
  });

  return {
    status: 'success',
    outputs: {
      records: validated.records,
      summary: validated.summary,
      warnings: validated.warnings,
      recordCount: validated.records.length,
      model: aiResult?.model,
      usage: aiResult?.usage,
      success: true,
    },
  };
}

const nodes = {
  'market-intel.voc-extraction': vocExtraction,
};

export default nodes;
