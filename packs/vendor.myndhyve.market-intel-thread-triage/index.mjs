/**
 * vendor.myndhyve.market-intel-thread-triage
 *
 * Single typeId: `market-intel.thread-triage`
 *
 * Lifted from src/core/market-intel/prompts/threadTriage.ts (562 LOC TS).
 * Cost-aware pre-filter that prioritizes candidate threads for VoC extraction
 * within a token budget. Returns priority tier (critical/high/medium/low/skip)
 * + predicted VoC value + intent stage + tag types + per-thread extraction
 * risk + extraction queue + diversity analysis.
 *
 * Sits between ai-discovery (candidate fetch) and voc-extraction (the
 * cost-bearing step) in the canonical pipeline — saves AI budget by
 * dropping low-signal threads BEFORE voc-extraction runs on them.
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

const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low', 'skip'];
const VALID_INTENT_STAGES = ['ready_now', 'researching', 'problem_aware', 'unaware'];
const VALID_TAG_TYPES = ['pain', 'desire', 'objection', 'trigger', 'alternative'];
const VALID_RISKS = ['low', 'medium', 'high'];

const SYSTEM_PROMPT = `You are a market research thread analyst. Your task is to evaluate online discussion threads and prioritize them for Voice of Customer (VoC) extraction based on predicted signal quality, relevance, and cost-effectiveness.

## Core Principles

1. **Quality Over Quantity**: Extract fewer high-value threads rather than many low-value ones.
2. **Cost Awareness**: Each extraction costs tokens. Prioritize threads with the best signal-to-token ratio.
3. **Diversity**: Ensure coverage across intent stages, platforms, and ICP problems.
4. **Recency**: Recent threads often reflect current pain points and emerging trends.

## Thread Priority Framework

### Critical Priority (score 0.85-1.0)
- Title directly mentions ICP pain points or desired outcomes
- High engagement (many upvotes/comments)
- Contains comparison language ("vs", "alternative to", "switched from")
- Recent (< 30 days)
- From a highly relevant community

### High Priority (score 0.7-0.85)
- Title related to ICP problems
- Good engagement
- Contains experience-sharing language ("I tried", "we use", "our team")
- Recent to moderate age
- Likely contains multiple intent stages

### Medium Priority (score 0.5-0.7)
- Tangentially related to ICP
- Moderate engagement
- May contain useful signals mixed with noise
- Good for supplementary VoC data

### Low Priority (score 0.3-0.5)
- Loosely related topic
- Low engagement
- Generic discussion without strong signals
- Extract only if budget allows

### Skip (score < 0.3)
- Off-topic or irrelevant
- Marketing/promotional content
- Duplicate of a higher-priority thread
- Dead link or deleted content

## Title Signal Analysis

### High-Signal Title Patterns
- Questions about specific problems: "How do you handle X?"
- Comparison requests: "X vs Y for Z use case"
- Experience sharing: "My experience with X after 6 months"
- Complaints/frustrations: "Frustrated with X", "Why is X so hard"
- Tool recommendations: "Best tool for X?"
- Decision making: "Should I use X or Y?"

### Low-Signal Title Patterns
- Pure announcements: "X just released v2.0"
- Self-promotion: "I built X" (without discussion)
- Memes or jokes
- Meta discussions about the community itself
- News aggregation without discussion

## Extraction Risk Assessment
- **Low Risk**: Thread has substantial text content, multiple responses, clear relevance
- **Medium Risk**: Thread might be too short, responses might be tangential
- **High Risk**: Thread might be link-only, archived (no new comments), or paywalled

## Output Requirements
1. Assign a priority to every candidate thread
2. Build an extraction queue in priority order within token budget
3. Ensure intent stage diversity in the queue
4. Explain the triage rationale for each thread
5. Estimate extraction cost per thread`;

function buildUserPrompt(inputs) {
  const maxThreads = inputs.maxThreads ?? 20;
  const minEngagement = inputs.minEngagement ?? 0;
  const tokenBudget = inputs.tokenBudgetRemaining ?? 50000;
  const candidateThreads = Array.isArray(inputs.candidateThreads) ? inputs.candidateThreads : [];
  const icp = inputs.icpContext ?? {};
  const prod = inputs.productContext ?? {};
  const arr = (xs) => (Array.isArray(xs) ? xs : []);

  const threadList = candidateThreads.map((t, i) => {
    const eng = t?.engagement ?? {};
    const previewLine = t?.preview
      ? `\n   - Preview: "${String(t.preview).slice(0, 150)}${String(t.preview).length > 150 ? '...' : ''}"`
      : '';
    const viewsLine = eng.views ? `, ${eng.views} views` : '';
    return `${i + 1}. **${t?.title ?? '(no title)'}** [${t?.platform ?? 'other'}/${t?.community ?? '?'}]
   - URL: ${t?.url ?? ''}
   - Engagement: ${eng.upvotes ?? 0} upvotes, ${eng.comments ?? 0} comments${viewsLine}
   - Created: ${t?.createdAt ?? '(unknown)'}${previewLine}`;
  }).join('\n\n');

  return `## Task
Triage ${candidateThreads.length} candidate threads and build a prioritized extraction queue.

## ICP Context
- **Roles**: ${arr(icp.roles).join(', ')}
- **Industry**: ${icp.industry ?? 'Not specified'}
- **Problems**: ${arr(icp.problems).join('; ')}
- **Desired Outcomes**: ${arr(icp.outcomes).join('; ')}

## Product Context
- **Product**: ${prod.name ?? 'Not specified'}
- **Category**: ${prod.category ?? 'Not specified'}
- **Differentiators**: ${arr(prod.differentiators).join('; ')}

## Constraints
- **Max threads for extraction**: ${maxThreads}
- **Min engagement score**: ${minEngagement}
- **Token budget remaining**: ~${tokenBudget.toLocaleString()} tokens
- **Estimated tokens per extraction**: 1,000-5,000 (varies by thread length)

## Candidate Threads

${threadList}

## Instructions
1. Evaluate each thread based on:
   - Title relevance to ICP problems/outcomes
   - Engagement metrics (proxy for discussion quality)
   - Platform and community context
   - Preview text quality (if available)
   - Recency
2. Assign priority (critical, high, medium, low, skip)
3. Predict VoC value, intent stages, and tag types
4. Build an extraction queue:
   - Fill from critical → high → medium → low
   - Stop when max threads or token budget is reached
   - Ensure diversity (don't cluster all from one community)
5. Flag extraction risks

## Required Output Format
Respond with valid JSON matching this structure:
\`\`\`json
{
  "triagedThreads": [
    {
      "id": "thread-id",
      "url": "https://...",
      "title": "thread title",
      "priority": "critical|high|medium|low|skip",
      "predictedVoCValue": 0.85,
      "predictedIntentStages": ["researching", "problem_aware"],
      "predictedTagTypes": ["pain", "desire", "objection"],
      "triageRationale": "why this priority",
      "estimatedExtractionTokens": 3000,
      "extractionRisk": "low|medium|high",
      "extractionRiskReason": "optional reason"
    }
  ],
  "extractionQueue": ["thread-id-1", "thread-id-2"],
  "skippedThreads": [{ "id": "...", "title": "...", "reason": "..." }],
  "diversityAnalysis": {
    "intentCoverage": { "ready_now": 2, "researching": 5 },
    "platformCoverage": { "reddit": 3, "hackernews": 2 },
    "problemCoverage": ["problem 1", "problem 2"]
  },
  "summary": {
    "totalCandidates": ${candidateThreads.length},
    "totalSelected": n,
    "totalSkipped": n,
    "estimatedTotalTokens": n,
    "avgPredictedVoCValue": 0.72
  },
  "warnings": ["any notes"]
}
\`\`\``;
}

function parseJSONFromAI(content) {
  const cleaned = String(content ?? '').replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function emptyOutput(warning) {
  return {
    triagedThreads: [],
    extractionQueue: [],
    skippedThreads: [],
    diversityAnalysis: { intentCoverage: {}, platformCoverage: {}, problemCoverage: [] },
    summary: {
      totalCandidates: 0,
      totalSelected: 0,
      totalSkipped: 0,
      estimatedTotalTokens: 0,
      avgPredictedVoCValue: 0,
    },
    warnings: warning ? [warning] : [],
  };
}

function validateOutput(raw) {
  if (!raw || typeof raw !== 'object') return emptyOutput('Output was not an object');
  const warnings = [];

  const triagedThreads = [];
  if (Array.isArray(raw.triagedThreads)) {
    for (let i = 0; i < raw.triagedThreads.length; i++) {
      const t = raw.triagedThreads[i];
      if (!t || typeof t !== 'object') {
        warnings.push(`Triaged thread ${i} is not an object, skipping`);
        continue;
      }
      if (typeof t.id !== 'string' || typeof t.title !== 'string') {
        warnings.push(`Triaged thread ${i} missing id or title, skipping`);
        continue;
      }
      const priority = VALID_PRIORITIES.includes(t.priority) ? t.priority : 'medium';
      const predictedVoCValue = typeof t.predictedVoCValue === 'number'
        ? Math.max(0, Math.min(1, t.predictedVoCValue))
        : 0.5;
      const predictedIntentStages = Array.isArray(t.predictedIntentStages)
        ? t.predictedIntentStages.filter((s) => VALID_INTENT_STAGES.includes(s))
        : [];
      const predictedTagTypes = Array.isArray(t.predictedTagTypes)
        ? t.predictedTagTypes.filter((tag) => VALID_TAG_TYPES.includes(tag))
        : [];
      const extractionRisk = VALID_RISKS.includes(t.extractionRisk) ? t.extractionRisk : 'medium';
      triagedThreads.push({
        id: t.id,
        url: typeof t.url === 'string' ? t.url : '',
        title: t.title,
        priority,
        predictedVoCValue,
        predictedIntentStages,
        predictedTagTypes,
        triageRationale: typeof t.triageRationale === 'string' ? t.triageRationale : '',
        estimatedExtractionTokens: Number.isFinite(Number(t.estimatedExtractionTokens))
          ? Math.max(0, Math.round(Number(t.estimatedExtractionTokens)))
          : 2000,
        extractionRisk,
        extractionRiskReason: typeof t.extractionRiskReason === 'string' ? t.extractionRiskReason : undefined,
      });
    }
  } else {
    warnings.push('Output missing triagedThreads array');
  }

  // extractionQueue: trust AI's queue if string-only; otherwise rebuild from
  // non-skip threads sorted by predictedVoCValue desc (matches source behavior).
  let extractionQueue;
  if (Array.isArray(raw.extractionQueue)) {
    extractionQueue = raw.extractionQueue.filter((id) => typeof id === 'string');
  } else {
    extractionQueue = triagedThreads
      .filter((t) => t.priority !== 'skip')
      .slice()
      .sort((a, b) => b.predictedVoCValue - a.predictedVoCValue)
      .map((t) => t.id);
  }

  const skippedThreads = [];
  if (Array.isArray(raw.skippedThreads)) {
    for (const st of raw.skippedThreads) {
      if (st && typeof st === 'object' && typeof st.id === 'string') {
        skippedThreads.push({
          id: st.id,
          title: typeof st.title === 'string' ? st.title : 'Unknown',
          reason: typeof st.reason === 'string' ? st.reason : 'No reason given',
        });
      }
    }
  }

  const diversityAnalysis = { intentCoverage: {}, platformCoverage: {}, problemCoverage: [] };
  if (raw.diversityAnalysis && typeof raw.diversityAnalysis === 'object') {
    const da = raw.diversityAnalysis;
    if (da.intentCoverage && typeof da.intentCoverage === 'object') {
      for (const [k, v] of Object.entries(da.intentCoverage)) {
        if (typeof v === 'number') diversityAnalysis.intentCoverage[k] = v;
      }
    }
    if (da.platformCoverage && typeof da.platformCoverage === 'object') {
      for (const [k, v] of Object.entries(da.platformCoverage)) {
        if (typeof v === 'number') diversityAnalysis.platformCoverage[k] = v;
      }
    }
    if (Array.isArray(da.problemCoverage)) {
      diversityAnalysis.problemCoverage = da.problemCoverage.filter((p) => typeof p === 'string');
    }
  }

  // Rebuild summary from validated data (don't trust AI's claimed totals).
  const selected = triagedThreads.filter((t) => t.priority !== 'skip');
  const avgVoCValue = selected.length > 0
    ? selected.reduce((sum, t) => sum + t.predictedVoCValue, 0) / selected.length
    : 0;
  const totalTokens = selected.reduce((sum, t) => sum + t.estimatedExtractionTokens, 0);

  const summary = {
    totalCandidates: triagedThreads.length,
    totalSelected: extractionQueue.length,
    totalSkipped: skippedThreads.length,
    estimatedTotalTokens: totalTokens,
    avgPredictedVoCValue: Math.round(avgVoCValue * 10000) / 10000,
  };

  const upstreamWarnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w) => typeof w === 'string')
    : [];

  return {
    triagedThreads,
    extractionQueue,
    skippedThreads,
    diversityAnalysis,
    summary,
    warnings: [...upstreamWarnings, ...warnings],
  };
}

export async function threadTriage(ctx) {
  ensureCallAI(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const candidateThreads = Array.isArray(inputs.candidateThreads) ? inputs.candidateThreads : [];
  if (candidateThreads.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.candidateThreads must contain at least one thread', retryable: false } };
  }
  if (!inputs.icpContext || typeof inputs.icpContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.icpContext is required', retryable: false } };
  }
  if (!inputs.productContext || typeof inputs.productContext !== 'object') {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.productContext is required', retryable: false } };
  }

  log.debug('Triaging threads', {
    candidateCount: candidateThreads.length,
    maxThreads: inputs.maxThreads ?? 20,
    tokenBudget: inputs.tokenBudgetRemaining ?? 50000,
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
    log.error('AI thread triage failed', { error: String(err?.message ?? err) });
    return { status: 'error', error: { code: 'THREAD_TRIAGE_FAILED', message: String(err?.message ?? err), retryable: true } };
  }

  const parsed = parseJSONFromAI(aiResult?.content);
  if (!parsed) {
    log.warn('AI response could not be parsed as JSON, returning empty triage');
    return {
      status: 'success',
      outputs: {
        ...emptyOutput('AI response could not be parsed as JSON'),
        model: aiResult?.model,
        usage: aiResult?.usage,
        success: true,
      },
    };
  }

  const validated = validateOutput(parsed);

  log.info('Thread triage completed', {
    triaged: validated.triagedThreads.length,
    selected: validated.extractionQueue.length,
    skipped: validated.skippedThreads.length,
    warnings: validated.warnings.length,
  });

  return {
    status: 'success',
    outputs: {
      triagedThreads: validated.triagedThreads,
      extractionQueue: validated.extractionQueue,
      skippedThreads: validated.skippedThreads,
      diversityAnalysis: validated.diversityAnalysis,
      summary: validated.summary,
      warnings: validated.warnings,
      model: aiResult?.model,
      usage: aiResult?.usage,
      success: true,
    },
  };
}

const nodes = {
  'market-intel.thread-triage': threadTriage,
};

export default nodes;
