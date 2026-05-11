/**
 * vendor.myndhyve.ai — MyndHyve envelope-protocol AI pack.
 *
 * Distinct from core.openwop.ai (vendor-neutral chat-completion +
 * structured-output + embeddings). This pack ships MyndHyve-specific
 * nodes that work with typed envelopes (`prd.create`, `theme.create`,
 * etc.) routed through MyndHyve's envelope normalizer + artifact-sync
 * registries.
 *
 * typeId-preserve: typeIds keep core.ai.* prefix (workflow-author-
 * facing). Stored MyndHyve workflows referencing these typeIds work
 * without rewriting.
 *
 * Host contract:
 *
 *   ctx.aiEnvelope.generate({
 *     systemPrompt, envelopeType, provider?, model?, temperature?,
 *     maxTokens?, userMessage?, variables?, context?, idempotencyKey
 *   }) → Promise<{ envelopeType, payload, envelopeId, usage?, model? }>
 *
 *   ctx.aiEnvelope.await({ envelopeType, timeoutMs })
 *     → Promise<{ envelopeType, payload?, envelopeId?, timedOut? }>
 *
 *   ctx.promptLibrary.get(promptId)
 *     → Promise<{ systemPrompt, version, promptId }>
 *
 * peerDependencies: host.aiEnvelope: supported, host.promptLibrary: supported
 *
 * @see docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md
 */

import { createHash } from 'node:crypto';

function ensureAiEnvelope(ctx) {
  if (!ctx.aiEnvelope || typeof ctx.aiEnvelope.generate !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.aiEnvelope'),
      { code: 'host_capability_missing' }
    );
  }
}

function ensurePromptLibrary(ctx) {
  if (!ctx.promptLibrary || typeof ctx.promptLibrary.get !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.promptLibrary'),
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

/* ─── core.ai.generateFromPrompt ─────────────────────────── */

export async function generateFromPrompt(ctx) {
  ensureAiEnvelope(ctx);
  const { systemPrompt, envelopeType, provider, model, temperature, maxTokens } = ctx.config;
  const { userMessage, variables, context } = ctx.inputs ?? {};

  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    envelopeType, systemPrompt, userMessage ?? '',
    variables ?? null, context ?? null,
  ]);

  const result = await ctx.aiEnvelope.generate({
    systemPrompt,
    envelopeType,
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(userMessage !== undefined ? { userMessage } : {}),
    ...(variables !== undefined ? { variables } : {}),
    ...(context !== undefined ? { context } : {}),
    idempotencyKey,
  });

  return {
    status: 'success',
    outputs: {
      envelopeType: result?.envelopeType ?? envelopeType,
      payload: result?.payload ?? null,
      ...(result?.envelopeId ? { envelopeId: result.envelopeId } : {}),
      ...(result?.usage ? { usage: result.usage } : {}),
      ...(result?.model ? { model: result.model } : {}),
    },
  };
}

/* ─── core.ai.awaitEnvelope ──────────────────────────────── */

export async function awaitEnvelope(ctx) {
  ensureAiEnvelope(ctx);
  if (typeof ctx.aiEnvelope.await !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.aiEnvelope.await'), { code: 'host_capability_missing' });
  }
  const { envelopeType, timeoutMs = 300000 } = ctx.config;
  const result = await ctx.aiEnvelope.await({ envelopeType, timeoutMs });
  if (result?.timedOut === true) {
    return {
      status: 'success',
      outputs: { envelopeType, timedOut: true },
    };
  }
  return {
    status: 'success',
    outputs: {
      envelopeType: result?.envelopeType ?? envelopeType,
      payload: result?.payload ?? null,
      ...(result?.envelopeId ? { envelopeId: result.envelopeId } : {}),
    },
  };
}

/* ─── core.ai.callPrompt ─────────────────────────────────── */

export async function callPrompt(ctx) {
  ensureAiEnvelope(ctx);
  ensurePromptLibrary(ctx);
  const { promptId, envelopeType, provider, model, temperature } = ctx.config;
  const { userMessage, variables, context } = ctx.inputs ?? {};

  // Resolve prompt from library — host pins the version at dispatch
  // for replay determinism. Replays return the cached terminal output
  // via Layer-2; prompt-library lookup is part of the cache key.
  const resolved = await ctx.promptLibrary.get(promptId);
  if (!resolved?.systemPrompt) {
    throw Object.assign(
      new Error(`prompt-library returned no systemPrompt for promptId=${promptId}`),
      { code: 'prompt_not_found' }
    );
  }

  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    promptId, resolved.version ?? '', envelopeType,
    userMessage ?? '', variables ?? null, context ?? null,
  ]);

  const result = await ctx.aiEnvelope.generate({
    systemPrompt: resolved.systemPrompt,
    envelopeType,
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(userMessage !== undefined ? { userMessage } : {}),
    ...(variables !== undefined ? { variables } : {}),
    ...(context !== undefined ? { context } : {}),
    idempotencyKey,
  });

  return {
    status: 'success',
    outputs: {
      envelopeType: result?.envelopeType ?? envelopeType,
      payload: result?.payload ?? null,
      ...(result?.envelopeId ? { envelopeId: result.envelopeId } : {}),
      promptVersion: resolved.version ?? 'unknown',
      ...(result?.usage ? { usage: result.usage } : {}),
      ...(result?.model ? { model: result.model } : {}),
    },
  };
}

export const nodes = {
  'core.ai.generateFromPrompt': generateFromPrompt,
  'core.ai.awaitEnvelope': awaitEnvelope,
  'core.ai.callPrompt': callPrompt,
};

export default nodes;
