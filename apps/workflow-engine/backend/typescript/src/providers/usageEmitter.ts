/**
 * RFC 0026 — `provider.usage` event emitter for the reference
 * workflow-engine.
 *
 * Pure-function helpers that extract usage data from each supported
 * provider's response shape and project it onto the canonical
 * `providerUsage` payload (per `schemas/run-event-payloads.schema.json
 * #/$defs/providerUsage`). The emitter site itself lives in
 * `providers/dispatch.ts` — it calls `ctx.emit('provider.usage',
 * payload)` after each provider invocation.
 *
 * Per RFC 0026 §B: emit BEFORE the corresponding `node.completed`.
 * Per RFC 0026 §D: payload MUST NOT carry credentialRef strings or
 * prompt/response substrings — this module's extract* functions read
 * ONLY the documented usage fields from each provider response.
 */

/** Canonical RFC 0026 `providerUsage` payload shape. */
export interface ProviderUsagePayload {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  costEstimateUsd?: number;
  currency?: string;
  cacheHit?: boolean;
  nodeId?: string;
  traceId?: string;
}

/** Static rate table for advisory `costEstimateUsd` computation.
 *  Conservative public-list-price snapshot — hosts SHOULD refresh
 *  periodically. Numbers are USD per 1M tokens, separated for input
 *  vs output. Returns undefined when the model isn't in the table
 *  (per RFC 0026 §A: hosts SHOULD omit rather than emit 0). */
const RATE_TABLE: Readonly<Record<string, { input: number; output: number }>> = {
  // Anthropic
  'claude-3-5-sonnet-20240620': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'o1-preview': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  // Google
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
};

function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const rate = RATE_TABLE[model];
  if (!rate) return undefined;
  // Rates are per-1M-tokens; cost = (inputTokens * inputRate + outputTokens * outputRate) / 1e6
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/** Extract Anthropic usage from a response. Anthropic returns
 *  `{ usage: { input_tokens, output_tokens } }`. */
export function extractAnthropicUsage(response: unknown, _model: string): { inputTokens: number; outputTokens: number } | null {
  if (!response || typeof response !== 'object') return null;
  const u = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  if (!u || typeof u.input_tokens !== 'number' || typeof u.output_tokens !== 'number') return null;
  return { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
}

/** Extract OpenAI usage. OpenAI returns
 *  `{ usage: { prompt_tokens, completion_tokens, total_tokens } }`. */
export function extractOpenAIUsage(response: unknown, _model: string): { inputTokens: number; outputTokens: number; totalTokens?: number } | null {
  if (!response || typeof response !== 'object') return null;
  const u = (response as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
  if (!u || typeof u.prompt_tokens !== 'number' || typeof u.completion_tokens !== 'number') return null;
  return {
    inputTokens: u.prompt_tokens,
    outputTokens: u.completion_tokens,
    ...(typeof u.total_tokens === 'number' ? { totalTokens: u.total_tokens } : {}),
  };
}

/** Extract Gemini usage. Gemini returns
 *  `{ usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount } }`. */
export function extractGeminiUsage(response: unknown, _model: string): { inputTokens: number; outputTokens: number; totalTokens?: number } | null {
  if (!response || typeof response !== 'object') return null;
  const u = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }).usageMetadata;
  if (!u || typeof u.promptTokenCount !== 'number' || typeof u.candidatesTokenCount !== 'number') return null;
  return {
    inputTokens: u.promptTokenCount,
    outputTokens: u.candidatesTokenCount,
    ...(typeof u.totalTokenCount === 'number' ? { totalTokens: u.totalTokenCount } : {}),
  };
}

/** Build the canonical `providerUsage` payload from already-extracted
 *  token counts (the normalized shape `providers/dispatch.ts` returns
 *  to its callers). Use this at emission sites that consume
 *  `DispatchResult`-style values instead of the raw provider response.
 *
 *  Per RFC 0026 §D: the payload still MUST NOT carry credentialRef,
 *  prompt/response substrings, or tool call args/results. Callers
 *  passing `inputTokens` / `outputTokens` directly are inherently
 *  payload-free; this helper only adds `costEstimateUsd` from the
 *  static rate table.
 */
export function buildProviderUsagePayloadFromTokens(
  providerId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  opts: { totalTokens?: number; nodeId?: string; traceId?: string; cacheHit?: boolean } = {},
): ProviderUsagePayload {
  const totalTokens = opts.totalTokens ?? inputTokens + outputTokens;
  const costEstimateUsd = computeCostUsd(model, inputTokens, outputTokens);
  const payload: ProviderUsagePayload = {
    provider: providerId,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
  };
  if (costEstimateUsd !== undefined) {
    payload.costEstimateUsd = costEstimateUsd;
    payload.currency = 'USD';
  }
  if (opts.nodeId !== undefined) payload.nodeId = opts.nodeId;
  if (opts.traceId !== undefined) payload.traceId = opts.traceId;
  if (opts.cacheHit !== undefined) payload.cacheHit = opts.cacheHit;
  return payload;
}

/** Build the canonical `providerUsage` payload from a provider's response.
 *
 *  Per RFC 0026 §A:
 *  - `provider` + `model` + `inputTokens` + `outputTokens` are required.
 *  - `costEstimateUsd` is OPTIONAL; computed from a static rate table.
 *    Omitted when the model isn't in the table (don't guess).
 *  - The payload MUST NOT carry credentialRef, prompt/response substrings,
 *    or tool call args/results. This function reads ONLY from the
 *    response's `usage`/`usageMetadata` block — payload content is never
 *    referenced here.
 *
 *  @param providerId canonical id (`anthropic`/`openai`/`gemini`)
 *  @param model      provider-stamped model id
 *  @param response   the raw provider response
 *  @param opts       optional `nodeId` + `traceId` + `cacheHit` overrides */
export function buildProviderUsagePayload(
  providerId: string,
  model: string,
  response: unknown,
  opts: { nodeId?: string; traceId?: string; cacheHit?: boolean } = {},
): ProviderUsagePayload | null {
  let usage: { inputTokens: number; outputTokens: number; totalTokens?: number } | null = null;
  switch (providerId) {
    case 'anthropic':
      usage = extractAnthropicUsage(response, model);
      break;
    case 'openai':
      usage = extractOpenAIUsage(response, model);
      break;
    case 'gemini':
    case 'google':
      usage = extractGeminiUsage(response, model);
      break;
    default:
      return null;
  }
  if (!usage) return null;

  return buildProviderUsagePayloadFromTokens(providerId, model, usage.inputTokens, usage.outputTokens, {
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...opts,
  });
}
