/**
 * vendor.myndhyve.market-intel-content-extraction
 *
 * Single typeId: `market-intel.content-extraction`
 *
 * Lifted from src/core/market-intel/prompts/discoveryPrompt.ts
 * (content-extraction section, ~100 LOC).
 *
 * Use case: given raw HTML + the source URL, AI-extracts the main content
 * in a structured shape (title, content, author, publishedAt, contentType,
 * engagement metrics, tags, summary, relevantQuotes). Sits between
 * webResearch.fetchBatch and voc-extraction in the canonical marketIntel
 * pipeline.
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

const VALID_CONTENT_TYPES = ['discussion', 'article', 'review', 'question', 'comment_thread', 'documentation', 'other'];

const SYSTEM_PROMPT = `You are an expert content extractor. Given raw HTML from a web page, extract the main content in a structured format.

You MUST output valid JSON matching this schema:
{
  "title": "string",
  "content": "string (main text content, cleaned)",
  "author": "string | null",
  "publishedAt": "ISO date string | null",
  "contentType": "discussion|article|review|question|comment_thread|documentation|other",
  "engagement": {
    "upvotes": number | null,
    "comments": number | null,
    "views": number | null,
    "shares": number | null
  },
  "tags": ["string"],
  "summary": "1-2 sentence summary",
  "relevantQuotes": ["string (exact quotes that contain opinions, pain points, or desires)"]
}

Guidelines:
- Extract ONLY the main content (no navigation, ads, sidebars, footers)
- Preserve the original language — do not paraphrase
- For discussion threads: extract the main post and top comments
- For articles: extract the full article text
- contentType should reflect the actual content, not just the site
- relevantQuotes: extract 3-10 notable quotes that express opinions or experiences`;

const DEFAULT_HTML_TRUNCATE = 50000;

function buildUserPrompt(inputs, truncateAt) {
  const parts = [`URL: ${inputs.url}`];
  if (inputs.contentTypeHint) {
    parts.push(`Expected content type: ${inputs.contentTypeHint}`);
  }
  const html = String(inputs.rawHtml).substring(0, truncateAt);
  parts.push(
    '',
    'Extract the main content from this HTML:',
    '',
    '--- HTML START ---',
    html,
    '--- HTML END ---',
  );
  return parts.join('\n');
}

function parseJSONFromAI(content) {
  const cleaned = String(content ?? '').replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function nullableInt(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function nullableString(v) {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function emptyOutput(warning, url) {
  return {
    title: '',
    content: '',
    author: null,
    publishedAt: null,
    contentType: 'other',
    engagement: { upvotes: null, comments: null, views: null, shares: null },
    tags: [],
    summary: '',
    relevantQuotes: [],
    url,
    warnings: warning ? [warning] : [],
  };
}

function validateOutput(raw, url) {
  if (!raw || typeof raw !== 'object') return emptyOutput('Output was not an object', url);
  const warnings = [];

  const title = typeof raw.title === 'string' ? raw.title : '';
  if (title.length === 0) warnings.push('title is missing or empty');

  const content = typeof raw.content === 'string' ? raw.content : '';
  if (content.length === 0) warnings.push('content is missing or empty');

  let contentType = 'other';
  if (typeof raw.contentType === 'string' && VALID_CONTENT_TYPES.includes(raw.contentType)) {
    contentType = raw.contentType;
  } else if (raw.contentType != null) {
    warnings.push(`Invalid contentType "${raw.contentType}", defaulted to "other"`);
  }

  let engagement = { upvotes: null, comments: null, views: null, shares: null };
  if (raw.engagement && typeof raw.engagement === 'object') {
    engagement = {
      upvotes: nullableInt(raw.engagement.upvotes),
      comments: nullableInt(raw.engagement.comments),
      views: nullableInt(raw.engagement.views),
      shares: nullableInt(raw.engagement.shares),
    };
  }

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t) => typeof t === 'string' && t.length > 0)
    : [];

  const summary = typeof raw.summary === 'string' ? raw.summary : '';

  const relevantQuotes = Array.isArray(raw.relevantQuotes)
    ? raw.relevantQuotes.filter((q) => typeof q === 'string' && q.length >= 5)
    : [];
  if (Array.isArray(raw.relevantQuotes) && relevantQuotes.length < raw.relevantQuotes.length) {
    warnings.push(`Dropped ${raw.relevantQuotes.length - relevantQuotes.length} quote(s) shorter than 5 chars or non-string`);
  }

  // publishedAt is ISO date string OR null. Validate roughly.
  let publishedAt = null;
  if (typeof raw.publishedAt === 'string' && raw.publishedAt.length > 0) {
    const d = new Date(raw.publishedAt);
    if (Number.isFinite(d.getTime())) {
      publishedAt = d.toISOString();
    } else {
      warnings.push(`publishedAt "${raw.publishedAt}" is not a valid ISO date, dropped`);
    }
  }

  const upstreamWarnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w) => typeof w === 'string')
    : [];

  return {
    title,
    content,
    author: nullableString(raw.author),
    publishedAt,
    contentType,
    engagement,
    tags,
    summary,
    relevantQuotes,
    url,
    warnings: [...upstreamWarnings, ...warnings],
  };
}

export async function contentExtraction(ctx) {
  ensureCallAI(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const rawHtml = typeof inputs.rawHtml === 'string' ? inputs.rawHtml : '';
  const url = typeof inputs.url === 'string' ? inputs.url : '';
  if (rawHtml.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.rawHtml is required (non-empty string)', retryable: false } };
  }
  if (url.length === 0) {
    return { status: 'error', error: { code: 'INVALID_INPUTS', message: 'inputs.url is required (non-empty string)', retryable: false } };
  }

  const truncateAt = config.htmlTruncateChars ?? DEFAULT_HTML_TRUNCATE;
  const wasTruncated = rawHtml.length > truncateAt;

  log.debug('Extracting content', { url, htmlLen: rawHtml.length, wasTruncated });

  let aiResult;
  try {
    aiResult = await ctx.callAI({
      provider: config.provider,
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(inputs, truncateAt) }],
      temperature: config.temperature ?? 0.2,
      maxTokens: config.maxTokens ?? 3000,
    });
  } catch (err) {
    log.error('AI content extraction failed', { error: String(err?.message ?? err) });
    return { status: 'error', error: { code: 'CONTENT_EXTRACTION_FAILED', message: String(err?.message ?? err), retryable: true } };
  }

  const parsed = parseJSONFromAI(aiResult?.content);
  if (!parsed) {
    log.warn('AI response could not be parsed as JSON, returning empty extraction');
    return {
      status: 'success',
      outputs: {
        ...emptyOutput('AI response could not be parsed as JSON', url),
        wasTruncated,
        model: aiResult?.model,
        usage: aiResult?.usage,
        success: true,
      },
    };
  }

  const validated = validateOutput(parsed, url);
  if (wasTruncated) {
    validated.warnings.push(`rawHtml truncated from ${rawHtml.length} to ${truncateAt} chars before prompt`);
  }

  log.info('Content extraction completed', {
    url,
    contentLen: validated.content.length,
    quoteCount: validated.relevantQuotes.length,
    warnings: validated.warnings.length,
  });

  return {
    status: 'success',
    outputs: {
      title: validated.title,
      content: validated.content,
      author: validated.author,
      publishedAt: validated.publishedAt,
      contentType: validated.contentType,
      engagement: validated.engagement,
      tags: validated.tags,
      summary: validated.summary,
      relevantQuotes: validated.relevantQuotes,
      url: validated.url,
      wasTruncated,
      warnings: validated.warnings,
      model: aiResult?.model,
      usage: aiResult?.usage,
      success: true,
    },
  };
}

const nodes = {
  'market-intel.content-extraction': contentExtraction,
};

export default nodes;
