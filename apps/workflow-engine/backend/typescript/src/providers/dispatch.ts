/**
 * AI provider dispatchers. Sample-grade — raw fetch to provider REST,
 * zero SDK deps. Two providers wired: Anthropic + OpenAI. Adding a
 * third = adding a row to PROVIDERS + a dispatcher function.
 *
 * Production deployers swap for the published `core.openwop.ai` pack
 * (which handles retries, error normalization, structured-output
 * envelopes, etc.) — see `core.openwop.ai/index.mjs`.
 */

import { parseRefusal, type RefusalSignal } from '@openwop/openwop';
import { ThinkBlockSplitter } from './thinkBlockSplitter.js';
import { dispatchMock } from './dispatchMock.js';

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'minimax' | 'mock';

/** A single piece of content within a message. Mirrors the FE shape
 *  in src/chat/types.ts. `image`/`file` parts carry inline `dataBase64`
 *  by the time they reach a dispatcher — the chat-responder node resolves
 *  any host-`url` reference to bytes BEFORE dispatch (replay-safe + works
 *  for providers that can't fetch a relative host URL). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'audio'; mimeType: string; dataBase64: string; durationSeconds?: number }
  | { type: 'image'; mimeType: string; dataBase64?: string; url?: string; alt?: string }
  | { type: 'file'; mimeType: string; dataBase64?: string; url?: string; name?: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | readonly ContentPart[];
}

export interface DispatchRequest {
  provider: ProviderId;
  model: string;
  apiKey: string;
  messages: readonly ChatMessage[];
  maxTokens?: number;
  /** Enable provider-native web search for this turn. */
  webSearch?: boolean;
  /** Called for each streaming token chunk (text delta). */
  onDelta?: (delta: string) => void | Promise<void>;
  /** Called for each reasoning-content chunk emitted by reasoning models
   *  (e.g. MiniMax-M2.7 `<think>...</think>` blocks, Anthropic extended-
   *  thinking `thinking_delta` blocks, Gemini 2.5 `thought` parts).
   *  `delta` carries the new chunk of the currently-open block (live-
   *  streaming UX); empty when nothing new arrived this push.
   *  Providers / models that don't emit a reasoning channel never
   *  call this. */
  onReasoningDelta?: (delta: string) => void | Promise<void>;
  /** Called once per CLOSED reasoning block with the complete contents.
   *  Callers emit one `agent.reasoned` event per call. Fires AFTER all
   *  the block's `onReasoningDelta` calls. */
  onReasoningBlock?: (block: string) => void | Promise<void>;
  /** Resolved per-run reasoning verbosity (per `capabilities.md` §"agents
   *  reasoning"). Dispatchers use this to decide whether to opt into a
   *  provider's server-side thinking surface (Anthropic `thinking`
   *  parameter, Gemini `thinkingConfig`, etc.). When `'off'`, dispatchers
   *  MUST NOT enable thinking even if the model supports it — saves
   *  tokens and avoids surfacing reasoning the operator suppressed. */
  reasoningVerbosity?: 'summary' | 'full' | 'off';
  /** Optional abort signal so callers (e.g., the aiProviders host
   *  adapter's per-call timeout) can hard-abort the underlying fetch
   *  instead of leaving it dangling. */
  signal?: AbortSignal;
}

/** A normalized citation surfaced from a provider's web-search tool result. */
export interface Citation {
  title?: string;
  url: string;
  snippet?: string;
}

export interface DispatchResult {
  provider: ProviderId;
  model: string;
  completion: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  /** Provider-reported reason the stream stopped, when known.
   *  Gemini: STOP | MAX_TOKENS | SAFETY | RECITATION | OTHER
   *  OpenAI: stop | length | content_filter | tool_calls
   *  Anthropic: end_turn | max_tokens | stop_sequence | tool_use
   */
  finishReason?: string;
  /** Provider-side block reason (Gemini's `promptFeedback.blockReason`). */
  blockReason?: string;
  /** Safety category that tripped (Gemini's `safetyRatings[].category` of any blocked rating). */
  safetyCategory?: string;
  /** Normalized refusal signal per RFC 0032 §B.3, computed by routing a synthetic
   *  provider-shape response through `@openwop/openwop`'s `parseRefusal()` helper
   *  at the end of streaming. `undefined` means no refusal detected; a non-null
   *  signal means the caller MUST route through `envelope.refusal` emission +
   *  fail the node with `error.code = "envelope_refusal"` per RFC 0033 §F.
   *  refusalText (when set) MUST be passed through BYOK / prompt-content redaction
   *  before persistence per SECURITY/invariants.yaml §envelope-refusal-no-prompt-leak. */
  refusal?: RefusalSignal;
  /** Normalized citations from a web-search-enabled turn. Empty when search wasn't used. */
  citations?: readonly Citation[];
}

export async function dispatchChat(req: DispatchRequest): Promise<DispatchResult> {
  switch (req.provider) {
    case 'anthropic':
      return dispatchAnthropic(req);
    case 'openai':
      return dispatchOpenAI(req);
    case 'google':
      return dispatchGoogle(req);
    case 'minimax':
      return dispatchMiniMax(req);
    case 'mock':
      // Conformance-only provider — see `dispatchMock.ts`. Production
      // deployments MUST NOT route real tenants here; the mock provider
      // is reachable only when the calling node passed `provider: 'mock'`
      // (which the workflow-engine sample only allows for fixtures
      // running under `OPENWOP_TEST_SEAM_ENABLED=true`).
      return dispatchMock(req);
    default: {
      const exhaustive: never = req.provider;
      throw new Error(`Unknown provider: ${exhaustive as string}`);
    }
  }
}

/** Cap on per-call retry attempts under 429 rate-limit responses. Three
 *  total attempts (one initial + up to two retries) matches the chat-
 *  improvements plan §2B.3 — high enough to clear the transient bucket-
 *  refill spikes most providers exhibit, low enough that a hard-blocked
 *  caller doesn't sit in a backoff loop for tens of seconds. */
const RATE_LIMIT_MAX_ATTEMPTS = 3;

/** Parse `Retry-After` (seconds OR HTTP-date per RFC 9110 §10.2.3).
 *  Returns ms when known; null on bad/missing headers so callers fall
 *  back to exponential backoff. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    // Clamp so a buggy provider that emits Retry-After: 999999 can't
    // hang the whole turn beyond the dispatcher's outer 120s timeout.
    return Math.min(seconds * 1000, 60_000);
  }
  const epoch = Date.parse(trimmed);
  if (!Number.isFinite(epoch)) return null;
  return Math.max(0, Math.min(epoch - Date.now(), 60_000));
}

/** Cancellable sleep that aborts on the upstream signal so the per-call
 *  AbortController can still terminate the turn mid-backoff. */
async function delayAbortable(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) return;
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Wrap a fetch thunk with 429 backoff. Returns the FIRST non-429
 *  response, OR the last 429 response after the attempt cap is hit
 *  (the caller's `res.ok` check then throws the canonical
 *  `<provider>_429: <body>` error). Honors the upstream `Retry-After`
 *  header when present; falls back to exponential backoff (1s → 2s).
 *
 *  Per chat-improvements plan §2B.3 — caps retries at 3 attempts so a
 *  hard-blocked caller surfaces the failure promptly instead of
 *  silently absorbing the limit. */
async function fetchWith429Retry(
  thunk: () => Promise<Response>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt < RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
    const res = await thunk();
    if (res.status !== 429) return res;
    lastRes = res;
    if (attempt === RATE_LIMIT_MAX_ATTEMPTS - 1) break;
    const headerMs = parseRetryAfterMs(res.headers.get('Retry-After'));
    const backoffMs = headerMs ?? 1000 * Math.pow(2, attempt);
    // Drain the body before sleeping so the underlying socket can be
    // reused on retry (Undici/Node fetch otherwise holds the chunk).
    try { await res.body?.cancel(); } catch { /* */ }
    await delayAbortable(backoffMs, signal);
  }
  // Unreachable in practice — the loop always either returns a non-429
  // or breaks with `lastRes` set on the final attempt.
  return lastRes ?? new Response(null, { status: 429 });
}

// ── Anthropic Messages API ────────────────────────────────────────────
// https://docs.anthropic.com/en/api/messages-streaming

async function dispatchAnthropic(req: DispatchRequest): Promise<DispatchResult> {
  // Anthropic carries the system prompt as a top-level field, not in messages[].
  const systemMessage = req.messages.find((m) => m.role === 'system');
  const conversation = req.messages.filter((m) => m.role !== 'system');

  // Claude extended thinking. Opt-in via the `thinking` request
  // parameter — costs extra output tokens (the budget caps the spend).
  //
  // Default is 'off' so callers that don't explicitly request reasoning
  // (e.g. `aiProvidersHost.ts:dispatchPlain` from a workflow pack's
  // `ctx.callAI`) don't see a surprise bill regression. The chat-
  // responder's BYOK branch passes `reasoningVerbosity: 'full'` when
  // the run doesn't override, so the "Try it free" / BYOK chat surface
  // still gets thinking by default.
  //
  // Per https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking.
  // Regex matches the Claude 4 family today (claude-{opus,sonnet,haiku}-4*).
  // When Claude 5+ ships, widen to `[4-9]` or replace with a
  // `providers.json`-driven model-feature map.
  const thinkingEnabled =
    (req.reasoningVerbosity ?? 'off') !== 'off' && /^claude-(?:opus|sonnet|haiku)-[4-9]/.test(req.model);
  const thinkingBudget = 4000;

  const res = await fetchWith429Retry(() => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: req.model,
      // Thinking budget consumes the same output-tokens bucket; raise
      // the floor so visible text still has room when thinking is on.
      max_tokens: req.maxTokens ?? (thinkingEnabled ? 8192 : 4096),
      stream: true,
      ...(systemMessage ? { system: contentToText(systemMessage.content, 'Anthropic') } : {}),
      messages: conversation.map((m) => ({ role: m.role, content: contentToAnthropicBlocks(m.content) })),
      ...(thinkingEnabled ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } } : {}),
    }),
    ...(req.signal ? { signal: req.signal } : {}),
  }), req.signal);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`anthropic_${res.status}: ${errBody.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('anthropic_no_response_body');

  let completion = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: string | undefined;
  // Content-block tracker: when thinking is enabled, Anthropic streams
  // a `type: 'thinking'` block (followed by `thinking_delta` events)
  // BEFORE the `type: 'text'` block. Track the active block's index +
  // type so we route each delta correctly.
  const blockTypeByIndex = new Map<number, 'thinking' | 'text'>();
  const thinkingByIndex = new Map<number, string>();

  for await (const event of parseSseStream(res.body)) {
    if (event.event === 'content_block_start') {
      try {
        const data = JSON.parse(event.data) as {
          index?: number;
          content_block?: { type?: string };
        };
        const idx = data.index;
        const ty = data.content_block?.type;
        if (typeof idx === 'number' && (ty === 'thinking' || ty === 'text')) {
          blockTypeByIndex.set(idx, ty);
          if (ty === 'thinking') thinkingByIndex.set(idx, '');
        }
      } catch { /* */ }
    } else if (event.event === 'content_block_delta') {
      try {
        const data = JSON.parse(event.data) as {
          index?: number;
          delta?: { type?: string; text?: string; thinking?: string };
        };
        const idx = data.index;
        const dty = data.delta?.type;
        if (dty === 'text_delta' && data.delta?.text) {
          completion += data.delta.text;
          await req.onDelta?.(data.delta.text);
        } else if (dty === 'thinking_delta' && typeof data.delta?.thinking === 'string') {
          const chunk = data.delta.thinking;
          if (typeof idx === 'number') {
            thinkingByIndex.set(idx, (thinkingByIndex.get(idx) ?? '') + chunk);
          }
          await req.onReasoningDelta?.(chunk);
        }
      } catch { /* */ }
    } else if (event.event === 'content_block_stop') {
      try {
        const data = JSON.parse(event.data) as { index?: number };
        const idx = data.index;
        if (typeof idx === 'number' && blockTypeByIndex.get(idx) === 'thinking') {
          const block = thinkingByIndex.get(idx) ?? '';
          thinkingByIndex.delete(idx);
          if (block.length > 0) await req.onReasoningBlock?.(block);
        }
      } catch { /* */ }
    } else if (event.event === 'message_start') {
      try {
        const data = JSON.parse(event.data) as { message?: { usage?: { input_tokens?: number } } };
        inputTokens = data.message?.usage?.input_tokens;
      } catch { /* */ }
    } else if (event.event === 'message_delta') {
      try {
        const data = JSON.parse(event.data) as {
          usage?: { output_tokens?: number };
          delta?: { stop_reason?: string };
        };
        if (data.usage?.output_tokens != null) outputTokens = data.usage.output_tokens;
        if (data.delta?.stop_reason) finishReason = data.delta.stop_reason;
      } catch { /* */ }
    }
  }

  // Route through @openwop/openwop's parseRefusal() with a synthetic
  // Anthropic Messages shape. The helper catches stop_reason: 'refusal'
  // (their 2025 release) and extracts inline refusal text from
  // content[].text blocks when present.
  const refusal = parseRefusal({
    stop_reason: finishReason,
    content: completion.length > 0 ? [{ type: 'text', text: completion }] : [],
  }) ?? undefined;

  return {
    provider: 'anthropic',
    model: req.model,
    completion,
    usage: { inputTokens, outputTokens },
    ...(finishReason ? { finishReason } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

// ── OpenAI Chat Completions ──────────────────────────────────────────
// https://platform.openai.com/docs/api-reference/chat/streaming

async function dispatchOpenAI(req: DispatchRequest): Promise<DispatchResult> {
  const res = await fetchWith429Retry(() => fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      stream_options: { include_usage: true },
      messages: req.messages.map((m) => ({ role: m.role, content: contentToOpenAIBlocks(m.content) })),
    }),
    ...(req.signal ? { signal: req.signal } : {}),
  }), req.signal);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`openai_${res.status}: ${errBody.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('openai_no_response_body');

  let completion = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: string | undefined;
  // OpenAI's structured-output safety-filter surfaces refusals via
  // `choices[0].message.refusal` (streamed as `delta.refusal` chunks).
  // Accumulating these here so DispatchResult can carry the signal —
  // a non-empty refusalText is a stronger refusal indicator than
  // finish_reason: 'content_filter' alone, and the two CAN co-occur
  // with finish_reason: 'stop' on the modern API.
  let refusalText = '';
  // OpenAI-compatible endpoints (BYOK against DeepSeek-R1, qwen-think,
  // GLM-4-think, MiniMax) emit reasoning inline as `<think>...</think>`
  // in the content delta. The splitter is a no-op for models that
  // don't use this convention (OpenAI o1/GPT-5 reasoning is not
  // surfaced in the API at all — only via `usage.reasoning_tokens`).
  const splitter = new ThinkBlockSplitter();

  for await (const event of parseSseStream(res.body)) {
    if (event.data === '[DONE]') break;
    try {
      const data = JSON.parse(event.data) as {
        choices?: Array<{ delta?: { content?: string; refusal?: string }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = data.choices?.[0];
      const rawDelta = choice?.delta?.content;
      if (rawDelta) {
        const { visible, reasoningDelta, closedBlocks } = splitter.push(rawDelta);
        if (visible) {
          completion += visible;
          await req.onDelta?.(visible);
        }
        if (reasoningDelta) await req.onReasoningDelta?.(reasoningDelta);
        for (const block of closedBlocks) await req.onReasoningBlock?.(block);
      }
      const refusalDelta = choice?.delta?.refusal;
      if (typeof refusalDelta === 'string' && refusalDelta.length > 0) {
        refusalText += refusalDelta;
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (data.usage) {
        inputTokens = data.usage.prompt_tokens;
        outputTokens = data.usage.completion_tokens;
      }
    } catch {
      /* skip malformed chunk */
    }
  }
  const tail = splitter.flush();
  if (tail.visible) {
    completion += tail.visible;
    await req.onDelta?.(tail.visible);
  }

  // Route through @openwop/openwop's parseRefusal() — build a synthetic
  // post-stream OpenAI response shape from accumulated state. The helper
  // catches:
  //   - choices[0].message.refusal (modern structured-output safety filter,
  //     accumulated above into `refusalText`).
  //   - choices[0].finish_reason: 'content_filter' (legacy).
  // Either signal yields a typed RefusalSignal { refusalText, safetyCategory?, provider }.
  const refusal = parseRefusal({
    choices: [{
      message: {
        refusal: refusalText.length > 0 ? refusalText : undefined,
        content: completion,
      },
      finish_reason: finishReason,
    }],
  }) ?? undefined;

  return {
    provider: 'openai',
    model: req.model,
    completion,
    usage: { inputTokens, outputTokens },
    ...(finishReason ? { finishReason } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

// ── MiniMax (OpenAI-compatible chat completions) ─────────────────────
// International console: https://www.minimax.io/platform
// MiniMax exposes an OpenAI-shaped /v1/chat/completions endpoint, so
// the wire shape mirrors dispatchOpenAI exactly except for base URL.
// Base URL + default model id come from env so operators can swap
// regional endpoints (api.minimax.io vs api.minimaxi.com) without a
// code change.
//
// MiniMax-M2.7 (and any other reasoning model behind this dispatcher)
// emits a `<think>...</think>` block inline in the SSE stream before
// the final answer. `ThinkBlockStripper` filters those blocks out so
// users see only the visible response; the underlying reasoning never
// leaves the dispatcher. Imported at module top — see the top of this
// file for the rest of the imports.

const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimax.io/v1';

async function dispatchMiniMax(req: DispatchRequest): Promise<DispatchResult> {
  const baseUrl = (process.env.MINIMAX_API_BASE_URL ?? MINIMAX_DEFAULT_BASE_URL).replace(/\/$/, '');
  const res = await fetchWith429Retry(() => fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      stream_options: { include_usage: true },
      messages: req.messages.map((m) => ({ role: m.role, content: contentToText(m.content, 'MiniMax') })),
    }),
    ...(req.signal ? { signal: req.signal } : {}),
  }), req.signal);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`minimax_${res.status}: ${errBody.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('minimax_no_response_body');

  let completion = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: string | undefined;
  const splitter = new ThinkBlockSplitter();

  for await (const event of parseSseStream(res.body)) {
    if (event.data === '[DONE]') break;
    try {
      const data = JSON.parse(event.data) as {
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = data.choices?.[0];
      const rawDelta = choice?.delta?.content;
      if (rawDelta) {
        const { visible, reasoningDelta, closedBlocks } = splitter.push(rawDelta);
        if (visible) {
          completion += visible;
          await req.onDelta?.(visible);
        }
        if (reasoningDelta) {
          await req.onReasoningDelta?.(reasoningDelta);
        }
        for (const block of closedBlocks) {
          await req.onReasoningBlock?.(block);
        }
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (data.usage) {
        inputTokens = data.usage.prompt_tokens;
        outputTokens = data.usage.completion_tokens;
      }
    } catch {
      /* skip malformed chunk */
    }
  }
  const tail = splitter.flush();
  if (tail.visible) {
    completion += tail.visible;
    await req.onDelta?.(tail.visible);
  }

  // MiniMax is OpenAI-compatible — same parseRefusal route as dispatchOpenAI.
  // (MiniMax doesn't surface `message.refusal` today; this catches the
  // finish_reason: 'content_filter' branch + future-proofs against the
  // refusal field if they add it.)
  const refusal = parseRefusal({
    choices: [{
      message: { content: completion },
      finish_reason: finishReason,
    }],
  }) ?? undefined;

  return {
    provider: 'minimax',
    model: req.model,
    completion,
    usage: { inputTokens, outputTokens },
    ...(finishReason ? { finishReason } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

// ── Google Gemini (Generative Language API v1beta) ───────────────────
// https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent

async function dispatchGoogle(req: DispatchRequest): Promise<DispatchResult> {
  // Gemini's wire shape: system prompt is a top-level `systemInstruction`
  // field (not in messages[]), and the assistant role is `model` not
  // `assistant`. Multi-content "parts" array carries the message text.
  const systemMessage = req.messages.find((m) => m.role === 'system');
  const conversation = req.messages.filter((m) => m.role !== 'system');

  // Use ?key= query param (universal across Gemini surfaces) rather
  // than the x-goog-api-key header — fewer surfaces ignore it.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(req.apiKey)}`;

  // Thinking config only applies to the 2.5 reasoning models
  // (Flash + Pro). Flash-Lite doesn't have thinking.
  //
  // Default is 'off' so callers that don't explicitly request reasoning
  // (workflow-runtime `ctx.callAI` paths) don't see surprise extra
  // output tokens. Explicit opt-in via `reasoningVerbosity: 'full'`
  // (or 'summary') re-enables thinking. The original empty-completion
  // safety — thinking consuming the entire maxOutputTokens budget — is
  // preserved by the 8192-token floor on opt-in.
  const isReasoningModel =
    req.model.includes('2.5-') && !req.model.includes('-lite');
  const thinkingEnabled = isReasoningModel && (req.reasoningVerbosity ?? 'off') !== 'off';

  const res = await fetchWith429Retry(() => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: conversation.map((m) => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: contentToGeminiParts(m.content),
      })),
      ...(systemMessage ? { systemInstruction: { parts: contentToGeminiParts(systemMessage.content) } } : {}),
      // Native web search via Google's grounding tool. Each grounded
      // response is billed as a "grounded response" (~$35/1k) per
      // ai.google.dev/gemini-api/docs/pricing.
      ...(req.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? (thinkingEnabled ? 8192 : 4096),
        ...(isReasoningModel && !thinkingEnabled
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : thinkingEnabled
            ? { thinkingConfig: { includeThoughts: true } }
            : {}),
      },
    }),
    ...(req.signal ? { signal: req.signal } : {}),
  }), req.signal);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`google_${res.status}: ${errBody.slice(0, 500)}`);
  }
  if (!res.body) throw new Error('google_no_response_body');

  let completion = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: string | undefined;
  let blockReason: string | undefined;
  let safetyCategory: string | undefined;
  let chunkCount = 0;
  let lastRawChunk: string | undefined;

  interface GeminiGroundingChunk {
    web?: { uri?: string; title?: string };
  }
  interface GeminiPart {
    text?: string;
    /** Gemini 2.5 thinking: when this part is a thought (not visible
     *  answer), the `thought: true` flag distinguishes it. Requires
     *  `thinkingConfig.includeThoughts: true` in the request. */
    thought?: boolean;
  }
  interface GeminiCandidate {
    content?: { parts?: Array<GeminiPart> };
    finishReason?: string;
    safetyRatings?: Array<{ category?: string; blocked?: boolean; probability?: string }>;
    groundingMetadata?: {
      groundingChunks?: GeminiGroundingChunk[];
      webSearchQueries?: string[];
    };
  }
  interface GeminiSseData {
    candidates?: GeminiCandidate[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    promptFeedback?: { blockReason?: string; safetyRatings?: Array<{ category?: string; blocked?: boolean }> };
  }

  const citationsByUrl = new Map<string, Citation>();
  // Buffer thought content per response. Gemini doesn't surface
  // per-block boundaries in streaming (no equivalent of Anthropic's
  // `content_block_stop` or MiniMax's `</think>`). If a model emits
  // multiple thinking phases in one turn (rare), they collapse into
  // one `agent.reasoned` event at stream end. Acceptable v1 limitation
  // — consumers still see the full reasoning, just not segmented.
  let thoughtBuf = '';

  for await (const event of parseSseStream(res.body)) {
    chunkCount++;
    lastRawChunk = event.data;
    let data: GeminiSseData;
    try {
      data = JSON.parse(event.data) as GeminiSseData;
    } catch {
      continue;
    }

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (!part.text) continue;
        if (part.thought) {
          thoughtBuf += part.text;
          await req.onReasoningDelta?.(part.text);
        } else {
          completion += part.text;
          await req.onDelta?.(part.text);
        }
      }
    }
    if (candidate?.finishReason) {
      finishReason = candidate.finishReason;
    }
    if (candidate?.safetyRatings) {
      const blocked = candidate.safetyRatings.find((r) => r.blocked);
      if (blocked?.category) safetyCategory = blocked.category;
    }
    if (candidate?.groundingMetadata?.groundingChunks) {
      for (const chunk of candidate.groundingMetadata.groundingChunks) {
        const url = chunk.web?.uri;
        if (!url) continue;
        if (!citationsByUrl.has(url)) {
          citationsByUrl.set(url, { url, title: chunk.web?.title });
        }
      }
    }
    if (data.promptFeedback?.blockReason) {
      blockReason = data.promptFeedback.blockReason;
    }
    if (data.promptFeedback?.safetyRatings) {
      const blocked = data.promptFeedback.safetyRatings.find((r) => r.blocked);
      if (blocked?.category && !safetyCategory) safetyCategory = blocked.category;
    }
    if (data.usageMetadata) {
      inputTokens = data.usageMetadata.promptTokenCount;
      outputTokens = data.usageMetadata.candidatesTokenCount;
    }
  }

  // Diagnostic: when we parsed zero chunks OR got chunks but zero text,
  // log the response shape so the next debug iteration knows what to fix.
  if (chunkCount === 0 || completion.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[dispatch.google] empty/short response — diagnostic dump:', {
      model: req.model,
      chunkCount,
      completionLength: completion.length,
      finishReason,
      blockReason,
      safetyCategory,
      inputTokens,
      outputTokens,
      lastRawChunkPreview: lastRawChunk ? lastRawChunk.slice(0, 500) : '<no chunks>',
      responseStatus: res.status,
      responseHeaders: {
        'content-type': res.headers.get('content-type'),
        'content-length': res.headers.get('content-length'),
      },
    });
  }

  if (thoughtBuf.length > 0) {
    await req.onReasoningBlock?.(thoughtBuf);
  }

  const citations = Array.from(citationsByUrl.values());
  // Route through parseRefusal() with a synthetic Gemini-shape response.
  // The helper catches candidates[0].finishReason: 'SAFETY' | 'RECITATION'
  // and promptFeedback.blockReason. safetyCategory propagates onto the
  // RefusalSignal when surfaced.
  const refusal = parseRefusal({
    candidates: [{ finishReason }],
    promptFeedback: blockReason ? { blockReason, safetyRatings: safetyCategory ? [{ category: safetyCategory, blocked: true }] : [] } : undefined,
  }) ?? undefined;

  return {
    provider: 'google',
    model: req.model,
    completion,
    usage: { inputTokens, outputTokens },
    ...(finishReason ? { finishReason } : {}),
    ...(blockReason ? { blockReason } : {}),
    ...(safetyCategory ? { safetyCategory } : {}),
    ...(citations.length > 0 ? { citations } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

// ── Content-part converters (one per provider) ────────────────────────
//
// Every converter is FAIL-CLOSED: a part a provider can't represent in our
// supported API surface throws a clear, user-facing error so the responder
// node surfaces "this model can't read that attachment" rather than silently
// dropping it (the bug we saw in the MyndHyve reference). Text-like documents
// (.txt/.md/.json/.csv) are decoded and inlined as TEXT, so they work on every
// provider; images go to native vision blocks; PDFs go to native document
// blocks where supported (Anthropic, Gemini).

/** MIME types we inline as decoded UTF-8 text on every provider. */
const TEXT_FILE_MIME = new Set(['text/plain', 'text/markdown', 'application/json', 'text/csv']);

/** Decode a text-like `file` part to a UTF-8 string wrapped with a small
 *  header, or null when the part isn't a text-like file. */
function asInlinedText(part: ContentPart): string | null {
  if (part.type !== 'file' || !TEXT_FILE_MIME.has(part.mimeType)) return null;
  if (!part.dataBase64) throw new Error('attachment bytes unavailable (file not resolved before dispatch)');
  const body = Buffer.from(part.dataBase64, 'base64').toString('utf8');
  const label = part.name ? `Attached file "${part.name}"` : 'Attached file';
  return `\n\n[${label} (${part.mimeType})]\n${body}\n`;
}

/** The base64 bytes of an image/PDF `file`/`image` part, or throw fail-closed
 *  if the part was never resolved to inline bytes. */
function requireBytes(part: ContentPart): string {
  if ((part.type === 'image' || part.type === 'file') && part.dataBase64) return part.dataBase64;
  throw new Error('attachment bytes unavailable (not resolved before dispatch)');
}

function unsupported(providerLabel: string, part: ContentPart): Error {
  const kind = part.type === 'file' ? `file (${(part as { mimeType?: string }).mimeType ?? 'unknown'})` : part.type;
  return new Error(
    `${providerLabel} can't accept ${kind} attachments in this sample. ` +
    'Images need a vision model (Anthropic, Gemini, or an OpenAI vision model); ' +
    'PDFs need Anthropic or Gemini; text files (.txt/.md/.json/.csv) work everywhere. ' +
    'Switch models and retry, or remove the attachment.',
  );
}

/** Flatten ContentPart[] → text-only string for providers/messages that take
 *  a plain string (Anthropic `system`, MiniMax). Text + text-like files pass
 *  through; image/audio/PDF parts throw fail-closed. */
export function contentToText(content: string | readonly ContentPart[], providerLabel: string): string {
  if (typeof content === 'string') return content;
  let out = '';
  for (const part of content) {
    if (part.type === 'text') { out += part.text; continue; }
    const inlined = asInlinedText(part);
    if (inlined !== null) { out += inlined; continue; }
    throw unsupported(providerLabel, part);
  }
  return out;
}

/** Anthropic Messages API content: a plain string when only text, else an
 *  array of content blocks (text / image / document). */
export function contentToAnthropicBlocks(content: string | readonly ContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;
  if (content.every((p) => p.type === 'text')) {
    return content.map((p) => (p as { text: string }).text).join('');
  }
  const blocks: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: part.mimeType, data: requireBytes(part) } });
    } else if (part.type === 'file' && part.mimeType === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: requireBytes(part) } });
    } else {
      const inlined = asInlinedText(part);
      if (inlined !== null) { blocks.push({ type: 'text', text: inlined }); continue; }
      throw unsupported('Anthropic', part);
    }
  }
  return blocks;
}

/** OpenAI Chat Completions content: a plain string when only text, else an
 *  array of parts (text / image_url). PDFs are NOT accepted on the Chat
 *  Completions content surface — fail-closed. */
export function contentToOpenAIBlocks(content: string | readonly ContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;
  if (content.every((p) => p.type === 'text')) {
    return content.map((p) => (p as { text: string }).text).join('');
  }
  const blocks: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image') {
      blocks.push({ type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${requireBytes(part)}` } });
    } else {
      const inlined = asInlinedText(part);
      if (inlined !== null) { blocks.push({ type: 'text', text: inlined }); continue; }
      throw unsupported('OpenAI', part);
    }
  }
  return blocks;
}

/** Convert a unified ContentPart[] (or string) to Gemini's `parts` format.
 *  Gemini accepts {text} + {inlineData: {mimeType, data}} parts; the
 *  audio formats it accepts include audio/wav, audio/mp3, audio/ogg,
 *  audio/flac, audio/aiff, audio/aac. webm/opus has spotty support so
 *  callers should record audio in a compatible format. Images + PDFs ride
 *  the same inlineData channel; text files inline as a {text} part. */
export function contentToGeminiParts(content: string | readonly ContentPart[]): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{ text: content }];
  const out: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === 'text') {
      out.push({ text: part.text });
    } else if (part.type === 'audio') {
      out.push({ inlineData: { mimeType: part.mimeType, data: part.dataBase64 } });
    } else if (part.type === 'image' || (part.type === 'file' && part.mimeType === 'application/pdf')) {
      out.push({ inlineData: { mimeType: part.mimeType, data: requireBytes(part) } });
    } else {
      const inlined = asInlinedText(part);
      if (inlined !== null) { out.push({ text: inlined }); continue; }
      throw unsupported('Gemini', part);
    }
  }
  return out;
}

// ── SSE parser (shared between providers) ────────────────────────────

interface SseEvent {
  event: string;
  data: string;
}

async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE messages are separated by \n\n (or \r\n\r\n on Windows-y
      // servers). Tolerate both — split on \n\n after normalizing.
      const normalized = buf.replace(/\r\n/g, '\n');
      const parts = normalized.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const ev = parseSseMessage(part);
        if (ev) yield ev;
      }
    }
    // Flush: many servers (Gemini included) terminate the stream
    // without a trailing \n\n, which would otherwise lose the LAST
    // chunk — exactly where finishReason + usageMetadata live.
    buf += decoder.decode();
    if (buf.trim().length > 0) {
      const ev = parseSseMessage(buf.replace(/\r\n/g, '\n'));
      if (ev) yield ev;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseMessage(raw: string): SseEvent | null {
  const lines = raw.split('\n').filter((l) => l.length > 0 && !l.startsWith(':'));
  if (lines.length === 0) return null;
  let event = 'message';
  const dataParts: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataParts.push(line.slice(5).trim());
  }
  if (dataParts.length === 0) return null;
  return { event, data: dataParts.join('\n') };
}
