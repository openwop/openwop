/**
 * vendor.myndhyve.market-intel-community-rank
 *
 * Single typeId: `market-intel.community-rank`
 *
 * Lifted from src/core/market-intel/prompts/communityDiscovery.ts (513 LOC TS).
 * Takes a list of candidate communities (from a discovery step or connector)
 * and ranks them by VoC research relevance — assigns a relevance score,
 * signal quality, ICP problem alignment, expected intent stages, search
 * strategy, and risk factors per community.
 *
 * Distinct from `market-intel.ai-discovery` (which generates NEW community
 * suggestions from a topic): this pack ranks EXISTING candidates.
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

const VALID_PLATFORMS = ['reddit', 'hackernews', 'stackexchange', 'forum', 'reviews', 'other'];
const VALID_SIGNAL_QUALITIES = ['high', 'medium', 'low'];

const SYSTEM_PROMPT = `You are a market research community analyst. Your task is to evaluate, rank, and select online communities most likely to contain authentic Voice of Customer (VoC) conversations relevant to a specific product and ICP.

## Core Principles

1. **Signal Over Noise**: Prioritize communities where real users discuss genuine problems, not marketing-heavy or bot-filled spaces.
2. **ICP Alignment**: Communities must contain your target audience — not just your topic.
3. **Intent Diversity**: Select communities that cover different buyer intent stages for comprehensive research.
4. **Platform Diversity**: Include communities from different platforms to avoid single-source bias.

## Evaluation Criteria

### High-Signal Communities (Score 0.7-1.0)
- Active discussions about ICP problems and outcomes
- Natural language, authentic experiences
- Mix of questions, complaints, recommendations
- Technical depth appropriate to ICP sophistication
- Recent activity (not dead communities)

### Medium-Signal Communities (Score 0.4-0.7)
- Related topic but not perfectly ICP-aligned
- Some relevant discussions mixed with noise
- Decent activity but may lack depth
- Good for supplementary research

### Low-Signal Communities (Score 0.0-0.4)
- Tangentially related at best
- Dominated by marketing/promotional content
- Low activity or stale discussions
- Too broad or too niche for the ICP

## Risk Factors to Watch
- **Bot Activity**: Communities with template responses, affiliate links, or suspicious patterns
- **Echo Chambers**: Communities where one viewpoint dominates, missing the full picture
- **Scale Mismatch**: Enterprise ICP in a small-business community (or vice versa)
- **Geographic Mismatch**: US-focused ICP in a non-English community
- **Outdated Content**: Communities that peaked years ago

## Reddit-Specific Evaluation

When evaluating Reddit communities (subreddits):
- **Niche > Mega**: Subreddits with 5K-200K subscribers often have better signal-to-noise than 1M+ communities
- **Flair Requirements**: Subreddits enforcing post flair have more structured, categorized discussions
- **Self-Post Communities**: Subreddits focused on text/self-posts yield better VoC than link-sharing communities
- **Role Subreddits**: r/[role] communities (e.g., r/sysadmin, r/sales) contain authentic professional experiences
- **Red Flags**: 1M+ subscriber subreddits are often noisy; meme-heavy communities have low signal quality

## Output Requirements
1. Rank all candidates by final relevance score
2. Select the top N communities (respecting the max)
3. For each selected community, explain WHY it was selected and HOW to search it
4. For rejected communities, explain WHY they were rejected
5. Ensure platform diversity in the selection`;

function buildUserPrompt(inputs) {
  const maxCommunities = inputs.maxCommunities ?? 10;
  const minRelevance = inputs.minRelevance ?? 0.3;
  const preferredPlatforms = Array.isArray(inputs.preferredPlatforms) && inputs.preferredPlatforms.length > 0
    ? inputs.preferredPlatforms.join(', ')
    : 'no preference';
  const candidateCommunities = Array.isArray(inputs.candidateCommunities) ? inputs.candidateCommunities : [];
  const icp = inputs.icpContext ?? {};
  const prod = inputs.productContext ?? {};
  const arr = (xs) => (Array.isArray(xs) ? xs : []);

  const candidateList = candidateCommunities.map((c, i) => {
    const memberStr = typeof c?.memberCount === 'number' ? c.memberCount.toLocaleString() : 'unknown';
    const initialScore = Number(c?.initialRelevanceScore);
    const scoreStr = Number.isFinite(initialScore) ? initialScore.toFixed(2) : '?';
    return `${i + 1}. **${c?.name ?? '(no name)'}** (${c?.platform ?? '?'})
   - URL: ${c?.url ?? ''}
   - Members: ${memberStr}
   - Activity: ${c?.activityLevel ?? 'unknown'}
   - Initial Score: ${scoreStr}
   - Initial Rationale: ${c?.initialRationale ?? ''}`;
  }).join('\n\n');

  return `## Task
Evaluate and rank the following ${candidateCommunities.length} candidate communities for VoC research relevance.

## ICP Context
- **Roles**: ${arr(icp.roles).join(', ')}
- **Industry**: ${icp.industry ?? 'Not specified'}
- **Problems**: ${arr(icp.problems).join('; ')}
- **Desired Outcomes**: ${arr(icp.outcomes).join('; ')}

## Product Context
- **Product**: ${prod.name ?? 'Not specified'}
- **Category**: ${prod.category ?? 'Not specified'}
- **Differentiators**: ${arr(prod.differentiators).join('; ')}

## Selection Criteria
- **Max communities to select**: ${maxCommunities}
- **Minimum relevance score**: ${minRelevance}
- **Preferred platforms**: ${preferredPlatforms}

## Candidate Communities

${candidateList}

## Instructions
1. Evaluate each candidate against the ICP and product context
2. Assign a final relevance score (0-1) based on signal quality, ICP alignment, and activity
3. Select the top ${maxCommunities} communities (above ${minRelevance} score)
4. For each selected community:
   - Identify which ICP problems it likely discusses
   - Predict dominant intent stages
   - Recommend a search strategy
   - Note any risk factors
5. For rejected communities, explain why
6. Ensure platform diversity in the selection

## Required Output Format
Respond with valid JSON matching this structure:
\`\`\`json
{
  "selectedCommunities": [
    {
      "id": "community-id",
      "name": "community name",
      "platform": "reddit|stackexchange|hackernews|forum|reviews|other",
      "url": "https://...",
      "relevanceScore": 0.85,
      "signalQuality": "high|medium|low",
      "relevantProblems": ["problem 1", "problem 2"],
      "expectedIntentStages": ["researching", "problem_aware"],
      "rankingRationale": "why this community is ranked here",
      "searchStrategy": "how to search this community effectively",
      "riskFactors": ["risk 1"]
    }
  ],
  "rejectedCommunities": [
    { "id": "...", "name": "...", "reason": "..." }
  ],
  "platformCoverage": [
    { "platform": "reddit", "communityCount": 3, "avgRelevance": 0.75 }
  ],
  "summary": {
    "totalCandidates": ${candidateCommunities.length},
    "totalSelected": n,
    "avgRelevanceScore": 0.72,
    "topPlatform": "reddit"
  },
  "warnings": ["..."]
}
\`\`\``;
}

function parseJSONFromAI(content) {
  const cleaned = String(content ?? '').replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function stringArr(xs) {
  return Array.isArray(xs) ? xs.filter((x) => typeof x === 'string' && x.length > 0) : [];
}

function validateSelectedCommunity(c) {
  if (!c || typeof c !== 'object') return null;
  if (typeof c.id !== 'string' || c.id.length === 0) return null;
  if (typeof c.name !== 'string' || c.name.length === 0) return null;

  const platform = VALID_PLATFORMS.includes(c.platform) ? c.platform : 'other';
  const signalQuality = VALID_SIGNAL_QUALITIES.includes(c.signalQuality) ? c.signalQuality : 'medium';
  const relevanceScore = typeof c.relevanceScore === 'number' && Number.isFinite(c.relevanceScore)
    ? Math.max(0, Math.min(1, c.relevanceScore))
    : 0.5;

  return {
    id: c.id,
    name: c.name,
    platform,
    url: typeof c.url === 'string' ? c.url : '',
    relevanceScore,
    signalQuality,
    relevantProblems: stringArr(c.relevantProblems),
    expectedIntentStages: stringArr(c.expectedIntentStages),
    rankingRationale: typeof c.rankingRationale === 'string' ? c.rankingRationale : '',
    searchStrategy: typeof c.searchStrategy === 'string' ? c.searchStrategy : '',
    riskFactors: stringArr(c.riskFactors),
  };
}

function validateRejectedCommunity(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || r.id.length === 0) return null;
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : 'Unknown',
    reason: typeof r.reason === 'string' ? r.reason : 'No reason given',
  };
}

function emptyOutput(warning) {
  return {
    selectedCommunities: [],
    rejectedCommunities: [],
    platformCoverage: [],
    summary: {
      totalCandidates: 0,
      totalSelected: 0,
      avgRelevanceScore: 0,
      topPlatform: 'other',
    },
    warnings: warning ? [warning] : [],
  };
}

function validateOutput(raw, candidateCount) {
  if (!raw || typeof raw !== 'object') return emptyOutput('Output was not an object');
  const warnings = [];

  const selectedCommunities = [];
  if (Array.isArray(raw.selectedCommunities)) {
    for (let i = 0; i < raw.selectedCommunities.length; i++) {
      const v = validateSelectedCommunity(raw.selectedCommunities[i]);
      if (v) selectedCommunities.push(v);
      else warnings.push(`Selected community ${i} invalid (missing id or name), skipping`);
    }
  } else {
    warnings.push('Output missing selectedCommunities array');
  }
  // Sort selected by relevanceScore descending
  selectedCommunities.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const rejectedCommunities = [];
  if (Array.isArray(raw.rejectedCommunities)) {
    for (const r of raw.rejectedCommunities) {
      const v = validateRejectedCommunity(r);
      if (v) rejectedCommunities.push(v);
    }
  }

  // Compute platformCoverage from validated selected communities (don't trust AI's claim).
  const byPlatform = new Map();
  for (const c of selectedCommunities) {
    if (!byPlatform.has(c.platform)) byPlatform.set(c.platform, []);
    byPlatform.get(c.platform).push(c.relevanceScore);
  }
  const platformCoverage = [];
  for (const [platform, scores] of byPlatform) {
    const sum = scores.reduce((s, x) => s + x, 0);
    const avg = scores.length > 0 ? sum / scores.length : 0;
    platformCoverage.push({
      platform,
      communityCount: scores.length,
      avgRelevance: Math.round(avg * 10000) / 10000,
    });
  }
  platformCoverage.sort((a, b) => b.communityCount - a.communityCount || b.avgRelevance - a.avgRelevance);

  // Rebuild summary from validated data.
  const avgScore = selectedCommunities.length > 0
    ? selectedCommunities.reduce((s, c) => s + c.relevanceScore, 0) / selectedCommunities.length
    : 0;
  const topPlatform = platformCoverage.length > 0 ? platformCoverage[0].platform : 'other';
  const summary = {
    totalCandidates: candidateCount,
    totalSelected: selectedCommunities.length,
    avgRelevanceScore: Math.round(avgScore * 10000) / 10000,
    topPlatform,
  };

  const upstreamWarnings = stringArr(raw.warnings);
  return {
    selectedCommunities,
    rejectedCommunities,
    platformCoverage,
    summary,
    warnings: [...upstreamWarnings, ...warnings],
  };
}

export async function communityRank(ctx) {
  ensureCallAI(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const candidateCommunities = Array.isArray(inputs.candidateCommunities) ? inputs.candidateCommunities : [];
  if (candidateCommunities.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.candidateCommunities must contain at least one community', retryable: false } };
  }
  if (!inputs.icpContext || typeof inputs.icpContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.icpContext is required', retryable: false } };
  }
  if (!inputs.productContext || typeof inputs.productContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.productContext is required', retryable: false } };
  }

  log.debug('Ranking candidate communities', {
    candidates: candidateCommunities.length,
    maxCommunities: inputs.maxCommunities ?? 10,
    minRelevance: inputs.minRelevance ?? 0.3,
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
    log.error('AI community ranking failed', { error: String(err?.message ?? err) });
    return { status: 'error', error: { code: 'COMMUNITY_RANK_FAILED', message: String(err?.message ?? err), retryable: true } };
  }

  const parsed = parseJSONFromAI(aiResult?.content);
  if (!parsed) {
    log.warn('AI response could not be parsed as JSON, returning empty selection');
    return {
      status: 'success',
      outputs: {
        ...emptyOutput('AI response could not be parsed as JSON'),
        selectedCount: 0,
        model: aiResult?.model,
        usage: aiResult?.usage,
        success: true,
      },
    };
  }

  const validated = validateOutput(parsed, candidateCommunities.length);

  log.info('Community ranking completed', {
    selected: validated.selectedCommunities.length,
    rejected: validated.rejectedCommunities.length,
    topPlatform: validated.summary.topPlatform,
    warnings: validated.warnings.length,
  });

  return {
    status: 'success',
    outputs: {
      selectedCommunities: validated.selectedCommunities,
      rejectedCommunities: validated.rejectedCommunities,
      platformCoverage: validated.platformCoverage,
      summary: validated.summary,
      warnings: validated.warnings,
      selectedCount: validated.selectedCommunities.length,
      model: aiResult?.model,
      usage: aiResult?.usage,
      success: true,
    },
  };
}

const nodes = {
  'market-intel.community-rank': communityRank,
};

export default nodes;
