/**
 * Multi-turn MiniMax dispatch with tools.
 *
 * MiniMax exposes an OpenAI-compatible Chat Completions endpoint that
 * supports the canonical `tools` + `tool_calls` shape. This module
 * mirrors `dispatchAnthropicWithTools.ts` exactly in surface area so
 * `bootstrap/nodes.ts` can swap dispatchers per-provider with a single
 * branch — same `ToolsDispatchRequest` shape in, same `DispatchResult`
 * shape out.
 *
 * Non-streaming for simplicity (the Anthropic tools path is also
 * non-streaming — reassembling tool_calls across SSE deltas is messy
 * and OpenAI's stream contract for tool_calls is fiddly). With tools
 * enabled the user sees text after each round; without tools we keep
 * the streaming path in `dispatch.ts > dispatchMiniMax`.
 *
 * Loop: model returns `tool_calls` → caller's `onToolUse` runs → reply
 * built with an assistant turn (carrying `tool_calls`) plus one
 * `role: 'tool'` message per call → re-send. Stops on
 * `finish_reason: 'stop'` (or absence of `tool_calls`), or after
 * MAX_TOOL_ROUNDS to bound runaway cost.
 */

import type { ChatMessage, ContentPart, DispatchResult } from './dispatch.js';
import type { ToolsDispatchRequest, ToolUseResult } from './dispatchAnthropicTools.js';

const MAX_TOOL_ROUNDS = 5;
const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimax.io/v1';

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIChoice {
  message: {
    role: 'assistant';
    content?: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason?: string | null;
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function contentToText(content: string | readonly ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function chatMessageToOpenAI(m: ChatMessage): OpenAIMessage {
  return { role: m.role as OpenAIMessage['role'], content: contentToText(m.content) };
}

export async function dispatchMiniMaxWithTools(req: ToolsDispatchRequest): Promise<DispatchResult> {
  const baseUrl = (process.env.MINIMAX_API_BASE_URL ?? MINIMAX_DEFAULT_BASE_URL).replace(/\/$/, '');

  // Running message log. System message stays at index 0 if present;
  // each tool round appends an assistant turn (with tool_calls) + one
  // role:'tool' message per call.
  const log: OpenAIMessage[] = req.messages.map(chatMessageToOpenAI);

  let aggregatedText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: string | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        messages: log,
        tools: req.tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })),
        tool_choice: 'auto',
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`minimax_${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as OpenAIResponse;
    if (data.usage?.prompt_tokens) inputTokens += data.usage.prompt_tokens;
    if (data.usage?.completion_tokens) outputTokens += data.usage.completion_tokens;

    const choice = data.choices?.[0];
    if (!choice) break;
    finishReason = choice.finish_reason ?? undefined;

    const text = choice.message.content ?? '';
    if (text) {
      aggregatedText += text;
      // Non-streaming round emits the whole visible-text chunk as a
      // single delta so the bubble updates between rounds.
      await req.onDelta?.(text);
    }

    const toolCalls = choice.message.tool_calls ?? [];
    if (toolCalls.length === 0 || finishReason === 'stop') {
      break;
    }

    // Append the assistant turn verbatim so the model has the matching
    // tool_call_ids when we send the tool results back next round.
    log.push({
      role: 'assistant',
      content: text || null,
      tool_calls: toolCalls,
    });

    // Execute every tool_call this round.
    for (const tc of toolCalls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        // Malformed JSON from the model — feed back an error tool
        // result so the model can correct itself on the next round.
        log.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `tool_input_invalid_json: ${tc.function.arguments.slice(0, 200)}`,
        });
        continue;
      }
      let toolResult: ToolUseResult;
      try {
        toolResult = await req.onToolUse({ id: tc.id, name: tc.function.name, input });
      } catch (err) {
        toolResult = {
          toolUseId: tc.id,
          content: `tool_dispatch_failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
      log.push({
        role: 'tool',
        tool_call_id: tc.id,
        // OpenAI-compatible tool messages don't have a separate
        // `is_error` flag; encode error condition in the content
        // string so the model can read + respond.
        content: toolResult.isError ? `tool_error: ${toolResult.content}` : toolResult.content,
      });
    }
  }

  return {
    provider: 'minimax',
    model: req.model,
    completion: aggregatedText,
    usage: { inputTokens, outputTokens },
    ...(finishReason ? { finishReason } : {}),
  };
}
