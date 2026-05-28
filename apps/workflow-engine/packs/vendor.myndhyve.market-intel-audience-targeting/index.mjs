/**
 * vendor.myndhyve.market-intel-audience-targeting
 *
 * Single typeId: `market-intel.audience-targeting`
 *
 * Lifted from src/core/market-intel/prompts/audienceTargeting.ts (855 LOC TS).
 * Builds per-platform targeting packs (interests + keywords + community
 * placements + audience definitions) for 6 ad platforms, plus cross-platform
 * insights, testing sequence, and budget allocation.
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

const VALID_AD_PLATFORMS = ['meta', 'google', 'linkedin', 'tiktok', 'reddit', 'x'];
const VALID_AUDIENCE_SIZES = ['small', 'medium', 'large'];
const VALID_MATCH_TYPES = ['broad', 'phrase', 'exact'];
const VALID_VOLUME_LEVELS = ['low', 'medium', 'high'];
const VALID_AUDIENCE_TYPES = ['lookalike', 'custom', 'retargeting', 'seed'];

const SYSTEM_PROMPT = `You are an expert paid media strategist with deep knowledge of audience targeting across all major ad platforms. Your task is to generate actionable targeting recommendations based on market research data.

## Core Principles

1. **Community-Aligned**: Targeting should map back to validated communities where VoC was found.
2. **Angle-Aligned**: Each targeting suggestion should align with specific messaging angles.
3. **Platform-Native**: Use platform-specific targeting features and naming conventions.
4. **Testable**: Recommendations should be specific enough to implement immediately.

## Platform Targeting Capabilities

### Meta (Facebook/Instagram)
- Interests: Job titles, industries, behaviors, company size
- Custom Audiences: Website visitors, engagement, customer lists
- Lookalike Audiences: Based on best customers or high-intent visitors
- Detailed Targeting: AND/OR combinations

### Google
- Keywords: Search terms with match types
- Audiences: In-market, affinity, custom intent
- Topics: Contextual placement
- Remarketing: Website visitors, video viewers, app users

### LinkedIn
- Job Titles, Functions, Seniority
- Company: Size, industry, name, followers
- Skills, Groups, Interests
- Matched Audiences: Account lists, contact lists

### TikTok
- Interests, Behaviors
- Hashtags, Creator categories
- Custom Audiences: Pixel, engagement, customer file
- Lookalike Audiences

### Reddit
- **Subreddit Targeting**: Place ads directly in specific subreddits (use r/name format)
  - Niche subreddits (10K-500K members) typically outperform broad ones
  - Target subreddits where VoC was found for highest relevance
- **Interest Targeting**: Reddit-inferred interest categories based on browsing behavior
- **Community Groups**: Reddit groups related subreddits into targetable clusters
- **Keyword Targeting**: Target posts/comments containing specific keywords
- **Notes**: Reddit audiences are tech-savvy and skeptical of overt marketing; native, value-first promoted posts perform best

### Twitter (X)
- Keywords: Tweet keywords, conversation topics
- Interests, Events
- Follower lookalikes
- Custom audiences

## Targeting Strategy Best Practices

1. **Start Narrow, Scale Broad**: Begin with high-intent, specific targeting
2. **Layer Targeting**: Combine interests + demographics + behaviors
3. **Exclusions Matter**: Remove existing customers, competitors' employees
4. **Platform Strengths**: Use each platform for what it does best
5. **Creative-Targeting Fit**: Match ad creative to audience expectations

## Output Requirements

1. Generate targeting for each requested platform
2. Include at least 5 interest targets per platform
3. Include at least 10 keywords for Google/search platforms
4. Map each target to specific angles
5. Provide testing sequence and budget allocation`;

function buildUserPrompt(inputs) {
  const communities = Array.isArray(inputs.communities) ? inputs.communities : [];
  const angles = Array.isArray(inputs.angles) ? inputs.angles : [];
  const icp = inputs.icpContext ?? {};
  const prod = inputs.productContext ?? {};
  const competitors = Array.isArray(inputs.competitors) ? inputs.competitors : [];
  const targetPlatforms = Array.isArray(inputs.targetPlatforms) ? inputs.targetPlatforms : [];
  const arr = (xs) => (Array.isArray(xs) ? xs : []);

  const communitySummary = communities.slice(0, 10).map((c) =>
    `- **${c?.name ?? '?'}** (${c?.platform ?? 'other'}, score: ${c?.score ?? '?'}): ${arr(c?.themes).join(', ')} [${c?.dominantIntent ?? '?'}]`
  ).join('\n');

  const anglesSummary = angles.slice(0, 8).map((a) =>
    `- **${a?.angleName ?? '?'}** (${a?.segment ?? '?'}): ${a?.corePain ?? ''} [themes: ${arr(a?.themes).join(', ')}]`
  ).join('\n');

  return `## Task
Generate audience targeting recommendations for the following ad platforms: ${targetPlatforms.join(', ')}.

## ICP Context
- **Roles**: ${arr(icp.roles).join(', ')}
- **Industry**: ${icp.industry ?? 'Not specified'}
${icp.companySize ? `- **Company Size**: ${icp.companySize}` : ''}
${arr(icp.seniority).length ? `- **Seniority**: ${arr(icp.seniority).join(', ')}` : ''}
${arr(icp.geography).length ? `- **Geography**: ${arr(icp.geography).join(', ')}` : ''}

## Product Context
- **Product**: ${prod.name ?? 'Not specified'}
- **Category**: ${prod.category ?? 'Not specified'}
- **Keywords**: ${arr(prod.keywords).join(', ')}

${competitors.length > 0 ? `## Competitors (for exclusion)\n${competitors.join(', ')}\n` : ''}

## Top Communities (${communities.length} total)
${communitySummary || '- (none provided)'}

## Top Angles (${angles.length} total)
${anglesSummary || '- (none provided)'}

## Instructions
1. For each platform in [${targetPlatforms.join(', ')}]:
   - Generate interest targets aligned with communities and angles
   - Generate keyword targets (for applicable platforms)
   - Suggest community/placement targets
   - Recommend audience building strategies

2. Provide cross-platform insights:
   - Primary audience definition
   - Secondary audiences
   - Exclusion recommendations
   - Scaling path as you gather data

3. Recommend testing sequence (which platform/targeting first)

4. Suggest budget allocation percentages

## Required Output Format
Respond with valid JSON matching this structure:
\`\`\`json
{
  "platformPacks": [
    {
      "platform": "meta|google|linkedin|tiktok|reddit|x",
      "interests": [{ "interest": "...", "platform": "...", "category": "...", "rationale": "...", "audienceSize": "small|medium|large", "alignedAngles": ["..."] }],
      "keywords": [{ "keyword": "...", "platform": "...", "matchType": "broad|phrase|exact", "volumeEstimate": "low|medium|high", "intent": "low|medium|high", "related": ["..."] }],
      "communities": [{ "community": "...", "platform": "...", "rationale": "...", "estimatedReach": "small|medium|large", "recommendedAngles": ["..."], "contentRecommendations": ["..."] }],
      "audiences": [{ "type": "lookalike|custom|retargeting|seed", "name": "...", "platform": "...", "source": "...", "configuration": "...", "useCases": ["..."] }],
      "notes": ["..."]
    }
  ],
  "crossPlatformInsights": {
    "primaryAudience": "...",
    "secondaryAudiences": ["..."],
    "exclusionRecommendations": ["..."],
    "scalingPath": ["..."]
  },
  "testingSequence": [{ "phase": 1, "platform": "meta", "targetingType": "...", "rationale": "..." }],
  "budgetAllocation": [{ "platform": "meta", "percentage": 50, "rationale": "..." }],
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

function pickEnum(value, validList, fallback) {
  return validList.includes(value) ? value : fallback;
}

function stringArr(xs) {
  return Array.isArray(xs) ? xs.filter((x) => typeof x === 'string' && x.length > 0) : [];
}

function validateInterest(t) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.interest !== 'string' || t.interest.length === 0) return null;
  return {
    interest: t.interest,
    platform: pickEnum(t.platform, VALID_AD_PLATFORMS, 'meta'),
    category: typeof t.category === 'string' ? t.category : 'General',
    rationale: typeof t.rationale === 'string' ? t.rationale : '',
    audienceSize: pickEnum(t.audienceSize, VALID_AUDIENCE_SIZES, 'medium'),
    alignedAngles: stringArr(t.alignedAngles),
  };
}

function validateKeyword(t) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.keyword !== 'string' || t.keyword.length === 0) return null;
  return {
    keyword: t.keyword,
    platform: pickEnum(t.platform, VALID_AD_PLATFORMS, 'google'),
    matchType: pickEnum(t.matchType, VALID_MATCH_TYPES, 'broad'),
    volumeEstimate: pickEnum(t.volumeEstimate, VALID_VOLUME_LEVELS, 'medium'),
    intent: pickEnum(t.intent, VALID_VOLUME_LEVELS, 'medium'),
    related: stringArr(t.related),
  };
}

function validateCommunityTarget(t) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.community !== 'string' || t.community.length === 0) return null;
  return {
    community: t.community,
    platform: pickEnum(t.platform, VALID_AD_PLATFORMS, 'reddit'),
    rationale: typeof t.rationale === 'string' ? t.rationale : '',
    estimatedReach: pickEnum(t.estimatedReach, VALID_AUDIENCE_SIZES, 'medium'),
    recommendedAngles: stringArr(t.recommendedAngles),
    contentRecommendations: stringArr(t.contentRecommendations),
  };
}

function validateAudience(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.name !== 'string' || s.name.length === 0) return null;
  return {
    type: pickEnum(s.type, VALID_AUDIENCE_TYPES, 'custom'),
    name: s.name,
    platform: pickEnum(s.platform, VALID_AD_PLATFORMS, 'meta'),
    source: typeof s.source === 'string' ? s.source : '',
    configuration: typeof s.configuration === 'string' ? s.configuration : '',
    useCases: stringArr(s.useCases),
  };
}

function emptyOutput(warning) {
  return {
    platformPacks: [],
    crossPlatformInsights: {
      primaryAudience: '',
      secondaryAudiences: [],
      exclusionRecommendations: [],
      scalingPath: [],
    },
    testingSequence: [],
    budgetAllocation: [],
    warnings: warning ? [warning] : [],
  };
}

function validateOutput(raw) {
  if (!raw || typeof raw !== 'object') return emptyOutput('Output was not an object');
  const warnings = [];

  const validatedPacks = [];
  if (Array.isArray(raw.platformPacks)) {
    for (let i = 0; i < raw.platformPacks.length; i++) {
      const p = raw.platformPacks[i];
      if (!p || typeof p !== 'object') {
        warnings.push(`Platform pack ${i} is not an object, skipping`);
        continue;
      }
      if (!VALID_AD_PLATFORMS.includes(p.platform)) {
        warnings.push(`Platform pack ${i} has invalid platform "${p.platform}", skipping`);
        continue;
      }

      const interests = [];
      if (Array.isArray(p.interests)) {
        for (const interest of p.interests) {
          const v = validateInterest(interest);
          if (v) interests.push(v);
        }
      }

      const keywords = [];
      if (Array.isArray(p.keywords)) {
        for (const kw of p.keywords) {
          const v = validateKeyword(kw);
          if (v) keywords.push(v);
        }
      }

      const communityTargets = [];
      if (Array.isArray(p.communities)) {
        for (const c of p.communities) {
          const v = validateCommunityTarget(c);
          if (v) communityTargets.push(v);
        }
      }

      const audiences = [];
      if (Array.isArray(p.audiences)) {
        for (const a of p.audiences) {
          const v = validateAudience(a);
          if (v) audiences.push(v);
        }
      }

      validatedPacks.push({
        platform: p.platform,
        interests,
        keywords,
        communities: communityTargets,
        audiences,
        notes: stringArr(p.notes),
      });
    }
  } else {
    warnings.push('Output missing platformPacks array');
  }

  const cp = raw.crossPlatformInsights ?? {};
  const crossPlatformInsights = {
    primaryAudience: typeof cp.primaryAudience === 'string' ? cp.primaryAudience : '',
    secondaryAudiences: stringArr(cp.secondaryAudiences),
    exclusionRecommendations: stringArr(cp.exclusionRecommendations),
    scalingPath: stringArr(cp.scalingPath),
  };

  const testingSequence = [];
  if (Array.isArray(raw.testingSequence)) {
    for (const ts of raw.testingSequence) {
      if (!ts || typeof ts !== 'object') continue;
      const phase = Number.isFinite(Number(ts.phase)) ? Math.max(1, Math.round(Number(ts.phase))) : testingSequence.length + 1;
      if (!VALID_AD_PLATFORMS.includes(ts.platform)) continue;
      testingSequence.push({
        phase,
        platform: ts.platform,
        targetingType: typeof ts.targetingType === 'string' ? ts.targetingType : '',
        rationale: typeof ts.rationale === 'string' ? ts.rationale : '',
      });
    }
  }
  testingSequence.sort((a, b) => a.phase - b.phase);

  const budgetAllocation = [];
  if (Array.isArray(raw.budgetAllocation)) {
    for (const ba of raw.budgetAllocation) {
      if (!ba || typeof ba !== 'object') continue;
      if (!VALID_AD_PLATFORMS.includes(ba.platform)) continue;
      const pct = Number(ba.percentage);
      if (!Number.isFinite(pct)) continue;
      budgetAllocation.push({
        platform: ba.platform,
        percentage: Math.max(0, Math.min(100, pct)),
        rationale: typeof ba.rationale === 'string' ? ba.rationale : '',
      });
    }
  }

  const upstreamWarnings = stringArr(raw.warnings);
  return {
    platformPacks: validatedPacks,
    crossPlatformInsights,
    testingSequence,
    budgetAllocation,
    warnings: [...upstreamWarnings, ...warnings],
  };
}

export async function audienceTargeting(ctx) {
  ensureCallAI(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const targetPlatforms = Array.isArray(inputs.targetPlatforms) ? inputs.targetPlatforms : [];
  if (targetPlatforms.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.targetPlatforms must contain at least one platform', retryable: false } };
  }
  const invalidPlatforms = targetPlatforms.filter((p) => !VALID_AD_PLATFORMS.includes(p));
  if (invalidPlatforms.length > 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: `inputs.targetPlatforms contains unsupported platforms: ${invalidPlatforms.join(', ')}. Supported: ${VALID_AD_PLATFORMS.join(', ')}`, retryable: false } };
  }
  if (!inputs.icpContext || typeof inputs.icpContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.icpContext is required', retryable: false } };
  }
  if (!inputs.productContext || typeof inputs.productContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.productContext is required', retryable: false } };
  }

  log.debug('Generating audience targeting', {
    platforms: targetPlatforms,
    communityCount: Array.isArray(inputs.communities) ? inputs.communities.length : 0,
    angleCount: Array.isArray(inputs.angles) ? inputs.angles.length : 0,
  });

  let aiResult;
  try {
    aiResult = await ctx.callAI({
      provider: config.provider,
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(inputs) }],
      temperature: config.temperature ?? 0.4,
      maxTokens: config.maxTokens ?? 8000,
    });
  } catch (err) {
    log.error('AI audience targeting failed', { error: String(err?.message ?? err) });
    return { status: 'error', error: { code: 'AUDIENCE_TARGETING_FAILED', message: String(err?.message ?? err), retryable: true } };
  }

  const parsed = parseJSONFromAI(aiResult?.content);
  if (!parsed) {
    log.warn('AI response could not be parsed as JSON, returning empty packs');
    return {
      status: 'success',
      outputs: {
        ...emptyOutput('AI response could not be parsed as JSON'),
        platformCount: 0,
        model: aiResult?.model,
        usage: aiResult?.usage,
        success: true,
      },
    };
  }

  const validated = validateOutput(parsed);

  log.info('Audience targeting completed', {
    platforms: validated.platformPacks.length,
    testingPhases: validated.testingSequence.length,
    warnings: validated.warnings.length,
  });

  return {
    status: 'success',
    outputs: {
      platformPacks: validated.platformPacks,
      crossPlatformInsights: validated.crossPlatformInsights,
      testingSequence: validated.testingSequence,
      budgetAllocation: validated.budgetAllocation,
      warnings: validated.warnings,
      platformCount: validated.platformPacks.length,
      model: aiResult?.model,
      usage: aiResult?.usage,
      success: true,
    },
  };
}

const nodes = {
  'market-intel.audience-targeting': audienceTargeting,
};

export default nodes;
