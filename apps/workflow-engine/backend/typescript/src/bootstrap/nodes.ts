/**
 * NodeModule registration. One-shot at boot.
 *
 * Registers the minimal set of `core.*` node types the sample executor
 * dispatches inline + the demo pack's `local.sample.demo.uppercase`.
 *
 * Sample-grade — no MCP, no AI providers (those would require external
 * accounts). Real deployers wire `core.openwop.ai`, `core.openwop.mcp`,
 * `core.openwop.http` from the published packs.
 */

import { getNodeRegistry } from '../executor/nodeRegistry.js';
import type { NodeModule } from '../executor/types.js';
import { emitCost } from '../observability/costEmitter.js';
import { dispatchChat, type ChatMessage, type DispatchResult, type ProviderId } from '../providers/dispatch.js';
import { getDefaultModel } from '../providers/catalog.js';

const noopNode: NodeModule = {
  typeId: 'core.noop',
  version: '1.0.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    return { status: 'success', outputs: { ...inputs } };
  },
};

const delayNode: NodeModule = {
  typeId: 'core.delay',
  version: '1.0.0',
  async execute(ctx) {
    const ms = Math.max(0, Math.min(60_000, Number(ctx.config?.durationMs) || 0));
    await new Promise((r) => setTimeout(r, ms));
    return { status: 'success', outputs: { waitedMs: ms } };
  },
};

const approvalGateNode: NodeModule = {
  typeId: 'core.approvalGate',
  version: '1.0.0',
  async execute(ctx) {
    return {
      status: 'suspended',
      interrupt: {
        kind: 'approval',
        data: {
          prompt: ctx.config?.prompt ?? 'Please approve to continue.',
          actions: ctx.config?.actions ?? ['approve', 'reject'],
        },
      },
    };
  },
};

const clarificationGateNode: NodeModule = {
  typeId: 'core.clarificationGate',
  version: '1.0.0',
  async execute(ctx) {
    return {
      status: 'suspended',
      interrupt: {
        kind: 'clarification',
        data: {
          question: ctx.config?.question ?? 'Please clarify.',
          schema: ctx.config?.schema ?? { type: 'string' },
        },
      },
    };
  },
};

const VALID_KINDS = ['approval', 'clarification', 'refinement', 'cancellation'] as const;
type InterruptKind = (typeof VALID_KINDS)[number];
function coerceKind(raw: unknown): InterruptKind {
  return VALID_KINDS.includes(raw as InterruptKind) ? (raw as InterruptKind) : 'approval';
}

const interruptNode: NodeModule = {
  typeId: 'core.interrupt',
  version: '1.0.0',
  async execute(ctx) {
    return {
      status: 'suspended',
      interrupt: { kind: coerceKind(ctx.config?.kind), data: ctx.config?.data ?? {} },
    };
  },
};

// Mock AI node — demonstrates the cost-attribution pattern. Real
// deployers wire core.openwop.ai (published pack) which calls actual
// providers and records real token counts + USD via emitCost().
const sampleMockAiNode: NodeModule = {
  typeId: 'local.sample.demo.mock-ai',
  version: '0.1.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    const prompt = typeof inputs.prompt === 'string' ? inputs.prompt : '';
    // Simulated token accounting — real impls read from the provider response.
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = Math.max(8, Math.floor(promptTokens / 2));
    emitCost({
      provider: 'mock',
      model: 'mock-mini',
      promptTokens,
      completionTokens,
      // Mock pricing: $0.001/1k prompt, $0.002/1k completion.
      usdCost: (promptTokens * 0.001 + completionTokens * 0.002) / 1000,
    });
    return {
      status: 'success',
      outputs: { completion: `Mock response to: ${prompt.slice(0, 80)}` },
    };
  },
};

// Chat responder — dispatches to a real AI provider via raw fetch.
// Reads BYOK credentialRef from ctx.secrets, model/provider from inputs,
// and streams tokens via node.message events.
const sampleChatResponderNode: NodeModule = {
  typeId: 'local.sample.chat.responder',
  version: '0.1.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    const provider = (inputs.provider as ProviderId | undefined) ?? 'anthropic';
    const model = (inputs.model as string | undefined) ?? getDefaultModel(provider);
    const credentialRef = inputs.credentialRef as string | undefined;
    const messages = inputs.messages as ChatMessage[] | undefined;
    const maxTokens = typeof inputs.maxTokens === 'number' ? inputs.maxTokens : 1024;
    const webSearch = inputs.webSearch === true;

    if (!credentialRef) {
      return { status: 'failure', error: { code: 'credential_required', message: 'A credentialRef MUST be provided to dispatch a chat turn.' } };
    }
    const apiKey = ctx.secrets[credentialRef];
    if (!apiKey) {
      return { status: 'failure', error: { code: 'credential_unavailable', message: `Secret ${credentialRef} not resolved by host.` } };
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return { status: 'failure', error: { code: 'invalid_request', message: 'Field `messages` MUST be a non-empty array.' } };
    }

    try {
      const result = await dispatchChat({
        provider,
        model,
        apiKey,
        messages,
        maxTokens,
        webSearch,
        onDelta: async (delta) => {
          // Stream token deltas as node.message events. The executor's
          // ctx.emit strips any secret values from the payload before
          // append, so accidental key echoes from the provider don't
          // leak into the event log.
          await ctx.emit('node.message', { delta });
        },
      });
      emitCost({
        provider: result.provider,
        model: result.model,
        promptTokens: result.usage?.inputTokens,
        completionTokens: result.usage?.outputTokens,
      });
      if (result.completion.length === 0) {
        // Provider returned 200 but no text. Use the real provider-
        // reported diagnostic (finishReason, blockReason, safetyCategory)
        // when present; fall back to provider-specific heuristics.
        return {
          status: 'failure',
          error: {
            code: 'empty_completion',
            message: diagnoseEmptyCompletion(result),
          },
        };
      }
      return {
        status: 'success',
        outputs: {
          completion: result.completion,
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          ...(result.citations && result.citations.length > 0 ? { citations: result.citations } : {}),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'failure', error: { code: 'internal_error', message } };
    }
  },
};

const sampleUppercaseNode: NodeModule = {
  typeId: 'local.sample.demo.uppercase',
  version: '0.1.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    const text = typeof inputs.text === 'string' ? inputs.text : String(inputs.text ?? '');
    return { status: 'success', outputs: { text: text.toUpperCase() } };
  },
};

/**
 * Provider-specific diagnostic for the 200 OK + no text case.
 * Prefers REAL provider-reported reasons (finishReason / blockReason
 * / safetyCategory) over heuristic guesses.
 */
function diagnoseEmptyCompletion(result: DispatchResult): string {
  const { provider, model, finishReason, blockReason, safetyCategory, usage } = result;
  const tail = ` [provider=${provider} model=${model}` +
    (finishReason ? ` finishReason=${finishReason}` : '') +
    (blockReason ? ` blockReason=${blockReason}` : '') +
    (safetyCategory ? ` safety=${safetyCategory}` : '') +
    (usage?.outputTokens != null ? ` outputTokens=${usage.outputTokens}` : '') +
    ']';

  // Authoritative reasons first.
  if (blockReason) {
    return `Prompt blocked by ${provider} (${blockReason}). Rephrase the prompt or check for sensitive content.${tail}`;
  }
  if (safetyCategory) {
    return `Output blocked by ${provider} safety filter (${safetyCategory}). Try rephrasing.${tail}`;
  }
  if (finishReason === 'MAX_TOKENS' || finishReason === 'length' || finishReason === 'max_tokens') {
    return `Model hit max-tokens before emitting visible text. Raise maxTokens (currently 4096) or switch to a model with a larger output cap.${tail}`;
  }
  if (finishReason === 'SAFETY' || finishReason === 'content_filter') {
    return `Output blocked by safety/content filter. Try rephrasing the prompt.${tail}`;
  }
  if (finishReason === 'RECITATION') {
    return `Output blocked because it matched training-data recitation. Rephrase to encourage paraphrasing.${tail}`;
  }
  if (finishReason === 'STOP' || finishReason === 'stop' || finishReason === 'end_turn') {
    // STOP + zero output is an oddity — most likely an internal-reasoning model
    // exhausted its budget before the visible-output phase started.
    if (provider === 'google' && model.includes('2.5-') && !model.includes('-lite')) {
      return `Gemini ${model} stopped cleanly with zero visible text. Most likely cause: internal reasoning consumed the maxOutputTokens budget before the visible-output phase began. Try \`gemini-2.5-flash-lite\` (no reasoning) or raise maxTokens >= 8192.${tail}`;
    }
    return `Provider stopped cleanly with zero visible text. Could be a model-side filter, an empty system-prompt edge case, or a tool-only response without text.${tail}`;
  }

  // No finishReason at all — likely a stream that terminated early (network
  // failure, server-side timeout) or a parsing bug.
  return `Provider returned 200 OK with no text and no finishReason. The stream may have terminated early, or the response shape didn't match what the dispatcher parses.${tail}`;
}

let registered = false;

export function ensureNodesRegistered(): void {
  if (registered) return;
  const registry = getNodeRegistry();
  registry.register(noopNode);
  registry.register(delayNode);
  registry.register(approvalGateNode);
  registry.register(clarificationGateNode);
  registry.register(interruptNode);
  registry.register(sampleUppercaseNode);
  registry.register(sampleMockAiNode);
  registry.register(sampleChatResponderNode);
  registered = true;
}
