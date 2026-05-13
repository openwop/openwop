/**
 * vendor.myndhyve.market-intel-ad-angles
 *
 * Single typeId: `market-intel.ad-angles`
 *
 * Lifted from src/core/market-intel/prompts/adAngleBrief.ts (651 LOC TS).
 * Generates 5-10 ad-angle briefs from a VoC corpus + ICP/product context.
 *
 * One AI call site routes through ctx.callAI.
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

const VALID_INTENT_STAGES = ['ready_now', 'researching', 'problem_aware', 'unaware'];
const VALID_CTAS = ['info_offer', 'demo', 'trial', 'audit', 'consult', 'buy_now', 'learn_more'];

const SYSTEM_PROMPT = `You are an expert direct response copywriter and market strategist. Your task is to generate ad angle briefs based on Voice of Customer research.

## Core Principles

1. **Verbatim Language**: Use customer language from the VoC quotes. Don't sanitize or corporate-ify.
2. **Pain-Led Angles**: Strong ads address specific pains before promising outcomes.
3. **Evidence Required**: Every angle must be grounded in actual VoC data.
4. **Segment Appropriate**: Match CTA and messaging intensity to buyer readiness.

## Angle Framework

### Pain + Promise + Mechanism
- **Pain**: The specific frustration/problem (from VoC pains)
- **Promise**: The outcome/relief (from VoC desires)
- **Mechanism**: How the product delivers the promise (product differentiator)

### Segment-CTA Mapping
- **ready_now**: demo, trial, buy_now, consult
- **researching**: audit, demo, trial, info_offer
- **problem_aware**: info_offer, learn_more, audit
- **unaware**: learn_more, info_offer

## Hook Writing Guidelines

1. **Open with pain recognition**: "Still [doing frustrating thing]?"
2. **Use specifics**: Numbers, timeframes, concrete scenarios
3. **Agitate before solving**: Make them feel the pain before the relief
4. **Mirror their language**: Use exact phrases from VoC quotes
5. **Create curiosity**: Don't give everything away in the hook

## Hook Patterns (generate 3-5 per angle)

- Pain question: "Tired of [pain]?"
- Outcome promise: "What if you could [outcome] in [timeframe]?"
- Contrast: "Stop [old way]. Start [new way]."
- Social proof hook: "[X] companies already [benefit]"
- Mechanism hook: "The [mechanism] that [benefit]"
- Objection flip: "Even if [objection], you can still [benefit]"

## Output Requirements

1. Generate 5-10 distinct angles
2. Each angle needs:
   - At least 2 source quotes
   - 3-5 hook variants
   - Specific proof requirements
   - Objections to address
3. Score each angle on the 5 dimensions
4. Provide testing priority rationale`;

function buildUserPrompt(inputs) {
  const targetCount = inputs.targetAngleCount ?? 8;
  const minQuotes = inputs.minSourceQuotesPerAngle ?? 2;
  const voc = inputs.vocQuotes ?? {};
  const icp = inputs.icpContext ?? {};
  const prod = inputs.productContext ?? {};
  const top = Array.isArray(inputs.topCommunities) ? inputs.topCommunities : [];
  const competitors = Array.isArray(inputs.competitors) ? inputs.competitors : [];

  const formatQuotes = (quotes, limit = 10) => {
    const arr = Array.isArray(quotes) ? quotes : [];
    if (arr.length === 0) return 'None found';
    return arr.slice(0, limit).map((q) => {
      const qt = String(q?.quote ?? '');
      const trimmed = qt.length > 150 ? `${qt.substring(0, 150)}...` : qt;
      const c = q?.community || 'source';
      return `- "${trimmed}" [${c}]`;
    }).join('\n');
  };

  const communitySummary = top.slice(0, 5)
    .map((c) => `- **${c?.name ?? ''}** (score: ${c?.score ?? ''}): ${(Array.isArray(c?.themes) ? c.themes : []).join(', ')}`)
    .join('\n');

  const arr = (xs) => (Array.isArray(xs) ? xs : []);

  return `## Task
Generate ${targetCount} ad angle briefs based on the Voice of Customer research below. Each angle must have at least ${minQuotes} supporting source quotes.

## ICP Context
- **Roles**: ${arr(icp.roles).join(', ')}
- **Industry**: ${icp.industry ?? 'Not specified'}
- **Problems**: ${arr(icp.problems).join('; ')}
- **Outcomes**: ${arr(icp.outcomes).join('; ')}

## Product Context
- **Product**: ${prod.name ?? 'Not specified'}
- **Category**: ${prod.category ?? 'Not specified'}
- **Differentiators**: ${arr(prod.differentiators).join('; ')}
- **Mechanisms**: ${arr(prod.mechanisms).join('; ')}
- **Proof Points**: ${arr(prod.proofPoints).join('; ')}

${competitors.length > 0 ? `## Competitors\n${competitors.join(', ')}\n` : ''}

## Top Communities
${communitySummary || '- (none provided)'}

## VoC Evidence

### Pains (${(voc.pains?.length ?? 0)} quotes)
${formatQuotes(voc.pains)}

### Desires (${(voc.desires?.length ?? 0)} quotes)
${formatQuotes(voc.desires)}

### Objections (${(voc.objections?.length ?? 0)} quotes)
${formatQuotes(voc.objections)}

### Triggers (${(voc.triggers?.length ?? 0)} quotes)
${formatQuotes(voc.triggers)}

### Proof Requests (${(voc.proofRequests?.length ?? 0)} quotes)
${formatQuotes(voc.proofRequests)}

### Alternatives Mentioned (${(voc.alternatives?.length ?? 0)} quotes)
${formatQuotes(voc.alternatives)}

## Instructions
1. Identify distinct pain + promise combinations from the VoC data
2. Create ${targetCount} angle briefs, each targeting a specific segment
3. For each angle:
   - Write 3-5 hook variants using customer language
   - Map to a mechanism from the product context
   - Identify objections to handle
   - Specify what proof is needed
   - Choose the appropriate CTA
   - Include at least ${minQuotes} source quotes as evidence
4. Score each angle on volume, intensity, commercial intent, clarity, uniqueness
5. Provide testing priority recommendations

## Required Output Format
Respond with valid JSON matching this structure:
\`\`\`json
{
  "briefs": [
    {
      "angleId": "angle-1",
      "angleName": "descriptive name",
      "segment": "ready_now|researching|problem_aware|unaware",
      "corePain": "the specific pain",
      "promise": "the outcome/relief",
      "mechanism": "how it works",
      "proofNeeded": ["case studies", "ROI calculator"],
      "objectionsToHandle": ["objection 1", "objection 2"],
      "hookVariants": ["hook 1", "hook 2", "hook 3"],
      "recommendedCta": "demo|trial|info_offer|audit|consult|buy_now|learn_more",
      "sourceQuotes": [
        { "quote": "exact quote", "url": "source url", "community": "community name" }
      ],
      "score": {
        "volume": 1-10,
        "intensity": 1-10,
        "commercialIntent": 1-10,
        "clarity": 1-10,
        "uniqueness": 1-10,
        "total": weighted average
      },
      "rationale": "why this angle will work"
    }
  ],
  "segmentBreakdown": { "ready_now": 2, "researching": 3, "problem_aware": 2, "unaware": 1 },
  "crossAngleThemes": ["theme1", "theme2"],
  "testingPriority": [{ "angleId": "angle-1", "reason": "why test first" }],
  "warnings": ["any caveats"]
}
\`\`\``;
}

function parseJSONFromAI(content) {
  const cleaned = String(content ?? '').replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function clampScore(val) {
  if (val == null || (typeof val === 'string' && val.trim() === '')) return 5;
  const n = Number(val);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, n));
}

function validateScore(score) {
  if (!score || typeof score !== 'object') return null;
  const volume = clampScore(score.volume);
  const intensity = clampScore(score.intensity);
  const commercialIntent = clampScore(score.commercialIntent);
  const clarity = clampScore(score.clarity);
  const uniqueness = clampScore(score.uniqueness);
  const totalCandidate = typeof score.total === 'number' && score.total >= 0
    ? score.total
    : volume * 0.2 + intensity * 0.25 + commercialIntent * 0.3 + clarity * 0.15 + uniqueness * 0.1;
  return {
    volume, intensity, commercialIntent, clarity, uniqueness,
    total: Math.round(totalCandidate * 100) / 100,
  };
}

function validateSourceQuote(quote) {
  if (!quote || typeof quote !== 'object') return null;
  if (typeof quote.quote !== 'string' || quote.quote.length < 5) return null;
  return {
    quote: quote.quote,
    url: typeof quote.url === 'string' ? quote.url : '',
    community: typeof quote.community === 'string' ? quote.community : undefined,
  };
}

function defaultScore() {
  return { volume: 5, intensity: 5, commercialIntent: 5, clarity: 5, uniqueness: 5, total: 5 };
}

function emptyOutput(warning) {
  return {
    briefs: [],
    segmentBreakdown: { ready_now: 0, researching: 0, problem_aware: 0, unaware: 0 },
    crossAngleThemes: [],
    testingPriority: [],
    warnings: warning ? [warning] : [],
  };
}

function validateOutput(raw) {
  if (!raw || typeof raw !== 'object') return emptyOutput('Output was not an object');
  if (!Array.isArray(raw.briefs)) return emptyOutput('Output missing briefs array');

  const validatedBriefs = [];
  const validationWarnings = [];

  for (let i = 0; i < raw.briefs.length; i++) {
    const b = raw.briefs[i];
    if (!b || typeof b !== 'object') {
      validationWarnings.push(`Brief ${i} is not an object, skipping`);
      continue;
    }
    if (typeof b.angleName !== 'string' || b.angleName.length === 0) {
      validationWarnings.push(`Brief ${i} missing angleName, skipping`);
      continue;
    }
    if (typeof b.corePain !== 'string' || b.corePain.length === 0) {
      validationWarnings.push(`Brief ${i} missing corePain, skipping`);
      continue;
    }

    const segment = VALID_INTENT_STAGES.includes(b.segment) ? b.segment : 'researching';
    const recommendedCta = VALID_CTAS.includes(b.recommendedCta) ? b.recommendedCta : 'learn_more';

    const hookVariants = Array.isArray(b.hookVariants)
      ? b.hookVariants.filter((h) => typeof h === 'string' && h.length > 0)
      : [];
    if (hookVariants.length === 0) {
      validationWarnings.push(`Brief ${i} has no hook variants`);
    }

    const sourceQuotes = [];
    if (Array.isArray(b.sourceQuotes)) {
      for (const sq of b.sourceQuotes) {
        const v = validateSourceQuote(sq);
        if (v) sourceQuotes.push(v);
      }
    }

    const score = validateScore(b.score) ?? defaultScore();

    validatedBriefs.push({
      angleId: typeof b.angleId === 'string' ? b.angleId : `angle-${i + 1}`,
      angleName: b.angleName,
      segment,
      corePain: b.corePain,
      promise: typeof b.promise === 'string' ? b.promise : '',
      mechanism: typeof b.mechanism === 'string' ? b.mechanism : '',
      proofNeeded: Array.isArray(b.proofNeeded) ? b.proofNeeded.filter((p) => typeof p === 'string') : [],
      objectionsToHandle: Array.isArray(b.objectionsToHandle) ? b.objectionsToHandle.filter((o) => typeof o === 'string') : [],
      hookVariants,
      recommendedCta,
      sourceQuotes,
      score,
      rationale: typeof b.rationale === 'string' ? b.rationale : '',
    });
  }

  validatedBriefs.sort((a, b) => b.score.total - a.score.total);

  const segmentBreakdown = { ready_now: 0, researching: 0, problem_aware: 0, unaware: 0 };
  for (const brief of validatedBriefs) segmentBreakdown[brief.segment]++;

  const crossAngleThemes = Array.isArray(raw.crossAngleThemes)
    ? raw.crossAngleThemes.filter((t) => typeof t === 'string')
    : [];

  const testingPriority = [];
  if (Array.isArray(raw.testingPriority)) {
    for (const tp of raw.testingPriority) {
      if (tp && typeof tp === 'object' && typeof tp.angleId === 'string' && typeof tp.reason === 'string') {
        testingPriority.push({ angleId: tp.angleId, reason: tp.reason });
      }
    }
  }

  const upstreamWarnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w) => typeof w === 'string')
    : [];

  return {
    briefs: validatedBriefs,
    segmentBreakdown,
    crossAngleThemes,
    testingPriority,
    warnings: [...upstreamWarnings, ...validationWarnings],
  };
}

export async function adAngles(ctx) {
  ensureCallAI(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  if (!inputs.vocQuotes || typeof inputs.vocQuotes !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.vocQuotes is required (object with pains/desires/objections/triggers/proofRequests/alternatives)', retryable: false } };
  }
  if (!inputs.icpContext || typeof inputs.icpContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.icpContext is required', retryable: false } };
  }
  if (!inputs.productContext || typeof inputs.productContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.productContext is required', retryable: false } };
  }

  const vocCount = ['pains', 'desires', 'objections', 'triggers', 'proofRequests', 'alternatives']
    .reduce((sum, key) => sum + (Array.isArray(inputs.vocQuotes[key]) ? inputs.vocQuotes[key].length : 0), 0);
  if (vocCount === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.vocQuotes must contain at least one quote across pains/desires/objections/triggers/proofRequests/alternatives', retryable: false } };
  }

  log.debug('Generating ad angle briefs', {
    targetAngleCount: inputs.targetAngleCount ?? 8,
    vocQuoteTotal: vocCount,
  });

  let aiResult;
  try {
    aiResult = await ctx.callAI({
      provider: config.provider,
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(inputs) }],
      temperature: config.temperature ?? 0.6,
      maxTokens: config.maxTokens ?? 6000,
    });
  } catch (err) {
    log.error('AI ad-angle generation failed', { error: String(err?.message ?? err) });
    return { status: 'error', error: { code: 'AD_ANGLES_FAILED', message: String(err?.message ?? err), retryable: true } };
  }

  const parsed = parseJSONFromAI(aiResult?.content);
  if (!parsed) {
    log.warn('AI response could not be parsed as JSON, returning empty brief set');
    return {
      status: 'success',
      outputs: {
        ...emptyOutput('AI response could not be parsed as JSON'),
        briefCount: 0,
        model: aiResult?.model,
        usage: aiResult?.usage,
        success: true,
      },
    };
  }

  const validated = validateOutput(parsed);

  log.info('Ad angle briefs generated', {
    briefs: validated.briefs.length,
    warnings: validated.warnings.length,
    segmentBreakdown: validated.segmentBreakdown,
  });

  return {
    status: 'success',
    outputs: {
      briefs: validated.briefs,
      segmentBreakdown: validated.segmentBreakdown,
      crossAngleThemes: validated.crossAngleThemes,
      testingPriority: validated.testingPriority,
      warnings: validated.warnings,
      briefCount: validated.briefs.length,
      model: aiResult?.model,
      usage: aiResult?.usage,
      success: true,
    },
  };
}

const nodes = {
  'market-intel.ad-angles': adAngles,
};

export default nodes;
