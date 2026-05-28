/**
 * vendor.myndhyve.market-intel-query-builder
 *
 * Single typeId: `market-intel.query-builder`
 *
 * Lifted from src/core/market-intel/prompts/queryBuilder.ts (547 LOC TS).
 * Generates intent-mapped search queries (4-8 query groups per intent stage)
 * + per-competitor query packs + topic clusters from ICP + product context.
 *
 * Use case: seeds the search step of the marketIntel pipeline. Outputs
 * search-engine-ready queries grouped by intent stage AND by competitor.
 * Pairs with ai-discovery (which produces target sources) — query-builder
 * gives you "what to search for" while ai-discovery gives you "where to search".
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
const VALID_SIGNAL_STRENGTHS = ['high', 'medium', 'low'];

const SYSTEM_PROMPT = `You are a market research query specialist. Your task is to generate search queries that will uncover high-signal conversations from target communities.

## Core Principles

1. **Intent-Aligned Queries**: Different queries surface different buyer stages. Map queries to intent.
2. **Specificity Over Breadth**: Specific queries find niche conversations; broad queries find noise.
3. **Natural Language**: Use phrases real people type, not marketing jargon.
4. **Platform Awareness**: Reddit queries differ from Stack Exchange or HN queries.

## Intent Stage Query Strategies

### ready_now (High Commercial Intent)
- "best [category] for [use case]"
- "[product type] recommendations"
- "[competitor] vs [competitor]"
- "looking for [solution type]"
- "need help choosing [category]"

### researching (Active Evaluation)
- "how to [solve problem]"
- "[problem] solutions"
- "anyone use [category] tools"
- "experience with [approach]"
- "pros cons [solution type]"

### problem_aware (Problem Discussion)
- "[pain point] frustrated"
- "[problem] driving me crazy"
- "struggling with [issue]"
- "[challenge] in [industry]"
- "why is [process] so hard"

### unaware (Adjacent Topics)
- "[outcome] tips"
- "improve [process]"
- "[role] workflow"
- "[industry] best practices"

## Competitor Query Patterns

- "[competitor] alternatives"
- "switching from [competitor]"
- "[competitor] vs [your category]"
- "unhappy with [competitor]"
- "[competitor] pricing too expensive"

## Platform-Specific Hints

- **Reddit**: Include subreddit context (r/entrepreneur, r/SaaS)
- **Stack Exchange**: Use technical terminology, problem-solution framing
- **Hacker News**: Startup/tech angle, "Show HN" awareness
- **Forums**: Industry-specific jargon, community norms

## Output Requirements

1. Generate 4-8 query groups per intent stage
2. Include 2-4 variations per primary query
3. Map synonyms for key terms
4. Rate expected signal strength
5. Add platform-specific hints where relevant`;

function buildUserPrompt(inputs) {
  const maxQueriesPerStage = inputs.maxQueriesPerStage ?? 8;
  const platforms = Array.isArray(inputs.targetPlatforms) && inputs.targetPlatforms.length > 0
    ? inputs.targetPlatforms.join(', ')
    : 'reddit, stackexchange, hn, forums';
  const icp = inputs.icpContext ?? {};
  const prod = inputs.productContext ?? {};
  const competitors = Array.isArray(inputs.competitors) ? inputs.competitors : [];
  const seedKeywords = Array.isArray(inputs.seedKeywords) ? inputs.seedKeywords : [];
  const arr = (xs) => (Array.isArray(xs) ? xs : []);

  return `## Task
Generate market research search queries to discover high-signal conversations where our ICP discusses their problems and evaluates solutions.

## ICP Context
- **Roles**: ${arr(icp.roles).join(', ')}
- **Industry**: ${icp.industry ?? 'Not specified'}
- **Problems they face**: ${arr(icp.problems).join('; ')}
- **Outcomes they want**: ${arr(icp.outcomes).join('; ')}
${icp.budgetRange ? `- **Budget range**: ${icp.budgetRange}` : ''}
${icp.stage ? `- **Company stage**: ${icp.stage}` : ''}

## Product Context
- **Product**: ${prod.name ?? 'Not specified'}
- **Category**: ${prod.category ?? 'Not specified'}
- **Differentiators**: ${arr(prod.differentiators).join('; ')}
- **Offer**: ${prod.offerSummary ?? 'Not specified'}

## Competitors
${competitors.length > 0 ? competitors.join(', ') : 'Not specified - infer from category if possible'}

## Seed Keywords
${seedKeywords.length > 0 ? seedKeywords.join(', ') : 'Generate from context'}

${inputs.geography ? `## Geography Filter\n${inputs.geography}\n` : ''}

## Target Platforms
${platforms}

## Instructions
1. Generate ${maxQueriesPerStage} query groups for each intent stage (ready_now, researching, problem_aware, unaware)
2. For each query group:
   - Write a primary query (natural language, how people actually search)
   - Add 2-4 variations with different phrasing
   - Map synonyms for key terms
   - Explain why this query targets the specified intent
   - Rate expected signal strength
   - Add platform-specific hints if relevant
3. Generate competitor-specific queries if competitors are known
4. Identify topic clusters that emerge from the queries

## Required Output Format
Respond with valid JSON matching this structure:
\`\`\`json
{
  "queryGroups": [
    {
      "intentStage": "ready_now|researching|problem_aware|unaware",
      "primaryQuery": "the main search query",
      "variations": ["variation 1", "variation 2"],
      "synonyms": { "key term": ["synonym1", "synonym2"] },
      "rationale": "why this targets the intent stage",
      "expectedSignal": "high|medium|low",
      "platformHints": { "reddit": "...", "stackexchange": "...", "hn": "..." }
    }
  ],
  "competitorQueries": [
    {
      "competitor": "competitor name",
      "comparisonQueries": ["..."],
      "switchingQueries": ["..."],
      "alternativeQueries": ["..."]
    }
  ],
  "topicClusters": [
    { "clusterName": "...", "queries": ["..."], "relatedTerms": ["..."] }
  ],
  "summary": {
    "totalQueries": number,
    "queriesByIntent": { "ready_now": n, "researching": n, "problem_aware": n, "unaware": n },
    "competitorCoverage": number
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

function validateSynonyms(syns) {
  if (!syns || typeof syns !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(syns)) {
    if (typeof k === 'string' && k.length > 0 && Array.isArray(v)) {
      const filtered = v.filter((s) => typeof s === 'string' && s.length > 0);
      if (filtered.length > 0) out[k] = filtered;
    }
  }
  return out;
}

function validatePlatformHints(hints) {
  if (!hints || typeof hints !== 'object') return undefined;
  const out = {};
  for (const platform of ['reddit', 'stackexchange', 'hn']) {
    if (typeof hints[platform] === 'string' && hints[platform].length > 0) {
      out[platform] = hints[platform];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function validateQueryGroup(g) {
  if (!g || typeof g !== 'object') return null;
  if (typeof g.primaryQuery !== 'string' || g.primaryQuery.length === 0) return null;
  const intentStage = VALID_INTENT_STAGES.includes(g.intentStage) ? g.intentStage : 'researching';
  const expectedSignal = VALID_SIGNAL_STRENGTHS.includes(g.expectedSignal) ? g.expectedSignal : 'medium';
  const result = {
    intentStage,
    primaryQuery: g.primaryQuery,
    variations: stringArr(g.variations),
    synonyms: validateSynonyms(g.synonyms),
    rationale: typeof g.rationale === 'string' ? g.rationale : '',
    expectedSignal,
  };
  const hints = validatePlatformHints(g.platformHints);
  if (hints) result.platformHints = hints;
  return result;
}

function validateCompetitorGroup(cg) {
  if (!cg || typeof cg !== 'object') return null;
  if (typeof cg.competitor !== 'string' || cg.competitor.length === 0) return null;
  return {
    competitor: cg.competitor,
    comparisonQueries: stringArr(cg.comparisonQueries),
    switchingQueries: stringArr(cg.switchingQueries),
    alternativeQueries: stringArr(cg.alternativeQueries),
  };
}

function validateTopicCluster(tc) {
  if (!tc || typeof tc !== 'object') return null;
  if (typeof tc.clusterName !== 'string' || tc.clusterName.length === 0) return null;
  return {
    clusterName: tc.clusterName,
    queries: stringArr(tc.queries),
    relatedTerms: stringArr(tc.relatedTerms),
  };
}

function emptyOutput(warning) {
  return {
    queryGroups: [],
    competitorQueries: [],
    topicClusters: [],
    summary: {
      totalQueries: 0,
      queriesByIntent: { ready_now: 0, researching: 0, problem_aware: 0, unaware: 0 },
      competitorCoverage: 0,
    },
    warnings: warning ? [warning] : [],
  };
}

function validateOutput(raw) {
  if (!raw || typeof raw !== 'object') return emptyOutput('Output was not an object');
  const warnings = [];

  const queryGroups = [];
  if (Array.isArray(raw.queryGroups)) {
    for (let i = 0; i < raw.queryGroups.length; i++) {
      const v = validateQueryGroup(raw.queryGroups[i]);
      if (v) queryGroups.push(v);
      else warnings.push(`Query group ${i} invalid (missing primaryQuery), skipping`);
    }
  } else {
    warnings.push('Output missing queryGroups array');
  }

  const competitorQueries = [];
  if (Array.isArray(raw.competitorQueries)) {
    for (let i = 0; i < raw.competitorQueries.length; i++) {
      const v = validateCompetitorGroup(raw.competitorQueries[i]);
      if (v) competitorQueries.push(v);
      else warnings.push(`Competitor group ${i} invalid (missing name), skipping`);
    }
  }

  const topicClusters = [];
  if (Array.isArray(raw.topicClusters)) {
    for (const tc of raw.topicClusters) {
      const v = validateTopicCluster(tc);
      if (v) topicClusters.push(v);
    }
  }

  // Rebuild summary from validated data; ignore AI's claimed counts.
  const queriesByIntent = { ready_now: 0, researching: 0, problem_aware: 0, unaware: 0 };
  for (const g of queryGroups) {
    queriesByIntent[g.intentStage]++;
  }
  // totalQueries = primary queries + variations + competitor queries
  let totalQueries = 0;
  for (const g of queryGroups) totalQueries += 1 + g.variations.length;
  for (const c of competitorQueries) {
    totalQueries += c.comparisonQueries.length + c.switchingQueries.length + c.alternativeQueries.length;
  }
  const summary = {
    totalQueries,
    queriesByIntent,
    competitorCoverage: competitorQueries.length,
  };

  const upstreamWarnings = stringArr(raw.warnings);
  return {
    queryGroups,
    competitorQueries,
    topicClusters,
    summary,
    warnings: [...upstreamWarnings, ...warnings],
  };
}

export async function queryBuilder(ctx) {
  ensureCallAI(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  if (!inputs.icpContext || typeof inputs.icpContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.icpContext is required', retryable: false } };
  }
  if (!inputs.productContext || typeof inputs.productContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.productContext is required', retryable: false } };
  }

  log.debug('Building search queries', {
    industry: inputs.icpContext.industry,
    competitorCount: Array.isArray(inputs.competitors) ? inputs.competitors.length : 0,
    seedKeywordCount: Array.isArray(inputs.seedKeywords) ? inputs.seedKeywords.length : 0,
  });

  let aiResult;
  try {
    aiResult = await ctx.callAI({
      provider: config.provider,
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(inputs) }],
      temperature: config.temperature ?? 0.4,
      maxTokens: config.maxTokens ?? 6000,
    });
  } catch (err) {
    log.error('AI query builder failed', { error: String(err?.message ?? err) });
    return { status: 'error', error: { code: 'QUERY_BUILDER_FAILED', message: String(err?.message ?? err), retryable: true } };
  }

  const parsed = parseJSONFromAI(aiResult?.content);
  if (!parsed) {
    log.warn('AI response could not be parsed as JSON, returning empty query set');
    return {
      status: 'success',
      outputs: {
        ...emptyOutput('AI response could not be parsed as JSON'),
        queryGroupCount: 0,
        model: aiResult?.model,
        usage: aiResult?.usage,
        success: true,
      },
    };
  }

  const validated = validateOutput(parsed);

  log.info('Query builder completed', {
    queryGroups: validated.queryGroups.length,
    competitors: validated.competitorQueries.length,
    clusters: validated.topicClusters.length,
    totalQueries: validated.summary.totalQueries,
    warnings: validated.warnings.length,
  });

  return {
    status: 'success',
    outputs: {
      queryGroups: validated.queryGroups,
      competitorQueries: validated.competitorQueries,
      topicClusters: validated.topicClusters,
      summary: validated.summary,
      warnings: validated.warnings,
      queryGroupCount: validated.queryGroups.length,
      model: aiResult?.model,
      usage: aiResult?.usage,
      success: true,
    },
  };
}

const nodes = {
  'market-intel.query-builder': queryBuilder,
};

export default nodes;
