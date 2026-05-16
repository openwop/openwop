/**
 * AI provider dispatchers. Sample-grade — raw fetch to provider REST,
 * zero SDK deps. Two providers wired: Anthropic + OpenAI. Adding a
 * third = adding a row to PROVIDERS + a dispatcher function.
 *
 * Production deployers swap for the published `core.openwop.ai` pack
 * (which handles retries, error normalization, structured-output
 * envelopes, etc.) — see `core.openwop.ai/index.mjs`.
 */

export type ProviderId = 'anthropic' | 'openai' | 'google';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DispatchRequest {
  provider: ProviderId;
  model: string;
  apiKey: string;
  messages: readonly ChatMessage[];
  maxTokens?: number;
  /** Called for each streaming token chunk (text delta). */
  onDelta?: (delta: string) => void | Promise<void>;
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
}

export async function dispatchChat(req: DispatchRequest): Promise<DispatchResult> {
  switch (req.provider) {
    case 'anthropic':
      return dispatchAnthropic(req);
    case 'openai':
      return dispatchOpenAI(req);
    case 'google':
      return dispatchGoogle(req);
    default: {
      const exhaustive: never = req.provider;
      throw new Error(`Unknown provider: ${exhaustive as string}`);
    }
  }
}

// ── Anthropic Messages API ────────────────────────────────────────────
// https://docs.anthropic.com/en/api/messages-streaming

async function dispatchAnthropic(req: DispatchRequest): Promise<DispatchResult> {
  // Anthropic carries the system prompt as a top-level field, not in messages[].
  const systemMessage = req.messages.find((m) => m.role === 'system');
  const conversation = req.messages.filter((m) => m.role !== 'system');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      ...(systemMessage ? { system: systemMessage.content } : {}),
      messages: conversation.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`anthropic_${res.status}: ${errBody.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('anthropic_no_response_body');

  let completion = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: string | undefined;

  for await (const event of parseSseStream(res.body)) {
    if (event.event === 'content_block_delta') {
      try {
        const data = JSON.parse(event.data) as { delta?: { text?: string } };
        const delta = data.delta?.text;
        if (delta) {
          completion += delta;
          await req.onDelta?.(delta);
        }
      } catch {
        /* skip malformed chunk */
      }
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

  return {
    provider: 'anthropic',
    model: req.model,
    completion,
    usage: { inputTokens, outputTokens },
    ...(finishReason ? { finishReason } : {}),
  };
}

// ── OpenAI Chat Completions ──────────────────────────────────────────
// https://platform.openai.com/docs/api-reference/chat/streaming

async function dispatchOpenAI(req: DispatchRequest): Promise<DispatchResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`openai_${res.status}: ${errBody.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('openai_no_response_body');

  let completion = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: string | undefined;

  for await (const event of parseSseStream(res.body)) {
    if (event.data === '[DONE]') break;
    try {
      const data = JSON.parse(event.data) as {
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = data.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        completion += delta;
        await req.onDelta?.(delta);
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

  return {
    provider: 'openai',
    model: req.model,
    completion,
    usage: { inputTokens, outputTokens },
    ...(finishReason ? { finishReason } : {}),
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
  // (Flash + Pro). Flash-Lite doesn't have thinking — sending
  // thinkingConfig there is harmless but pointless. Pro/Flash with
  // thinking on can consume the entire maxOutputTokens budget on
  // reasoning; default to off for predictable chat streaming.
  const needsThinkingDisable =
    req.model.includes('2.5-') && !req.model.includes('-lite');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: conversation.map((m) => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }],
      })),
      ...(systemMessage ? { systemInstruction: { parts: [{ text: systemMessage.content }] } } : {}),
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 4096,
        ...(needsThinkingDisable ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
  });
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

  interface GeminiCandidate {
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
    safetyRatings?: Array<{ category?: string; blocked?: boolean; probability?: string }>;
  }
  interface GeminiSseData {
    candidates?: GeminiCandidate[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    promptFeedback?: { blockReason?: string; safetyRatings?: Array<{ category?: string; blocked?: boolean }> };
  }

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
        if (part.text) {
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

  return {
    provider: 'google',
    model: req.model,
    completion,
    usage: { inputTokens, outputTokens },
    ...(finishReason ? { finishReason } : {}),
    ...(blockReason ? { blockReason } : {}),
    ...(safetyCategory ? { safetyCategory } : {}),
  };
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
