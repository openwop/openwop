/**
 * vendor.myndhyve.market-intel-opportunity-scoring
 *
 * Single typeId: `market-intel.opportunity-scoring`
 *
 * Lifted from src/core/market-intel/prompts/opportunityScoring.ts (709 LOC TS).
 * Scores + ranks communities AND messaging angles on a 5-dimension scale
 * (volume/intensity/commercialIntent/clarity/uniqueness with weighted total)
 * given a VoC corpus + community metadata.
 *
 * Composable primitive — slots between voc-extraction (aggregator) and
 * ad-angles (downstream consumer). Source-side it's used inside the
 * `market-intel.research` orchestrator; published here as a standalone
 * typeId so workflow authors can compose it directly.
 *
 * One AI call. Pure-JS, Node-20 stdlib only.
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
const VALID_PLATFORMS = ['reddit', 'hn', 'stackexchange', 'forum', 'reviews', 'other'];

const SYSTEM_PROMPT = `You are a market opportunity analyst. Your task is to score and rank communities and messaging angles based on Voice of Customer data.

## Core Principles

1. **Evidence-Based Scoring**: Every score must be justified by the data. No speculation.
2. **Comparative Analysis**: Scores are relative to other opportunities in the set.
3. **Actionable Output**: Rankings should directly inform marketing decisions.
4. **Conservative Estimates**: When uncertain, score lower. False positives waste budget.

## Scoring Dimensions (1-10 scale each)

### Volume (Weight: 20%)
How much signal exists?
- 9-10: 50+ relevant VoC records
- 7-8: 20-49 records
- 5-6: 10-19 records
- 3-4: 5-9 records
- 1-2: <5 records

### Intensity (Weight: 25%)
How strong is the emotional/urgency language?
- 9-10: Desperate language ("need this yesterday", "killing me")
- 7-8: Strong frustration or desire
- 5-6: Moderate concern
- 3-4: Mild interest
- 1-2: Neutral/passive

### Commercial Intent (Weight: 30%)
How close to a purchase decision?
- 9-10: Actively comparing/buying
- 7-8: Researching solutions
- 5-6: Acknowledging need for solution
- 3-4: Problem-aware only
- 1-2: Adjacent/unaware

### Clarity (Weight: 15%)
How actionable is the insight for messaging?
- 9-10: Crystal clear pain + desired outcome
- 7-8: Clear pain, implied outcome
- 5-6: General frustration, some specifics
- 3-4: Vague complaints
- 1-2: Very unclear

### Uniqueness (Weight: 10%)
How differentiated is this opportunity?
- 9-10: No competitors mentioned, blue ocean
- 7-8: Few alternatives discussed
- 5-6: Some competition awareness
- 3-4: Crowded space, many alternatives
- 1-2: Commodity, heavily competed

## Angle Identification

When identifying angles, look for:
- Pain + outcome pairs
- Specific triggers/moments
- Objection patterns to address
- Proof types requested
- Alternative solutions mentioned (competition)

## Output Requirements

1. Rank communities by total weighted score
2. Identify 5-10 distinct angles with evidence
3. Assign priority (1 = test first) based on opportunity size and feasibility
4. Provide actionable recommendations`;

function buildUserPrompt(inputs) {
  const maxOpportunities = inputs.maxOpportunities ?? 10;
  const w = inputs.scoringWeights ?? {};
  const weights = {
    volume: w.volume ?? 0.2,
    intensity: w.intensity ?? 0.25,
    commercialIntent: w.commercialIntent ?? 0.3,
    clarity: w.clarity ?? 0.15,
    uniqueness: w.uniqueness ?? 0.1,
  };

  const vocRecords = Array.isArray(inputs.vocRecords) ? inputs.vocRecords : [];
  const communities = Array.isArray(inputs.communities) ? inputs.communities : [];
  const icp = inputs.icpContext ?? {};
  const prod = inputs.productContext ?? {};
  const arr = (xs) => (Array.isArray(xs) ? xs : []);

  const vocSummary = vocRecords.slice(0, 50).map((v, i) => {
    const conf = Number(v?.confidence);
    const confText = Number.isFinite(conf) ? conf.toFixed(2) : '?';
    return `${i + 1}. [${v?.tagType ?? '?'}/${v?.intentStage ?? '?'}] (conf: ${confText}) ${v?.community ?? '?'}: "${v?.quotePreview ?? ''}"`;
  }).join('\n');

  const communitySummary = communities.map((c) => {
    const intentDist = Object.entries(c?.intentDistribution ?? {})
      .filter(([_, count]) => Number(count) > 0)
      .map(([stage, count]) => `${stage}:${count}`)
      .join(', ');
    const tagDist = Object.entries(c?.tagDistribution ?? {})
      .filter(([_, count]) => Number(count) > 0)
      .map(([tag, count]) => `${tag}:${count}`)
      .join(', ');
    const avgConf = Number(c?.avgConfidence);
    const avgText = Number.isFinite(avgConf) ? avgConf.toFixed(2) : '?';
    const samples = arr(c?.sampleQuotes).slice(0, 2).map((q) => `"${String(q).substring(0, 100)}..."`).join('; ');
    return `**${c?.name ?? '?'}** (${c?.platform ?? 'other'})
- VoC count: ${c?.vocCount ?? 0}, Avg confidence: ${avgText}
- Intent: ${intentDist || 'N/A'}
- Tags: ${tagDist || 'N/A'}
- Samples: ${samples}`;
  }).join('\n\n');

  return `## Task
Score and rank the market opportunities based on Voice of Customer data. Identify the highest-value communities and messaging angles.

## ICP Context
- **Roles**: ${arr(icp.roles).join(', ')}
- **Industry**: ${icp.industry ?? 'Not specified'}
- **Problems**: ${arr(icp.problems).join('; ')}
- **Outcomes**: ${arr(icp.outcomes).join('; ')}

## Product Context
- **Product**: ${prod.name ?? 'Not specified'}
- **Category**: ${prod.category ?? 'Not specified'}
- **Differentiators**: ${arr(prod.differentiators).join('; ')}

## Scoring Weights
- Volume: ${(weights.volume * 100).toFixed(0)}%
- Intensity: ${(weights.intensity * 100).toFixed(0)}%
- Commercial Intent: ${(weights.commercialIntent * 100).toFixed(0)}%
- Clarity: ${(weights.clarity * 100).toFixed(0)}%
- Uniqueness: ${(weights.uniqueness * 100).toFixed(0)}%

## VoC Records (${vocRecords.length} total, showing up to 50)
${vocSummary}

## Communities to Score (${communities.length} total)
${communitySummary}

## Instructions
1. Analyze all VoC records and community data
2. Score each community on all 5 dimensions
3. Identify distinct messaging angles from the data
4. Score each angle on all 5 dimensions
5. Rank and prioritize (return top ${maxOpportunities} of each)
6. Provide strategic insights and recommendations

## Required Output Format
Respond with valid JSON matching this structure:
\`\`\`json
{
  "rankedCommunities": [
    {
      "community": "community name",
      "platform": "reddit|hn|stackexchange|forum|reviews|other",
      "score": {
        "volume": 1-10, "intensity": 1-10, "commercialIntent": 1-10, "clarity": 1-10, "uniqueness": 1-10, "total": weighted average
      },
      "rationale": "why this community is valuable",
      "themes": ["theme1", "theme2"],
      "focusAreas": ["area1", "area2"],
      "risks": ["risk1"]
    }
  ],
  "rankedAngles": [
    {
      "angleId": "angle-1",
      "angleName": "descriptive name",
      "segment": "ready_now|researching|problem_aware|unaware",
      "corePain": "the pain being addressed",
      "promise": "the solution/outcome",
      "score": { ... same as above ... },
      "evidence": ["quote1", "quote2"],
      "rationale": "why this angle works",
      "communities": ["community1", "community2"],
      "priority": 1-10
    }
  ],
  "insights": {
    "topOpportunity": "summary of the best opportunity",
    "marketGaps": ["gap1", "gap2"],
    "competitiveAdvantages": ["advantage1"],
    "recommendations": ["rec1", "rec2"]
  },
  "methodology": "explanation of scoring approach",
  "warnings": ["any caveats or limitations"]
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

function validateScoreBreakdown(score) {
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

function defaultScore() {
  return { volume: 5, intensity: 5, commercialIntent: 5, clarity: 5, uniqueness: 5, total: 5 };
}

function emptyOutput(warning) {
  return {
    rankedCommunities: [],
    rankedAngles: [],
    insights: { topOpportunity: '', marketGaps: [], competitiveAdvantages: [], recommendations: [] },
    methodology: 'Standard scoring',
    warnings: warning ? [warning] : [],
  };
}

function validateOutput(raw) {
  if (!raw || typeof raw !== 'object') return emptyOutput('Output was not an object');
  const warnings = [];

  // Communities
  const validatedCommunities = [];
  if (Array.isArray(raw.rankedCommunities)) {
    for (let i = 0; i < raw.rankedCommunities.length; i++) {
      const c = raw.rankedCommunities[i];
      if (!c || typeof c !== 'object') {
        warnings.push(`Community ${i} is not an object, skipping`);
        continue;
      }
      if (typeof c.community !== 'string' || c.community.length === 0) {
        warnings.push(`Community ${i} missing name, skipping`);
        continue;
      }
      const score = validateScoreBreakdown(c.score);
      if (!score) warnings.push(`Community ${i} has invalid score, using defaults`);
      const platform = VALID_PLATFORMS.includes(c.platform) ? c.platform : 'other';
      validatedCommunities.push({
        community: c.community,
        platform,
        score: score ?? defaultScore(),
        rationale: typeof c.rationale === 'string' ? c.rationale : '',
        themes: Array.isArray(c.themes) ? c.themes.filter((t) => typeof t === 'string') : [],
        focusAreas: Array.isArray(c.focusAreas) ? c.focusAreas.filter((f) => typeof f === 'string') : [],
        risks: Array.isArray(c.risks) ? c.risks.filter((r) => typeof r === 'string') : [],
      });
    }
  } else {
    warnings.push('Output missing rankedCommunities array');
  }
  validatedCommunities.sort((a, b) => b.score.total - a.score.total);

  // Angles
  const validatedAngles = [];
  if (Array.isArray(raw.rankedAngles)) {
    for (let i = 0; i < raw.rankedAngles.length; i++) {
      const a = raw.rankedAngles[i];
      if (!a || typeof a !== 'object') {
        warnings.push(`Angle ${i} is not an object, skipping`);
        continue;
      }
      if (typeof a.angleName !== 'string' || a.angleName.length === 0) {
        warnings.push(`Angle ${i} missing name, skipping`);
        continue;
      }
      const score = validateScoreBreakdown(a.score);
      if (!score) warnings.push(`Angle ${i} has invalid score, using defaults`);
      const segment = VALID_INTENT_STAGES.includes(a.segment) ? a.segment : 'researching';
      const priority = typeof a.priority === 'number'
        ? Math.max(1, Math.min(10, Math.round(a.priority)))
        : i + 1;
      validatedAngles.push({
        angleId: typeof a.angleId === 'string' ? a.angleId : `angle-${i + 1}`,
        angleName: a.angleName,
        segment,
        corePain: typeof a.corePain === 'string' ? a.corePain : '',
        promise: typeof a.promise === 'string' ? a.promise : '',
        score: score ?? defaultScore(),
        evidence: Array.isArray(a.evidence) ? a.evidence.filter((e) => typeof e === 'string') : [],
        rationale: typeof a.rationale === 'string' ? a.rationale : '',
        communities: Array.isArray(a.communities) ? a.communities.filter((c) => typeof c === 'string') : [],
        priority,
      });
    }
  } else {
    warnings.push('Output missing rankedAngles array');
  }
  validatedAngles.sort((a, b) => a.priority - b.priority);

  // Insights
  const ins = raw.insights ?? {};
  const insights = {
    topOpportunity: typeof ins.topOpportunity === 'string' ? ins.topOpportunity : '',
    marketGaps: Array.isArray(ins.marketGaps) ? ins.marketGaps.filter((g) => typeof g === 'string') : [],
    competitiveAdvantages: Array.isArray(ins.competitiveAdvantages) ? ins.competitiveAdvantages.filter((a) => typeof a === 'string') : [],
    recommendations: Array.isArray(ins.recommendations) ? ins.recommendations.filter((r) => typeof r === 'string') : [],
  };

  const upstreamWarnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w) => typeof w === 'string')
    : [];

  return {
    rankedCommunities: validatedCommunities,
    rankedAngles: validatedAngles,
    insights,
    methodology: typeof raw.methodology === 'string' ? raw.methodology : 'Standard scoring',
    warnings: [...upstreamWarnings, ...warnings],
  };
}

export async function opportunityScoring(ctx) {
  ensureCallAI(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const vocRecords = Array.isArray(inputs.vocRecords) ? inputs.vocRecords : [];
  const communities = Array.isArray(inputs.communities) ? inputs.communities : [];
  if (vocRecords.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.vocRecords must contain at least one record', retryable: false } };
  }
  if (communities.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.communities must contain at least one community', retryable: false } };
  }
  if (!inputs.icpContext || typeof inputs.icpContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.icpContext is required', retryable: false } };
  }
  if (!inputs.productContext || typeof inputs.productContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.productContext is required', retryable: false } };
  }

  log.debug('Scoring opportunities', {
    vocCount: vocRecords.length,
    communityCount: communities.length,
    maxOpportunities: inputs.maxOpportunities ?? 10,
  });

  let aiResult;
  try {
    aiResult = await ctx.callAI({
      provider: config.provider,
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(inputs) }],
      temperature: config.temperature ?? 0.3,
      maxTokens: config.maxTokens ?? 6000,
    });
  } catch (err) {
    log.error('AI opportunity scoring failed', { error: String(err?.message ?? err) });
    return { status: 'error', error: { code: 'OPPORTUNITY_SCORING_FAILED', message: String(err?.message ?? err), retryable: true } };
  }

  const parsed = parseJSONFromAI(aiResult?.content);
  if (!parsed) {
    log.warn('AI response could not be parsed as JSON, returning empty results');
    return {
      status: 'success',
      outputs: {
        ...emptyOutput('AI response could not be parsed as JSON'),
        communityCount: 0,
        angleCount: 0,
        model: aiResult?.model,
        usage: aiResult?.usage,
        success: true,
      },
    };
  }

  const validated = validateOutput(parsed);

  log.info('Opportunity scoring completed', {
    communities: validated.rankedCommunities.length,
    angles: validated.rankedAngles.length,
    warnings: validated.warnings.length,
  });

  return {
    status: 'success',
    outputs: {
      rankedCommunities: validated.rankedCommunities,
      rankedAngles: validated.rankedAngles,
      insights: validated.insights,
      methodology: validated.methodology,
      warnings: validated.warnings,
      communityCount: validated.rankedCommunities.length,
      angleCount: validated.rankedAngles.length,
      model: aiResult?.model,
      usage: aiResult?.usage,
      success: true,
    },
  };
}

const nodes = {
  'market-intel.opportunity-scoring': opportunityScoring,
};

export default nodes;
