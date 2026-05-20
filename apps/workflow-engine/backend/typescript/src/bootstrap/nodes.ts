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
import type { NodeContext, NodeModule } from '../executor/types.js';
import { emitCost } from '../observability/costEmitter.js';
import { dispatchChat, type ChatMessage, type DispatchResult, type ProviderId } from '../providers/dispatch.js';
import { dispatchAnthropicWithTools, type ToolDef } from '../providers/dispatchAnthropicTools.js';
import { getDefaultModel } from '../providers/catalog.js';
import {
  dispatchManagedChat,
  isManagedCredentialRef,
  managedProviderIdFromRef,
  ManagedProviderError,
} from '../providers/managedProvider.js';
import { dispatchSubRun, type SubRunResult } from '../subruns/subRunDispatcher.js';
import { registerMockAgentNode } from './conformanceMockAgent.js';

const noopNode: NodeModule = {
  typeId: 'core.noop',
  version: '1.0.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    return { status: 'success', outputs: { ...inputs } };
  },
};

/** Identity passthrough — copies every input port to a same-named
 *  output port. Used by `conformance-identity` to assert that
 *  `inputs.{var}` from POST /v1/runs round-trips to
 *  `RunSnapshot.variables.{var}`. The output→variable plumbing
 *  happens in the executor; this node's only job is to be present so
 *  the run reaches terminal `completed`. Behaviorally indistinguishable
 *  from `core.noop` today; preserved as a distinct typeId because the
 *  fixture catalog (and conformance/fixtures.md) names it explicitly. */
const identityNode: NodeModule = {
  typeId: 'core.identity',
  version: '1.0.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    return { status: 'success', outputs: { ...inputs } };
  },
};

/** RFC 0022 §A+§B — sub-workflow dispatch primitive. Spawns a child
 *  run, applies inputMapping at dispatch + outputMapping on terminal,
 *  returns childRunId + childStatus. The actual spawn-and-wait logic
 *  lives in `executor/subWorkflowDispatcher.ts` so the node module
 *  doesn't need direct access to RunRecord storage. */
const subWorkflowNode: NodeModule = {
  typeId: 'core.subWorkflow',
  version: '1.0.0',
  async execute(ctx) {
    const cfg = (ctx.config ?? {}) as {
      workflowId?: unknown;
      inputMapping?: unknown;
      outputMapping?: unknown;
      waitForCompletion?: unknown;
      onChildFailure?: unknown;
    };
    const childWorkflowId = typeof cfg.workflowId === 'string' ? cfg.workflowId : '';
    if (!childWorkflowId) {
      return { status: 'failure', error: { code: 'invalid_request', message: 'core.subWorkflow requires config.workflowId' } };
    }
    const inputMapping = (cfg.inputMapping && typeof cfg.inputMapping === 'object' && !Array.isArray(cfg.inputMapping))
      ? (cfg.inputMapping as Record<string, string>)
      : undefined;
    const outputMapping = (cfg.outputMapping && typeof cfg.outputMapping === 'object' && !Array.isArray(cfg.outputMapping))
      ? (cfg.outputMapping as Record<string, string>)
      : undefined;
    const onChildFailure = cfg.onChildFailure === 'continue' ? 'continue' : 'fail-parent';

    const { dispatchSubWorkflow } = await import('../executor/subWorkflowDispatcher.js');
    try {
      const result = await dispatchSubWorkflow({
        parentRunId: ctx.runId,
        parentTenantId: ctx.tenantId,
        ...(ctx.scopeId ? { parentScopeId: ctx.scopeId } : {}),
        parentNodeId: ctx.nodeId,
        childWorkflowId,
        ...(inputMapping ? { inputMapping } : {}),
        ...(outputMapping ? { outputMapping } : {}),
        onChildFailure,
      });
      if (result.childStatus !== 'completed' && onChildFailure === 'fail-parent') {
        return {
          status: 'failure',
          error: {
            code: 'subworkflow_child_failed',
            message: `child run ${result.childRunId} terminated ${result.childStatus}`,
          },
        };
      }
      return {
        status: 'success',
        outputs: {
          childRunId: result.childRunId,
          childStatus: result.childStatus,
          outputMappingSkipped: result.outputMappingSkipped,
        },
      };
    } catch (err) {
      return {
        status: 'failure',
        error: {
          code: 'internal_error',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  },
};

/** Per `channels-and-reducers.md §append + §TTL`: append a
 *  `{value, _ts}` entry to the named channel (modeled as a workflow
 *  variable storing an array). When `ttlMs > 0`, drop existing
 *  entries whose `_ts < now - ttlMs` BEFORE appending — the TTL is
 *  a write-time filter, not a read-time one. */
const channelWriteNode: NodeModule = {
  typeId: 'core.channelWrite',
  version: '1.0.0',
  async execute(ctx) {
    const cfg = (ctx.config ?? {}) as { channelName?: unknown; reducer?: unknown; ttlMs?: unknown; value?: unknown };
    const channelName = typeof cfg.channelName === 'string' ? cfg.channelName : '';
    if (!channelName) {
      return { status: 'failure', error: { code: 'invalid_request', message: 'core.channelWrite requires config.channelName' } };
    }
    const reducer = typeof cfg.reducer === 'string' ? cfg.reducer : 'append';
    const ttlMs = typeof cfg.ttlMs === 'number' && cfg.ttlMs > 0 ? cfg.ttlMs : 0;
    const now = Date.now();
    // Dynamic import to avoid bootstrap import cycle.
    const { snapshotRunVariables, setRunVariable } = await import('../host/variablesRuntime.js');
    const bag = snapshotRunVariables(ctx.runId) ?? {};
    const existing = Array.isArray(bag[channelName]) ? (bag[channelName] as Array<{ value: unknown; _ts: number }>) : [];
    let kept = existing;
    if (ttlMs > 0) {
      const cutoff = now - ttlMs;
      kept = existing.filter((e) => typeof e?._ts === 'number' && e._ts >= cutoff);
    }
    if (reducer === 'append') {
      kept = [...kept, { value: cfg.value, _ts: now }];
    } else if (reducer === 'replace') {
      kept = [{ value: cfg.value, _ts: now }];
    }
    setRunVariable(ctx.runId, channelName, kept);
    return { status: 'success', outputs: { channelName, size: kept.length } };
  },
};

const delayNode: NodeModule = {
  typeId: 'core.delay',
  version: '1.0.0',
  async execute(ctx) {
    // Support three input sources, in precedence order:
    //   1. ctx.inputs.delayMs — fixture-shape input port resolved by
    //      the executor from a variable reference (e.g.,
    //      conformance-cancellable seeds delayMs=30000 via its
    //      variable bag, which the executor resolves into the input
    //      port).
    //   2. ctx.config.durationMs — legacy direct config (sample
    //      workflows that hard-code the delay).
    //   3. 0 — safe default.
    // The 60s cap stays — the sample isn't a long-running daemon.
    const inputs = (ctx.inputs ?? {}) as Record<string, unknown>;
    const fromInput = typeof inputs.delayMs === 'number' ? inputs.delayMs : Number(inputs.delayMs);
    const fromConfig = Number(ctx.config?.durationMs);
    const fromConfigShort = Number((ctx.config as { ms?: unknown } | undefined)?.ms);
    const raw = Number.isFinite(fromInput) ? fromInput
      : (Number.isFinite(fromConfig) ? fromConfig
      : (Number.isFinite(fromConfigShort) ? fromConfigShort : 0));
    const ms = Math.max(0, Math.min(60_000, raw));
    await new Promise((r) => setTimeout(r, ms));
    return { status: 'success', outputs: { waitedMs: ms } };
  },
};

/** Deterministic-failure node — terminates with `status: 'failed'`
 *  every time. Inverse of `core.noop`. Conformance fixtures use this
 *  to exercise downstream paths (e.g., RFC 0022 §B "outputMapping is
 *  SKIPPED when child terminates failed/cancelled" — HVMAP-1b-failed). */
const failNode: NodeModule = {
  typeId: 'core.fail',
  version: '1.0.0',
  async execute(ctx) {
    const code = String(ctx.config?.code ?? 'deterministic_fail');
    const message = String(ctx.config?.message ?? 'core.fail node terminated deterministically');
    return { status: 'failure', error: { code, message } };
  },
};

const approvalGateNode: NodeModule = {
  typeId: 'core.approvalGate',
  version: '1.0.0',
  async execute(ctx) {
    const cfg = (ctx.config ?? {}) as {
      prompt?: unknown;
      title?: unknown;
      description?: unknown;
      actions?: unknown;
      requiredApprovals?: unknown;
      rejectionPolicy?: unknown;
      approversList?: unknown;
    };
    return {
      status: 'suspended',
      interrupt: {
        kind: 'approval',
        // Forward quorum config into interrupt.data so the resolve
        // handler can read requiredApprovals + rejectionPolicy per
        // `interrupt-profiles.md §openwop-interrupt-quorum`. The
        // resolver's `recordQuorumVote` only activates when
        // requiredApprovals > 1; single-approver gates stay on the
        // immediate-resume path.
        data: {
          prompt: typeof cfg.prompt === 'string' ? cfg.prompt : (typeof cfg.title === 'string' ? cfg.title : 'Please approve to continue.'),
          actions: Array.isArray(cfg.actions) ? cfg.actions : ['approve', 'reject'],
          ...(typeof cfg.requiredApprovals === 'number' ? { requiredApprovals: cfg.requiredApprovals } : {}),
          ...(typeof cfg.rejectionPolicy === 'string' ? { rejectionPolicy: cfg.rejectionPolicy } : {}),
          ...(Array.isArray(cfg.approversList) ? { approversList: cfg.approversList } : {}),
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
//
// Tool calling: when inputs.tools is a non-empty array of
// {workflowId, name, description}, the node routes anthropic dispatch
// through `dispatchAnthropicWithTools` and lets the model invoke saved
// workflows as tools. Each tool_use dispatches a sub-run via
// `dispatchSubRun` with a 30s budget; the result (or a "pending" stub
// if it hits an interrupt) feeds back as tool_result.
/**
 * Resolve `agent.reasoned` verbosity per `capabilities.md` precedence:
 *   per-run `RunOptions.configurable.reasoningVerbosity`
 *   > host capability default (advertised in /.well-known/openwop)
 *   > suite default (default arg)
 * Returns the resolved verbosity along with `agent.reasoning.delta` +
 * `agent.reasoned` emission callbacks bound to `ctx` and `agentId`.
 *
 * The callbacks are `undefined` when resolved verbosity is `'off'` —
 * the dispatcher's optional spread (`...(cb ? { cb } : {})`) skips
 * registration entirely in that case, so the provider's server-side
 * thinking surface stays disabled too.
 *
 * SR-1 redaction: `ctx.emit` routes every payload through
 * `stripSecretsFromPersisted` (executor.ts:emit). Any host-resolved
 * credential the model echoes into reasoning is redacted before the
 * event lands in the log. See `SECURITY/threat-model-secret-leakage.md`.
 */
function buildReasoningCallbacks(
  ctx: NodeContext,
  agentId: string,
  defaultVerbosity: 'summary' | 'full' | 'off',
): {
  verbosity: 'summary' | 'full' | 'off';
  onReasoningDelta?: (delta: string) => Promise<void>;
  onReasoningBlock?: (block: string) => Promise<void>;
} {
  const reqVerbosity = ctx.configurable?.reasoningVerbosity;
  const verbosity: 'summary' | 'full' | 'off' =
    reqVerbosity === 'off' || reqVerbosity === 'full' || reqVerbosity === 'summary'
      ? reqVerbosity
      : defaultVerbosity;
  if (verbosity === 'off') return { verbosity };
  // RFC 0024: per-block sequence counter. Resets to 0 on each closed
  // block so consumers can detect dropped deltas within a block without
  // global cross-block bookkeeping.
  let seq = 0;
  return {
    verbosity,
    onReasoningDelta: async (delta: string): Promise<void> => {
      await ctx.emit('agent.reasoning.delta', { agentId, delta, sequence: seq, verbosity });
      seq++;
    },
    onReasoningBlock: async (block: string): Promise<void> => {
      // Closing event carries the full content (truncated under
      // 'summary'). Per RFC 0024, this event is authoritative even
      // if it disagrees with the delta concatenation.
      const reasoning = verbosity === 'summary' ? block.slice(0, 2048) : block;
      await ctx.emit('agent.reasoned', { agentId, reasoning, verbosity });
      seq = 0;
    },
  };
}

/**
 * Sample chat-responder. Sits in the `vendor.openwop-sample.*` namespace
 * per `spec/v1/node-packs.md` §"Reserved-typeIds" (the unrestricted
 * carve-out), which puts it inside RFC 0023 §A's authorized-emitter
 * scope for `agent.reasoned` events.
 */
const sampleChatResponderNode: NodeModule = {
  typeId: 'vendor.openwop-sample.chat-responder',
  version: '0.2.0',
  async execute(ctx) {
    const inputs = (ctx.inputs && typeof ctx.inputs === 'object') ? (ctx.inputs as Record<string, unknown>) : {};
    const provider = (inputs.provider as ProviderId | undefined) ?? 'anthropic';
    const model = (inputs.model as string | undefined) ?? getDefaultModel(provider);
    const credentialRef = inputs.credentialRef as string | undefined;
    const messages = inputs.messages as ChatMessage[] | undefined;
    const maxTokens = typeof inputs.maxTokens === 'number' ? inputs.maxTokens : 1024;
    const webSearch = inputs.webSearch === true;
    const rawTools = Array.isArray(inputs.tools) ? (inputs.tools as ToolBinding[]) : [];

    if (!credentialRef) {
      return { status: 'failure', error: { code: 'credential_required', message: 'A credentialRef MUST be provided to dispatch a chat turn.' } };
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return { status: 'failure', error: { code: 'invalid_request', message: 'Field `messages` MUST be a non-empty array.' } };
    }

    // Managed-provider path: server-held key, per-tenant daily cap,
    // underlying provider hidden. The chat-responder short-circuits
    // BEFORE the standard ctx.secrets lookup so users never need a
    // BYOK row for managed providers.
    if (isManagedCredentialRef(credentialRef)) {
      const userFacingProvider = managedProviderIdFromRef(credentialRef);
      // Managed-tile agentId hides the underlying model (e.g.
      // 'openwop-free-assistant', NOT 'minimax-assistant'). Matches the
      // dispatchManagedChat result-rewriting boundary.
      const agentId = `${userFacingProvider}-assistant`;
      const { onReasoningDelta, onReasoningBlock } = buildReasoningCallbacks(ctx, agentId, 'full');

      try {
        const onDelta = async (delta: string) => {
          await ctx.emit('node.message', { delta });
        };
        const managed = await dispatchManagedChat({
          userFacingProvider,
          tenantId: ctx.tenantId,
          messages: messages as ChatMessage[],
          maxTokens,
          onDelta,
          ...(onReasoningDelta ? { onReasoningDelta } : {}),
          ...(onReasoningBlock ? { onReasoningBlock } : {}),
        });
        emitCost({
          provider: managed.provider,
          model: managed.model,
          promptTokens: managed.usage?.inputTokens,
          completionTokens: managed.usage?.outputTokens,
        });
        if (managed.completion.length === 0) {
          return {
            status: 'failure',
            error: {
              code: 'empty_completion',
              message: 'Free tier returned no content. Try again or pick a different provider.',
            },
          };
        }
        return {
          status: 'success',
          outputs: {
            completion: managed.completion,
            provider: managed.provider,
            model: managed.model,
            usage: managed.usage,
          },
        };
      } catch (err) {
        if (err instanceof ManagedProviderError) {
          return { status: 'failure', error: { code: err.code, message: err.message } };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { status: 'failure', error: { code: 'internal_error', message } };
      }
    }

    const apiKey = ctx.secrets[credentialRef];
    if (!apiKey) {
      return { status: 'failure', error: { code: 'credential_unavailable', message: `Secret ${credentialRef} not resolved by host.` } };
    }

    // Tool mode is gated to Anthropic for v1; OpenAI/Google have
    // their own tool-call wire shapes and we keep the dispatcher
    // surface minimal until there's demand.
    const useTools = rawTools.length > 0 && provider === 'anthropic';
    const toolBindings = useTools ? validateToolBindings(rawTools) : [];

    // BYOK agentId reveals the actual provider+model — by design.
    // Managed-tile hides the underlying model (`openwop-free-assistant`);
    // BYOK users picked their own model so honesty wins over uniformity.
    const byokAgentId = `${provider}-${model}-assistant`.slice(0, 256);
    const { verbosity: byokVerbosity, onReasoningDelta: byokOnReasoningDelta, onReasoningBlock: byokOnReasoningBlock } =
      buildReasoningCallbacks(ctx, byokAgentId, 'full');

    try {
      const onDelta = async (delta: string) => {
        await ctx.emit('node.message', { delta });
      };
      let result: DispatchResult;
      if (useTools) {
        const toolDefs: ToolDef[] = toolBindings.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: { type: 'object', additionalProperties: true },
        }));
        const bindingByName = new Map(toolBindings.map((t) => [t.name, t]));
        result = await dispatchAnthropicWithTools({
          provider: 'anthropic',
          model,
          apiKey,
          messages,
          maxTokens,
          onDelta,
          tools: toolDefs,
          onToolUse: async (use) => {
            const binding = bindingByName.get(use.name);
            if (!binding) {
              return {
                toolUseId: use.id,
                content: `tool_not_found: ${use.name}`,
                isError: true,
              };
            }
            // Emit a structured event for the UI to render its own
            // tool-use card (favored over the dispatcher's inline
            // Markdown breadcrumb).
            await ctx.emit('node.tool_use', {
              toolUseId: use.id,
              name: use.name,
              workflowId: binding.workflowId,
              input: use.input,
            });
            const subResult = await dispatchSubRun({
              workflowId: binding.workflowId,
              inputs: use.input,
              budgetMs: 30_000,
              tenantId: ctx.tenantId,
              ...(ctx.scopeId ? { scopeId: ctx.scopeId } : {}),
            });
            await ctx.emit('node.tool_result', {
              toolUseId: use.id,
              name: use.name,
              status: subResult.status,
              ...(subResult.status === 'completed' ? { output: subResult.output } : {}),
              ...(subResult.status === 'failed' ? { error: subResult.error } : {}),
              ...(subResult.status !== 'completed' && 'runId' in subResult ? { runId: subResult.runId } : {}),
            });
            return {
              toolUseId: use.id,
              content: formatSubRunResult(subResult),
              isError: subResult.status === 'failed',
            };
          },
        });
      } else {
        result = await dispatchChat({
          provider,
          model,
          apiKey,
          messages,
          maxTokens,
          webSearch,
          onDelta,
          reasoningVerbosity: byokVerbosity,
          ...(byokOnReasoningDelta ? { onReasoningDelta: byokOnReasoningDelta } : {}),
          ...(byokOnReasoningBlock ? { onReasoningBlock: byokOnReasoningBlock } : {}),
        });
      }
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

interface ToolBinding {
  workflowId: string;
  name: string;
  description: string;
}

function validateToolBindings(raw: unknown[]): ToolBinding[] {
  const out: ToolBinding[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    if (typeof rec.workflowId !== 'string') continue;
    if (typeof rec.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(rec.name)) continue;
    if (typeof rec.description !== 'string') continue;
    out.push({ workflowId: rec.workflowId, name: rec.name, description: rec.description });
  }
  return out;
}

function formatSubRunResult(r: SubRunResult): string {
  if (r.status === 'completed') {
    try {
      return typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
    } catch {
      return String(r.output);
    }
  }
  if (r.status === 'pending') {
    return JSON.stringify({
      status: 'pending',
      runId: r.runId,
      message: `Workflow is still running or waiting on an interrupt after the ${r.budgetMs}ms tool budget. Tell the user they can resume it at /runs/${r.runId}.`,
    });
  }
  return JSON.stringify({
    status: 'failed',
    runId: r.runId,
    error: r.error,
  });
}

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
  registry.register(identityNode);
  registry.register(subWorkflowNode);
  // RFC: conformance-only typeId for runtime-capability refusal test.
  // Declares `requires` pointing at a capability the host never
  // provides. The executor's pre-execute capability check refuses
  // with `capability_not_provided`. Production deployments SHOULD
  // skip this registration (same posture as core.conformance.mock-agent).
  registry.register({
    typeId: 'conformance.requiresMissing',
    version: '1.0.0',
    requires: ['conformance.never-provided'],
    async execute() {
      // Unreachable: the host's capability check fails before this runs.
      return { status: 'success', outputs: {} };
    },
  });
  registry.register(channelWriteNode);
  registry.register(delayNode);
  registry.register(failNode);
  registry.register(approvalGateNode);
  registry.register(clarificationGateNode);
  registry.register(interruptNode);
  registry.register(sampleUppercaseNode);
  registry.register(sampleMockAiNode);
  registry.register(sampleChatResponderNode);
  // RFC 0023 — conformance-only typeId for agent-event emission hooks.
  // Reference host always registers it; production deployments of this
  // codebase SHOULD remove this call + drop the
  // capabilities.conformance.mockAgent advertisement.
  registerMockAgentNode();
  registered = true;
}
