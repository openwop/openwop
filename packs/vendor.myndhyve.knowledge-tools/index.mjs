/**
 * vendor.myndhyve.knowledge-tools
 *
 * Two typeIds against the host.knowledge surface (specced in
 * spec/v1/host-capabilities.md §host.knowledge):
 *
 *   - `knowledge.retrieve`         — thin pass-through; surfaces RAG retrieval
 *                                     as a workflow node + adds optional
 *                                     score-floor filtering on the result set.
 *   - `knowledge.augment-prompt`   — composition primitive. Retrieves, then
 *                                     formats the chunks into a prompt-ready
 *                                     "Sources" block + builds the augmented
 *                                     user message + emits the citation list
 *                                     for the caller to render.
 *
 * Pure-JS, Node-20 stdlib only. No MyndHyve internal imports.
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

function ensureKnowledge(ctx) {
  if (!ctx.knowledge || typeof ctx.knowledge.retrieve !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.knowledge.retrieve — workflow-register should have refused this pack at peerDependency resolution time'),
      { code: 'host_capability_missing', capability: 'host.knowledge' },
    );
  }
}

function applyScoreFloor(chunks, scoreFloor) {
  if (scoreFloor == null) return chunks;
  return chunks.filter((c) => typeof c.relevanceScore === 'number' && c.relevanceScore >= scoreFloor);
}

/* ─── 1. knowledge.retrieve ───────────────────────────────── */

export async function knowledgeRetrieve(ctx) {
  ensureKnowledge(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const query = String(inputs.query ?? '').trim();
  if (query.length === 0) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.query is required (non-empty string)', retryable: false },
    };
  }

  log.debug('Retrieving knowledge', {
    queryLen: query.length,
    collectionCount: inputs.collectionIds?.length ?? 0,
    workspaceId: inputs.workspaceId,
  });

  let result;
  try {
    result = await ctx.knowledge.retrieve({
      query,
      workspaceId: inputs.workspaceId,
      collectionIds: inputs.collectionIds,
      category: inputs.category,
      candidateLimit: inputs.candidateLimit ?? config.candidateLimit,
      resultLimit: inputs.resultLimit ?? config.resultLimit,
      scoreThreshold: inputs.scoreThreshold ?? config.scoreThreshold,
    });
  } catch (err) {
    log.error('Knowledge retrieval failed', { error: String(err?.message ?? err), code: err?.code });
    const retryable = !['knowledge_workspace_forbidden', 'knowledge_collection_not_found', 'knowledge_query_too_long', 'host_capability_missing'].includes(err?.code);
    return {
      status: 'error',
      error: { code: err?.code || 'KNOWLEDGE_RETRIEVE_FAILED', message: String(err?.message ?? err), retryable },
    };
  }

  const rawChunks = Array.isArray(result?.chunks) ? result.chunks : [];
  const filteredChunks = applyScoreFloor(rawChunks, config.scoreFloor);
  const sources = Array.isArray(result?.sources) ? result.sources : [];

  log.info('Knowledge retrieved', {
    chunks: filteredChunks.length,
    droppedByFloor: rawChunks.length - filteredChunks.length,
    sources: sources.length,
    latencyMs: result?.latencyMs,
  });

  return {
    status: 'success',
    outputs: {
      chunks: filteredChunks,
      sources,
      hasResults: filteredChunks.length > 0,
      latencyMs: result?.latencyMs,
      droppedByScoreFloor: rawChunks.length - filteredChunks.length,
      success: true,
    },
  };
}

/* ─── 2. knowledge.augment-prompt ─────────────────────────── */

function buildSourcesBlock(chunks, opts) {
  const maxPerChunk = opts?.maxCharsPerChunk ?? 800;
  const totalCharBudget = opts?.totalCharBudget ?? 6000;

  let used = 0;
  const blocks = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const headingTrail = Array.isArray(c.headingPath) && c.headingPath.length > 0
      ? c.headingPath.join(' › ')
      : null;
    const pageMarker = c.pageNumber != null ? ` (p. ${c.pageNumber})` : '';
    const title = c.documentTitle || c.assetId || `Source ${i + 1}`;
    const heading = headingTrail ? ` — ${headingTrail}` : '';

    const body = String(c.content ?? c.rawContent ?? '').slice(0, maxPerChunk);
    const block = `[#${i + 1}] ${title}${heading}${pageMarker}\n${body}`;
    if (used + block.length > totalCharBudget) break;
    blocks.push(block);
    used += block.length + 2;
  }
  return blocks.join('\n\n');
}

export async function knowledgeAugmentPrompt(ctx) {
  ensureKnowledge(ctx);
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const userMessage = String(inputs.userMessage ?? '').trim();
  const retrievalQuery = String(inputs.retrievalQuery ?? userMessage).trim();
  if (userMessage.length === 0) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.userMessage is required (non-empty string)', retryable: false },
    };
  }
  if (retrievalQuery.length === 0) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.retrievalQuery (or userMessage) must be non-empty', retryable: false },
    };
  }

  let result;
  try {
    result = await ctx.knowledge.retrieve({
      query: retrievalQuery,
      workspaceId: inputs.workspaceId,
      collectionIds: inputs.collectionIds,
      category: inputs.category,
      candidateLimit: inputs.candidateLimit ?? config.candidateLimit,
      resultLimit: inputs.resultLimit ?? config.resultLimit,
      scoreThreshold: inputs.scoreThreshold ?? config.scoreThreshold,
    });
  } catch (err) {
    log.error('Knowledge retrieval failed during augment', { error: String(err?.message ?? err), code: err?.code });
    const retryable = !['knowledge_workspace_forbidden', 'knowledge_collection_not_found', 'knowledge_query_too_long', 'host_capability_missing'].includes(err?.code);
    return {
      status: 'error',
      error: { code: err?.code || 'KNOWLEDGE_AUGMENT_FAILED', message: String(err?.message ?? err), retryable },
    };
  }

  const rawChunks = Array.isArray(result?.chunks) ? result.chunks : [];
  const chunks = applyScoreFloor(rawChunks, config.scoreFloor);
  const sources = Array.isArray(result?.sources) ? result.sources : [];

  const sourcesBlock = buildSourcesBlock(chunks, {
    maxCharsPerChunk: config.maxCharsPerChunk,
    totalCharBudget: config.totalCharBudget,
  });

  const groundedHeader = config.groundedHeader
    ?? 'Use ONLY the sources below to answer. Each chunk is labeled [#N]; cite as [#N] when you use it.';
  const noResultsHeader = config.noResultsHeader
    ?? 'No source material found in the knowledge base for this query. Answer from general knowledge and flag the gap explicitly.';

  const augmentedUserMessage = sourcesBlock.length > 0
    ? `${groundedHeader}\n\n=== Sources ===\n${sourcesBlock}\n=== End Sources ===\n\nUser question:\n${userMessage}`
    : `${noResultsHeader}\n\nUser question:\n${userMessage}`;

  const citations = chunks.map((c, i) => ({
    marker: `[#${i + 1}]`,
    sourceId: c.assetId || c.chunkId,
    documentTitle: c.documentTitle,
    headingPath: Array.isArray(c.headingPath) ? c.headingPath : [],
    pageNumber: c.pageNumber ?? null,
    relevanceScore: c.relevanceScore,
  }));

  log.info('Prompt augmented', {
    chunks: chunks.length,
    promoted: sourcesBlock.length > 0,
    augmentedLen: augmentedUserMessage.length,
  });

  return {
    status: 'success',
    outputs: {
      augmentedUserMessage,
      sourcesBlock,
      citations,
      chunks,
      sources,
      hasResults: chunks.length > 0,
      success: true,
    },
  };
}

const nodes = {
  'knowledge.retrieve': knowledgeRetrieve,
  'knowledge.augment-prompt': knowledgeAugmentPrompt,
};

export default nodes;
