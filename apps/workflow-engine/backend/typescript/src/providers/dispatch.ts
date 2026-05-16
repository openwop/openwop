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
        const data = JSON.parse(event.data) as { usage?: { output_tokens?: number } };
        outputTokens = data.usage?.output_tokens;
      } catch { /* */ }
    }
  }

  return {
    provider: 'anthropic',
    model: req.model,
    completion,
    usage: { inputTokens, outputTokens },
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

  for await (const event of parseSseStream(res.body)) {
    if (event.data === '[DONE]') break;
    try {
      const data = JSON.parse(event.data) as {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) {
        completion += delta;
        await req.onDelta?.(delta);
      }
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': req.apiKey,
    },
    body: JSON.stringify({
      contents: conversation.map((m) => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }],
      })),
      ...(systemMessage ? { systemInstruction: { parts: [{ text: systemMessage.content }] } } : {}),
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 4096,
        // Gemini 2.5 family uses internal reasoning tokens that count
        // against maxOutputTokens. With thinking on and a small budget,
        // the model can consume the entire budget on reasoning and emit
        // zero visible text. Disabled by default for predictable chat
        // streaming; production deployers re-enable per request.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`google_${res.status}: ${errBody.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('google_no_response_body');

  let completion = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  for await (const event of parseSseStream(res.body)) {
    try {
      const data = JSON.parse(event.data) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const parts = data.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.text) {
            completion += part.text;
            await req.onDelta?.(part.text);
          }
        }
      }
      if (data.usageMetadata) {
        inputTokens = data.usageMetadata.promptTokenCount;
        outputTokens = data.usageMetadata.candidatesTokenCount;
      }
    } catch {
      /* skip malformed chunk */
    }
  }

  return {
    provider: 'google',
    model: req.model,
    completion,
    usage: { inputTokens, outputTokens },
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
      // SSE messages are separated by \n\n
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const ev = parseSseMessage(part);
        if (ev) yield ev;
      }
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
