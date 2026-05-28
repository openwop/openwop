/**
 * vendor.myndhyve.web-research — search → fetch → research → synthesize pipeline.
 *
 * Four nodes, two host capabilities:
 *   - host.webResearch (search + fetch + research orchestration)
 *   - host.aiEnvelope  (synthesis — reuses the same primitive as
 *                       vendor.myndhyve.ai for envelope generation)
 *
 * typeId-preserve: matches in-tree names verbatim per migration plan §4
 *   data.source.webSearch
 *   data.transform.fetchUrls
 *   ai.research.web
 *   ai.process.synthesize
 *
 * @see docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md
 */

import { createHash } from 'node:crypto';

function ensureWebResearch(ctx) {
  if (!ctx.webResearch || typeof ctx.webResearch.search !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.webResearch'),
      { code: 'host_capability_missing' }
    );
  }
}

function ensureAiEnvelope(ctx) {
  if (!ctx.aiEnvelope || typeof ctx.aiEnvelope.generate !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.aiEnvelope'),
      { code: 'host_capability_missing' }
    );
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

/* ─── core.webResearch.webSearch ─────────────────────────── */

export async function webSearch(ctx) {
  ensureWebResearch(ctx);
  const { engine, maxResults = 10, language, region, safeSearch = 'moderate' } = ctx.config;
  const { query, siteFilter } = ctx.inputs;

  const result = await ctx.webResearch.search({
    query,
    maxResults,
    safeSearch,
    ...(engine !== undefined ? { engine } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(region !== undefined ? { region } : {}),
    ...(siteFilter !== undefined ? { siteFilter } : {}),
  });

  return {
    status: 'success',
    outputs: {
      results: Array.isArray(result?.results) ? result.results : [],
      engine: result?.engine ?? engine ?? 'default',
      query,
      ...(typeof result?.totalResults === 'number' ? { totalResults: result.totalResults } : {}),
    },
  };
}

/* ─── core.webResearch.fetchUrls ─────────────────────────── */

export async function fetchUrls(ctx) {
  ensureWebResearch(ctx);
  if (typeof ctx.webResearch.fetchBatch !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.webResearch.fetchBatch'), { code: 'host_capability_missing' });
  }
  const { concurrency, perRequestTimeoutMs, respectRobotsTxt, maxBodyBytes, extractReadable } = ctx.config;
  const { urls } = ctx.inputs;

  const result = await ctx.webResearch.fetchBatch({
    urls,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(perRequestTimeoutMs !== undefined ? { perRequestTimeoutMs } : {}),
    ...(respectRobotsTxt !== undefined ? { respectRobotsTxt } : {}),
    ...(maxBodyBytes !== undefined ? { maxBodyBytes } : {}),
    ...(extractReadable !== undefined ? { extractReadable } : {}),
  });

  const pages = Array.isArray(result?.pages) ? result.pages : [];
  const succeeded = pages.filter((p) => p?.status >= 200 && p?.status < 300).length;
  return {
    status: 'success',
    outputs: {
      pages,
      succeeded,
      failed: pages.length - succeeded,
    },
  };
}

/* ─── core.webResearch.researchWeb ───────────────────────── */

export async function researchWeb(ctx) {
  ensureWebResearch(ctx);
  if (typeof ctx.webResearch.research !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.webResearch.research'), { code: 'host_capability_missing' });
  }
  const { engine, maxResults = 5, language, region, perFetchTimeoutMs } = ctx.config;
  const { query, siteFilter } = ctx.inputs;

  const result = await ctx.webResearch.research({
    query,
    maxResults,
    ...(engine !== undefined ? { engine } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(region !== undefined ? { region } : {}),
    ...(perFetchTimeoutMs !== undefined ? { perFetchTimeoutMs } : {}),
    ...(siteFilter !== undefined ? { siteFilter } : {}),
  });

  return {
    status: 'success',
    outputs: {
      citations: Array.isArray(result?.citations) ? result.citations : [],
      query,
      ...(result?.engine ? { engine: result.engine } : {}),
      ...(typeof result?.totalResults === 'number' ? { totalResults: result.totalResults } : {}),
    },
  };
}

/* ─── core.webResearch.synthesize ────────────────────────── */

export async function synthesize(ctx) {
  ensureAiEnvelope(ctx);
  const { envelopeType, systemPrompt, model, temperature } = ctx.config;
  const { citations, variables } = ctx.inputs;

  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    envelopeType, systemPrompt, citations, variables ?? null,
  ]);

  // Pass citations as context to the host's AI envelope adapter.
  // The host's prompt-rendering layer typically injects citation
  // content + URLs into the LLM message turn.
  const result = await ctx.aiEnvelope.generate({
    systemPrompt,
    envelopeType,
    ...(model !== undefined ? { model } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    context: { citations },
    ...(variables !== undefined ? { variables } : {}),
    idempotencyKey,
  });

  return {
    status: 'success',
    outputs: {
      envelopeType: result?.envelopeType ?? envelopeType,
      payload: result?.payload ?? null,
      ...(result?.envelopeId ? { envelopeId: result.envelopeId } : {}),
      sourceUrls: citations.map((c) => c.url),
      ...(result?.usage ? { usage: result.usage } : {}),
      ...(result?.model ? { model: result.model } : {}),
    },
  };
}

export const nodes = {
  'data.source.webSearch': webSearch,
  'data.transform.fetchUrls': fetchUrls,
  'ai.research.web': researchWeb,
  'ai.process.synthesize': synthesize,
};

export default nodes;
