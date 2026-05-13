/**
 * vendor.myndhyve.market-intel-discovery
 *
 * Single typeId: `market-intel.ai-discovery`
 *
 * Lifted from src/core/market-intel/prompts/discoveryPrompt.ts (~300 LOC TS)
 * + executor wrapper in src/canvas-types/campaign-studio/nodes/marketIntel/
 * aiDiscoveryExecutor.ts (~200 LOC).
 *
 * Use case: given a topic + optional industry/audience/platforms, AI-discovers
 * relevant communities, URLs, and search queries — replaces the manual URL
 * input step of the marketIntel research pipeline.
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

const VALID_PLATFORMS = ['reddit', 'hackernews', 'stackexchange', 'quora', 'twitter', 'other'];

const SYSTEM_PROMPT = `You are an expert market researcher. Your task is to identify the best online sources for understanding customer sentiment, pain points, and behaviors around a given topic.

You MUST output valid JSON matching this schema:
{
  "urls": ["string"],
  "communities": [
    {
      "platform": "reddit|hackernews|stackexchange|quora|twitter|other",
      "name": "string",
      "url": "string",
      "relevanceScore": 0.0-1.0,
      "estimatedPostCount": number,
      "description": "string"
    }
  ],
  "searchQueries": ["string"]
}

Guidelines:
- Focus on communities where real users discuss the topic (not marketing/press)
- Prioritize active communities with recent discussions
- Include a mix of high-traffic and niche communities
- Suggest specific search queries that would surface VoC-rich content
- For Reddit: suggest specific subreddits (e.g., r/SaaS, r/startups)
- For HackerNews: suggest search terms that work with HN search
- For StackExchange: suggest relevant sites and tags
- relevanceScore: 0.9+ = highly relevant, 0.7-0.9 = relevant, 0.5-0.7 = tangential`;

function buildUserPrompt(inputs) {
  const parts = [`Research Topic: ${inputs.topic}`];
  if (inputs.industry) parts.push(`Industry: ${inputs.industry}`);
  if (inputs.audience) parts.push(`Target Audience: ${inputs.audience}`);
  if (Array.isArray(inputs.platforms) && inputs.platforms.length > 0) {
    parts.push(`Focus Platforms: ${inputs.platforms.join(', ')}`);
  } else {
    parts.push('Focus Platforms: Any (suggest the best ones)');
  }

  const minUrls = inputs.minUrls ?? 10;
  const minCommunities = inputs.minCommunities ?? 5;
  const minQueries = inputs.minQueries ?? 5;

  parts.push(
    '',
    'Find the most relevant online communities and specific URLs where real users discuss this topic.',
    `Return at least ${minCommunities} communities and ${minUrls} specific URLs if possible.`,
    `Also suggest ${minQueries}+ search queries that would find high-quality VoC content.`,
  );

  return parts.join('\n');
}

function parseJSONFromAI(content) {
  const cleaned = String(content ?? '').replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function isValidUrl(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  // Accept full URLs OR reddit-style 'r/subreddit' identifiers (per source guidance).
  if (/^https?:\/\//.test(s)) return true;
  if (/^r\/[A-Za-z0-9_]+$/.test(s)) return true;
  return false;
}

function clampRelevance(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function validateCommunity(c) {
  if (!c || typeof c !== 'object') return null;
  if (typeof c.name !== 'string' || c.name.length === 0) return null;
  if (typeof c.url !== 'string' || c.url.length === 0) return null;
  const platform = VALID_PLATFORMS.includes(c.platform) ? c.platform : 'other';
  return {
    platform,
    name: c.name,
    url: c.url,
    relevanceScore: clampRelevance(c.relevanceScore),
    estimatedPostCount: Number.isFinite(Number(c.estimatedPostCount)) ? Number(c.estimatedPostCount) : null,
    description: typeof c.description === 'string' ? c.description : '',
  };
}

function validateOutput(raw) {
  if (!raw || typeof raw !== 'object') {
    return { urls: [], communities: [], searchQueries: [], warnings: ['Output was not an object'] };
  }
  const warnings = [];

  const urls = Array.isArray(raw.urls)
    ? raw.urls.filter((u) => {
        if (isValidUrl(u)) return true;
        warnings.push(`Dropped invalid URL: ${String(u).slice(0, 80)}`);
        return false;
      })
    : [];

  const communities = [];
  if (Array.isArray(raw.communities)) {
    for (let i = 0; i < raw.communities.length; i++) {
      const v = validateCommunity(raw.communities[i]);
      if (v) communities.push(v);
      else warnings.push(`Dropped invalid community at index ${i}`);
    }
  }
  // Sort communities by relevanceScore descending (stable)
  communities.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const searchQueries = Array.isArray(raw.searchQueries)
    ? raw.searchQueries.filter((q) => typeof q === 'string' && q.length > 0)
    : [];

  return { urls, communities, searchQueries, warnings };
}

export async function aiDiscovery(ctx) {
  ensureCallAI(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const topic = String(inputs.topic ?? '').trim();
  if (topic.length === 0) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.topic is required (non-empty string)', retryable: false },
    };
  }

  log.debug('Discovering sources', { topic, industry: inputs.industry, platforms: inputs.platforms });

  let aiResult;
  try {
    aiResult = await ctx.callAI({
      provider: config.provider,
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(inputs) }],
      temperature: config.temperature ?? 0.3,
      maxTokens: config.maxTokens ?? 2048,
    });
  } catch (err) {
    log.error('AI source discovery failed', { error: String(err?.message ?? err) });
    return {
      status: 'error',
      error: { code: 'AI_DISCOVERY_FAILED', message: String(err?.message ?? err), retryable: true },
    };
  }

  const parsed = parseJSONFromAI(aiResult?.content);
  if (!parsed) {
    log.warn('AI response could not be parsed as JSON, returning empty results');
    return {
      status: 'success',
      outputs: {
        sources: [],
        communities: [],
        searchQueries: [],
        warnings: ['AI response could not be parsed as JSON'],
        model: aiResult?.model,
        usage: aiResult?.usage,
        success: true,
      },
    };
  }

  const validated = validateOutput(parsed);

  log.info('AI source discovery completed', {
    urlCount: validated.urls.length,
    communityCount: validated.communities.length,
    queryCount: validated.searchQueries.length,
    warnings: validated.warnings.length,
  });

  return {
    status: 'success',
    outputs: {
      sources: validated.urls,
      communities: validated.communities,
      searchQueries: validated.searchQueries,
      warnings: validated.warnings,
      model: aiResult?.model,
      usage: aiResult?.usage,
      success: true,
    },
  };
}

const nodes = {
  'market-intel.ai-discovery': aiDiscovery,
};

export default nodes;
