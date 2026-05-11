/**
 * core.openwop.ai — spec-canonical AI-call pack runtime.
 *
 * Three nodes route through the host's `ctx.callAI(...)` primitive.
 * The pack itself makes NO HTTP calls — the host's BYOK aiProviders
 * abstraction handles provider routing, secret resolution, retry
 * policy, rate-limit handling, and provider-specific quirks (system
 * prompt placement, stop-sequence limits, etc.).
 *
 * Pack peerDependencies: `aiProviders.supported`. Hosts that don't
 * advertise this MUST refuse to register the pack at workflow-
 * register time per spec/v1/node-packs.md §"peerDependencies."
 *
 * Replay model:
 *   All three nodes declare `side-effectful` capability — LLM calls
 *   cost money + are non-deterministic. Per spec/v1/replay.md
 *   §"Replay determinism," the host's Layer-2 invocation log caches
 *   the terminal node.completed payload keyed on (runId, nodeId,
 *   request-hash). Replays return the cached payload without
 *   re-calling the provider.
 *
 * Host contract (informative — these are the ctx properties this
 * pack reads; the openwop spec doesn't yet normatively declare
 * ctx.callAI, but hosts advertising `aiProviders.supported` MUST
 * expose an equivalent primitive):
 *
 *   ctx.callAI({
 *     provider: string,
 *     model: string,
 *     messages: Array<{ role, content }>,
 *     temperature?, maxTokens?, stopSequences?, systemPrompt?,
 *     // For structured-output:
 *     responseSchema?: object,  // JSON Schema
 *     // For embeddings:
 *     embeddingMode?: true,
 *     dimensions?: number,
 *   }) → Promise<{
 *     content?: string,
 *     data?: object,            // for structured-output
 *     embedding?: number[],     // for embeddings
 *     usage: { inputTokens, outputTokens, totalTokens? },
 *     finishReason?: string,
 *     model?: string,
 *   }>
 *
 * @see spec/v1/capabilities.md §aiProviders
 * @see spec/v1/replay.md §"Replay determinism"
 * @see docs/PACKS-MVP-PLAN.md
 */

function ensureCallAI(ctx) {
  if (typeof ctx.callAI !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.callAI — workflow-register should have refused this pack at peerDependency resolution time'),
      { code: 'host_capability_missing' }
    );
  }
}

/**
 * Canonical finishReason mapping. Providers return varied strings
 * (Anthropic: "end_turn"/"max_tokens"; OpenAI: "stop"/"length"/
 * "tool_calls"; Gemini: "STOP"/"MAX_TOKENS"/"SAFETY"). The host's
 * callAI SHOULD normalize, but defensively map common variants here
 * so the schema's enum stays honest.
 */
function normalizeFinishReason(raw) {
  if (!raw) return 'other';
  const s = String(raw).toLowerCase();
  if (s === 'stop' || s === 'end_turn' || s === 'end-turn') return 'stop';
  if (s === 'length' || s === 'max_tokens' || s === 'max-tokens') return 'length';
  if (s === 'content-filter' || s === 'safety' || s === 'content_filter') return 'content-filter';
  if (s === 'tool-call' || s === 'tool_calls' || s === 'tool_call' || s === 'function_call') return 'tool-call';
  return 'other';
}

/* ─── core.openwop.ai.chat-completion ──────────────────────── */

export async function chatCompletion(ctx) {
  ensureCallAI(ctx);
  const { provider, model, systemPrompt, temperature, maxTokens, stopSequences } = ctx.config;
  const { messages } = ctx.inputs;

  const result = await ctx.callAI({
    provider,
    model,
    messages,
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(stopSequences !== undefined ? { stopSequences } : {}),
  });

  return {
    status: 'success',
    outputs: {
      content: result.content ?? '',
      usage: result.usage ?? { inputTokens: 0, outputTokens: 0 },
      finishReason: normalizeFinishReason(result.finishReason),
      ...(result.model ? { model: result.model } : {}),
    },
  };
}

/* ─── core.openwop.ai.structured-output ─────────────────────── */

/**
 * Validate `data` against the JSON schema using a minimal recursive
 * shape-checker. We can't pull in Ajv (zero-deps pack) so we rely on
 * the host's callAI to do strict schema-conformance — providers with
 * native structured-output APIs (Anthropic tool-use, OpenAI JSON
 * mode, Gemini response_schema) handle this server-side. The retry
 * loop here covers the case where the provider returns valid JSON
 * that nonetheless doesn't match the requested schema (less common
 * with native APIs; common with prompt-engineered JSON via raw chat
 * completion).
 *
 * We compare ONLY at the structural level: required keys present,
 * types align. Deep semantic validation is the host's job.
 */
function shallowSchemaCheck(data, schema) {
  if (!schema || typeof schema !== 'object') return true;
  if (schema.type) {
    const actualType = Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data;
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.includes(actualType)) return false;
  }
  if (schema.required && Array.isArray(schema.required) && data && typeof data === 'object' && !Array.isArray(data)) {
    for (const k of schema.required) if (!(k in data)) return false;
  }
  return true;
}

export async function structuredOutput(ctx) {
  ensureCallAI(ctx);
  const {
    provider, model, systemPrompt, temperature, maxTokens,
    outputSchema, retryOnInvalidJson = 2,
  } = ctx.config;
  const { messages } = ctx.inputs;

  let retries = 0;
  let lastErr = null;

  while (retries <= retryOnInvalidJson) {
    const result = await ctx.callAI({
      provider,
      model,
      messages,
      responseSchema: outputSchema,
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    });

    const data = result.data;
    if (data === undefined) {
      lastErr = 'host returned no `data` field — provider may not support structured output';
    } else if (!shallowSchemaCheck(data, outputSchema)) {
      lastErr = 'data did not match outputSchema (shallow structural check failed)';
    } else {
      return {
        status: 'success',
        outputs: {
          data,
          usage: result.usage ?? { inputTokens: 0, outputTokens: 0 },
          ...(result.model ? { model: result.model } : {}),
          retries,
        },
      };
    }
    retries++;
  }

  // Retries exhausted. Fail with a typed error so the executor can
  // surface it through the engine's error-envelope.
  throw Object.assign(
    new Error(`structured output invalid after ${retries} retries: ${lastErr}`),
    { code: 'structured_output_invalid' }
  );
}

/* ─── core.openwop.ai.embeddings ────────────────────────────── */

export async function embeddings(ctx) {
  ensureCallAI(ctx);
  const { provider, model, dimensions } = ctx.config;
  const { text } = ctx.inputs;

  const result = await ctx.callAI({
    provider,
    model,
    embeddingMode: true,
    messages: [{ role: 'user', content: text }],
    ...(dimensions !== undefined ? { dimensions } : {}),
  });

  const vector = result.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw Object.assign(
      new Error('host returned no `embedding` array — provider may not support embeddings'),
      { code: 'embeddings_unsupported' }
    );
  }

  return {
    status: 'success',
    outputs: {
      vector,
      dimensions: vector.length,
      model: result.model ?? model,
      ...(result.usage ? { usage: result.usage } : {}),
    },
  };
}

/* ─── Pack registry ─────────────────────────────────────────── */

/* ─── core.ai.toolCalling ────────────────────────────────────── */

/**
 * core.ai.toolCalling — invokes the LLM with a declared tool/function
 * set + lets the model emit tool calls. Routes through
 * ctx.callAIWithTools (a host extension above the base ctx.callAI;
 * required for hosts that want to advertise this typeId).
 *
 * Hosts without ctx.callAIWithTools refuse to register the pack at
 * peerDependency resolution time per spec/v1/node-packs.md. The
 * runtime throws `host_capability_missing` defensively in case the
 * resolver gate misfires.
 */
export async function toolCalling(ctx) {
  if (typeof ctx.callAIWithTools !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.callAIWithTools'),
      { code: 'host_capability_missing', capability: 'aiProviders.toolCalling' },
    );
  }
  const { provider, model, systemPrompt, temperature, maxTokens, tools, toolChoice } = ctx.config;
  const { messages } = ctx.inputs;

  const result = await ctx.callAIWithTools({
    provider,
    model,
    messages,
    tools,
    ...(toolChoice !== undefined ? { toolChoice } : {}),
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  });

  return {
    status: 'success',
    outputs: {
      content: result.content ?? '',
      toolCalls: Array.isArray(result.toolCalls) ? result.toolCalls : [],
      usage: result.usage ?? { inputTokens: 0, outputTokens: 0 },
      finishReason: normalizeFinishReason(result.finishReason),
      ...(result.model ? { model: result.model } : {}),
    },
  };
}

/* ─── Pack registry ─────────────────────────────────────────── */

export const nodes = {
  'core.ai.chatCompletion': chatCompletion,
  'core.ai.structuredOutput': structuredOutput,
  'core.ai.toolCalling': toolCalling,
  'core.openwop.ai.embeddings': embeddings,
};

export default nodes;
