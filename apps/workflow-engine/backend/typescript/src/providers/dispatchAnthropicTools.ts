/**
 * Multi-turn Anthropic dispatch with tools.
 *
 * Non-streaming for simplicity — Anthropic streams tool_use blocks
 * across many delta events and reassembling them is messy. With tools
 * enabled, the client sees the visible-text portion in one chunk
 * after each tool round; without tools we keep the streaming path
 * in `dispatch.ts`.
 *
 * Loop: model returns `tool_use` → caller's `onToolUse` runs → reply
 * built with the assistant block + tool_result block → re-call. Stops
 * on `end_turn` or `max_tokens`, or after MAX_TOOL_ROUNDS to bound
 * runaway costs.
 */

import type { ChatMessage, ContentPart, DispatchRequest, DispatchResult } from './dispatch.js';

const MAX_TOOL_ROUNDS = 5;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolUseRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolUseResult {
  toolUseId: string;
  /** Content fed back to the model. Stringify JSON if structured. */
  content: string;
  isError?: boolean;
}

/** Tool-use block returned by `dispatchAnthropicToolsRound`. */
export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Single Anthropic round with tools. Used by `ctx.callAIWithTools`
 * — the spec contract is one-shot per the pack's expectations
 * (the pack orchestrates the tool loop at the workflow level by
 * returning `toolCalls[]` as outputs).
 */
export interface ToolsRoundRequest {
  model: string;
  apiKey: string;
  messages: readonly ChatMessage[];
  maxTokens?: number;
  tools: readonly ToolDef[];
  /** Optional abort signal so callers can time-bound the request. */
  signal?: AbortSignal;
}

export interface ToolsRoundResult {
  text: string;
  toolUses: ToolUseBlock[];
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ToolsDispatchRequest extends DispatchRequest {
  tools: readonly ToolDef[];
  onToolUse(req: ToolUseRequest): Promise<ToolUseResult>;
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export async function dispatchAnthropicWithTools(req: ToolsDispatchRequest): Promise<DispatchResult> {
  const systemMessage = req.messages.find((m) => m.role === 'system');
  const initial = req.messages.filter((m) => m.role !== 'system');

  // Build the running message log. Start from the FE-supplied history;
  // each tool round appends an assistant + user(tool_result) pair.
  const log: AnthropicMessage[] = initial.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: contentToText(m.content),
  }));

  let aggregatedText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: string | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
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
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        ...(systemMessage ? { system: contentToText(systemMessage.content) } : {}),
        messages: log,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`anthropic_${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      content?: AnthropicContentBlock[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (data.usage?.input_tokens) inputTokens += data.usage.input_tokens;
    if (data.usage?.output_tokens) outputTokens += data.usage.output_tokens;
    finishReason = data.stop_reason;

    const blocks = data.content ?? [];
    const toolUses = blocks.filter((b): b is Extract<AnthropicContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    const textBlocks = blocks.filter((b): b is Extract<AnthropicContentBlock, { type: 'text' }> => b.type === 'text');

    // Emit any visible text from this round as a single delta so the
    // chat bubble still updates round-by-round.
    for (const tb of textBlocks) {
      if (tb.text) {
        aggregatedText += tb.text;
        await req.onDelta?.(tb.text);
      }
    }

    if (toolUses.length === 0 || finishReason !== 'tool_use') {
      // Done — no more tool calls requested.
      break;
    }

    // Record the assistant turn (all blocks) verbatim so the API has
    // the matching tool_use IDs to pair with the upcoming tool_results.
    log.push({ role: 'assistant', content: blocks });

    // Execute every tool_use this round (Anthropic permits parallel).
    // The chat responder node emits structured `node.tool_use` /
    // `node.tool_result` events around each call so the UI renders
    // its own breadcrumb — this dispatcher no longer injects Markdown
    // into the visible text stream.
    const results: AnthropicContentBlock[] = [];
    for (const tu of toolUses) {
      let toolResult: ToolUseResult;
      try {
        toolResult = await req.onToolUse({ id: tu.id, name: tu.name, input: tu.input });
      } catch (err) {
        toolResult = {
          toolUseId: tu.id,
          content: `tool_dispatch_failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: toolResult.content,
        ...(toolResult.isError ? { is_error: true } : {}),
      });
    }
    log.push({ role: 'user', content: results });
  }

  return {
    provider: 'anthropic',
    model: req.model,
    completion: aggregatedText,
    usage: { inputTokens, outputTokens },
    ...(finishReason ? { finishReason } : {}),
  };
}

function contentToText(content: string | readonly ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/**
 * Single non-streaming Anthropic call with tools. Returns the model's
 * text + tool_use blocks; the caller (pack or chat responder) decides
 * what to do with them.
 */
export async function dispatchAnthropicToolsRound(req: ToolsRoundRequest): Promise<ToolsRoundResult> {
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
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
      ...(systemMessage ? { system: contentToText(systemMessage.content) } : {}),
      messages: conversation.map((m) => ({ role: m.role, content: contentToText(m.content) })),
    }),
    ...(req.signal ? { signal: req.signal } : {}),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anthropic_${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    content?: AnthropicContentBlock[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const blocks = data.content ?? [];
  const text = blocks
    .filter((b): b is Extract<AnthropicContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const toolUses = blocks
    .filter((b): b is Extract<AnthropicContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  return {
    text,
    toolUses,
    ...(data.stop_reason ? { finishReason: data.stop_reason } : {}),
    ...(data.usage?.input_tokens != null ? { inputTokens: data.usage.input_tokens } : {}),
    ...(data.usage?.output_tokens != null ? { outputTokens: data.usage.output_tokens } : {}),
  };
}
