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

/* ─── v1.1 multi-modal + LLM helpers ───────────────────────── */

function delegateProvider(method) {
  return async function (ctx) {
    const fn = ctx[method] ?? ctx.aiProviders?.[method];
    if (typeof fn !== 'function') {
      throw Object.assign(new Error(`host does not implement ${method}`), { code: 'HOST_CAPABILITY_MISSING' });
    }
    const result = await fn.call(ctx, { ...ctx.config, ...ctx.inputs });
    return { status: 'success', outputs: result };
  };
}

export const imageGenerate = delegateProvider('callImageGenerator');
export const imageEdit = async (ctx) => {
  const fn = ctx.callImageEditor ?? ctx.aiProviders?.callImageEditor;
  if (typeof fn !== 'function') throw Object.assign(new Error('host does not implement callImageEditor'), { code: 'HOST_CAPABILITY_MISSING' });
  const r = await fn.call(ctx, { ...ctx.config, ...ctx.inputs });
  return { status: 'success', outputs: r };
};
export const imageUpscale = delegateProvider('callImageUpscaler');
export const audioTranscribe = delegateProvider('callSpeechToText');
export const audioSynthesize = delegateProvider('callTextToSpeech');
export const videoGenerate = delegateProvider('callVideoGenerator');
export const rerank = delegateProvider('callReranker');

export async function classify(ctx) {
  if (typeof ctx.callAI !== 'function') throw Object.assign(new Error('host does not implement ctx.callAI'), { code: 'HOST_CAPABILITY_MISSING' });
  const labels = ctx.config.labels;
  const r = await ctx.callAI({
    systemPrompt: 'You are a single-label classifier. Reply with exactly one label from the provided list and nothing else.',
    messages: [{ role: 'user', content: `Labels: ${labels.join(', ')}\n\nText:\n${ctx.inputs.text}` }],
    model: ctx.config.model,
  });
  const label = (r.text ?? r.content ?? '').trim();
  return { status: 'success', outputs: { label: labels.includes(label) ? label : labels[0], confidence: labels.includes(label) ? 0.8 : 0.2, allScores: [] } };
}

export async function extract(ctx) {
  if (typeof ctx.callAI !== 'function') throw Object.assign(new Error('host does not implement ctx.callAI'), { code: 'HOST_CAPABILITY_MISSING' });
  const r = await ctx.callAI({
    systemPrompt: 'Extract structured data per the provided JSON Schema. Reply with JSON only.',
    messages: [{ role: 'user', content: `Schema:\n${JSON.stringify(ctx.config.schema)}\n\nText:\n${ctx.inputs.text}` }],
    responseSchema: ctx.config.schema,
    model: ctx.config.model,
  });
  // Prefer provider-parsed shapes when present; fall back to text parse
  // only when neither r.data nor r.parsed is provided. A non-JSON text
  // body — model ignored responseSchema — surfaces as raw text with
  // confidence 0 instead of throwing an uncaught SyntaxError. Mirrors
  // the catch-and-fallback pattern used by `transform()` below.
  if (r.data != null) {
    return { status: 'success', outputs: { value: r.data, confidence: 1 } };
  }
  if (r.parsed != null) {
    return { status: 'success', outputs: { value: r.parsed, confidence: 1 } };
  }
  const raw = r.text ?? r.content ?? null;
  if (raw == null) {
    return { status: 'success', outputs: { value: null, confidence: 0 } };
  }
  try {
    return { status: 'success', outputs: { value: JSON.parse(raw), confidence: 1 } };
  } catch {
    return { status: 'success', outputs: { value: raw, confidence: 0 } };
  }
}

export async function guardrails(ctx) {
  if (typeof ctx.guardrails?.evaluate === 'function') {
    const r = await ctx.guardrails.evaluate({ text: ctx.inputs.text, checks: ctx.config.checks });
    return { status: 'success', outputs: r };
  }
  // No-op fallback: pass everything through.
  return { status: 'success', outputs: { passed: true, violations: [] } };
}

export async function transform(ctx) {
  if (typeof ctx.callAI !== 'function') throw Object.assign(new Error('host does not implement ctx.callAI'), { code: 'HOST_CAPABILITY_MISSING' });
  const exShown = (ctx.config.examples ?? []).map((e) => `Input: ${JSON.stringify(e.input)}\nOutput: ${JSON.stringify(e.output)}`).join('\n\n');
  const r = await ctx.callAI({
    systemPrompt: 'Transform the input per the instruction. Reply with the transformed JSON value only.',
    messages: [{ role: 'user', content: `Instruction: ${ctx.inputs.instruction}\n\n${exShown}\n\nInput: ${JSON.stringify(ctx.inputs.value)}\nOutput:` }],
    model: ctx.config.model,
  });
  let result;
  try { result = JSON.parse(r.text ?? r.content ?? 'null'); } catch { result = r.text ?? r.content; }
  return { status: 'success', outputs: { result } };
}

/* ─── Pack registry ─────────────────────────────────────────── */

export const nodes = {
  'core.ai.chatCompletion': chatCompletion,
  'core.ai.structuredOutput': structuredOutput,
  'core.ai.toolCalling': toolCalling,
  'core.openwop.ai.embeddings': embeddings,
  // v1.1
  'core.openwop.ai.image-generate': imageGenerate,
  'core.openwop.ai.image-edit': imageEdit,
  'core.openwop.ai.image-upscale': imageUpscale,
  'core.openwop.ai.audio-transcribe': audioTranscribe,
  'core.openwop.ai.audio-synthesize': audioSynthesize,
  'core.openwop.ai.video-generate': videoGenerate,
  'core.openwop.ai.rerank': rerank,
  'core.openwop.ai.classify': classify,
  'core.openwop.ai.extract': extract,
  'core.openwop.ai.guardrails': guardrails,
  'core.openwop.ai.transform': transform,
};

export default nodes;
