/**
 * AI providers host adapter.
 *
 * Implements `ctx.callAI(...)` / `ctx.callAIWithTools(...)` per the
 * normative contract in `spec/v1/host-capabilities.md §host.aiProviders`.
 * The factory is per-call: the executor builds one adapter per node
 * dispatch, scoped to that run's (runId, nodeId, attempt) so the
 * invocation-log cache key is deterministic and replay-safe.
 *
 * The implementation is structured as a pipeline:
 *
 *   validate provider              ← `provider_not_supported`
 *     → resolve policy             ← `provider_policy_denied` (4 modes)
 *     → resolve credential         ← `byok_required_but_unresolved`
 *     → invocation-log lookup      (replay-deterministic cache)
 *     → dispatch (Anthropic/OpenAI/Google)
 *     → emit cost
 *     → cache result (sans secret)
 *     → return normalized AiCallResult
 *
 * SECURITY invariants enforced inline:
 *   - cleartext API keys NEVER cross the return boundary
 *   - cleartext API keys NEVER reach `ctx.emit()`
 *   - cleartext API keys NEVER reach the invocation-log cache
 *   - the return surface carries `credentialRefHashed: sha256(ref)`
 *     so callers can correlate without exposing the key
 *
 * @see spec/v1/host-capabilities.md §host.aiProviders
 * @see spec/v1/capabilities.md §"aiProviders policies" (lines 246-289)
 * @see spec/v1/replay.md §"AI determinism"
 */

import { createHash } from 'node:crypto';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type {
  AiCallRequest,
  AiCallResult,
  AiToolCallRequest,
  AiToolCallResult,
} from '../executor/types.js';
import type { AiProviderPolicy, ProviderPolicyResolver } from '../host/index.js';
import { dispatchChat, type ChatMessage, type ProviderId } from '../providers/dispatch.js';
import { dispatchAnthropicToolsRound } from '../providers/dispatchAnthropicTools.js';
import {
  dispatchManagedChat,
  isManagedCredentialRef,
  managedProviderIdFromRef,
  ManagedProviderError,
} from '../providers/managedProvider.js';
import { emitCost } from '../observability/costEmitter.js';
import { buildProviderUsagePayloadFromTokens } from '../providers/usageEmitter.js';
import { getInvocationLog } from '../executor/invocationLog.js';
import { createLogger } from '../observability/logger.js';
import { buildReasoningDirective } from '../host/envelopeDirective.js';
import { getEnvelopeReasoningConfig } from '../host/envelopeReasoningConfig.js';
import { getEnvelopeReliabilityConfig } from '../host/envelopeReliabilityConfig.js';
import {
  buildRetryAttemptedPayload,
  buildRetryExhaustedPayload,
  buildRefusalPayload,
  buildTruncatedPayload,
  classifyTruncationStopReason,
  isRefusalFinishReason,
  type RetryReason,
} from '../host/envelopeReliabilityEmit.js';

const log = createLogger('aiProviders.host');

/** Providers the sample's `providers/dispatch.ts` knows how to dispatch. */
// `mock` is conformance-only — present unconditionally so RFC 0032/0033
// test fixtures can route `provider: 'mock'` through dispatchStructured.
// Production deployments are unaffected; the mock provider returns only
// what the test seam pre-programs via `POST /v1/host/sample/test/mock-ai/
// program` keyed by (runId, nodeId), so a tenant that hasn't seeded a
// program for its run gets empty completions.
const SUPPORTED_PROVIDERS: readonly ProviderId[] = ['anthropic', 'openai', 'google', 'mock'];

/** Anthropic is the only provider with a wired tool-calling path
 *  (`providers/dispatchAnthropicTools.ts`). Advertised via
 *  `capabilities.aiProviders.toolCalling.providers` so packs that
 *  request tools on other providers fail with a clear, gated error. */
const TOOL_CALLING_PROVIDERS: readonly ProviderId[] = ['anthropic'];

/** Default per-call timeout for upstream provider requests. Bound by
 *  `AbortController` so a hung provider can't hang the run. */
const DEFAULT_TIMEOUT_MS = 120_000;

export interface AdapterScope {
  runId: string;
  nodeId: string;
  tenantId: string;
  scopeId?: string;
  attempt: number;
  secrets: Record<string, string>;
  policyResolver: ProviderPolicyResolver;
  /** Optional per-call timeout override. Defaults to 120s. */
  timeoutMs?: number;
  /**
   * RFC 0026 — `provider.usage` event emitter. When present, the adapter
   * fires one `provider.usage` event per upstream provider invocation
   * from inside `dispatchPlain` (so `dispatchStructured`'s parse-retry
   * loop produces one event per attempt). Invocation-log cache hits
   * return early in `callAI` before reaching the dispatch layer, so no
   * duplicate event is written — the original call's event was already
   * persisted on the first invocation and is available to SSE / webhook
   * subscribers and fork replay via `replay.md §"Forking + resumption"`.
   *
   * The cleartext credential is never read at the emission site.
   * Wired from the executor's per-node ctx so the event lands in the
   * same run event log with the same nodeId.
   */
  emit?: (type: string, payload: unknown) => Promise<{ eventId: string; sequence: number }>;
}

/** RFC 0026 — best-effort `provider.usage` emit. Swallows emit errors so
 *  a downstream event-log failure can't fail the LLM call itself; logs
 *  for visibility. Built from the normalized token counts that
 *  `dispatchChat`/`dispatchAnthropicToolsRound`/`dispatchManagedChat`
 *  return — credentialRef and prompt/response text are never touched. */
async function emitProviderUsage(
  scope: AdapterScope,
  provider: string,
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): Promise<void> {
  if (!scope.emit) return;
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return;
  try {
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    const payload = buildProviderUsagePayloadFromTokens(provider, model, inputTokens, outputTokens, {
      nodeId: scope.nodeId,
      ...(traceId ? { traceId } : {}),
    });
    await scope.emit('provider.usage', payload);
  } catch (err) {
    log.warn('provider.usage emit failed', { err: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Failure thrown by the adapter. Carries one of the 15 canonical
 * `aiProviders` error codes from `spec/v1/host-capabilities.md:141-154`.
 * The executor surfaces these to the caller as `node.failure` with the
 * `code` propagated.
 */
export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: AiProviderErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.code = code;
    this.details = details;
  }
}

export type AiProviderErrorCode =
  | 'provider_not_supported'
  | 'provider_policy_denied'
  | 'byok_required'
  | 'byok_required_but_unresolved'
  | 'model_not_supported'
  | 'model_not_allowed'
  | 'provider_unavailable'
  | 'provider_rate_limited'
  | 'provider_timed_out'
  | 'safety_filter'
  | 'content_filtered'
  | 'structured_output_invalid'
  | 'invalid_request'
  | 'host_capability_missing'
  | 'internal_error'
  // RFC 0033 §F — envelope-completion contract error codes.
  // `envelope_payload_invalid` (existing RFC 0021 code) covers schema-
  // violation-retry exhaustion; these two cover the new truncation +
  // refusal paths introduced by the RFC 0033 retry-routing distinction.
  | 'envelope_payload_invalid'
  | 'envelope_truncation_unrecoverable'
  | 'envelope_refused_by_provider';

/** Factory: build a per-call adapter for one node dispatch. */
export function createAiProvidersAdapter(scope: AdapterScope): {
  callAI(req: AiCallRequest): Promise<AiCallResult>;
  callAIWithTools(req: AiToolCallRequest): Promise<AiToolCallResult>;
} {
  return {
    callAI: (req) => callAI(scope, req),
    callAIWithTools: (req) => callAIWithTools(scope, req),
  };
}

// ── Core flow ─────────────────────────────────────────────────────

async function callAI(scope: AdapterScope, req: AiCallRequest): Promise<AiCallResult> {
  if (req.embeddingMode) {
    // Sample host does not implement embeddings — three new provider
    // endpoints unwired. Honest refusal per the advertised
    // `aiProviders.embeddings: false` capability.
    throw new AiProviderError(
      'host_capability_missing',
      'Sample host does not support embeddings (advertised aiProviders.embeddings: false).',
      { capability: 'aiProviders.embeddings' },
    );
  }

  // Managed-provider short-circuit. Bypasses policy + invocation-log
  // cache + BYOK resolution; the managed pipeline owns sign-in check,
  // daily cap, server-held-key lookup, and result rewriting. Replay
  // determinism does NOT apply: managed dispatch is for ad-hoc chat,
  // not workflow runs (which keep using BYOK).
  if (isManagedCredentialRef(req.credentialRef)) {
    return callAIManaged(scope, req);
  }

  assertProviderSupported(req.provider);
  await enforcePolicy(scope, req.provider, req.model, req.credentialRef);

  const { cleartext: credentialCleartext, refUsed } = resolveCredential(scope, req.provider, req.credentialRef);
  const credentialRefHashed = sha256Hex(refUsed);

  // Replay determinism: deterministic cache key. Defaults filled in
  // BEFORE hashing so `maxTokens: undefined` (caller omits) collapses
  // into the same key as `maxTokens: 4096` (dispatcher default) —
  // otherwise identical-effective requests double-spend the cache.
  // Note we hash the credentialRef alongside the request shape — the
  // cache value itself never contains the cleartext key.
  const providerKey = computeProviderKey({
    provider: req.provider,
    model: req.model,
    messages: req.messages,
    systemPrompt: req.systemPrompt ?? null,
    temperature: req.temperature ?? null,
    maxTokens: req.maxTokens ?? 4096,
    stopSequences: req.stopSequences ?? null,
    responseSchema: req.responseSchema ?? null,
    credentialRefHashed,
  });
  const cacheKey = {
    runId: scope.runId,
    nodeId: scope.nodeId,
    attempt: scope.attempt,
    providerKey,
  };
  const invocationLog = getInvocationLog();
  const cached = (await invocationLog.get(cacheKey)) as AiCallResult | null;
  if (cached) {
    log.debug('callAI: invocation-log cache hit', {
      runId: scope.runId,
      nodeId: scope.nodeId,
      provider: req.provider,
      model: req.model,
    });
    return { ...cached, credentialRefHashed };
  }

  const result = await wrapInSpan(scope, req.provider, req.model, async () => {
    if (req.responseSchema) {
      return dispatchStructured(scope, req, credentialCleartext);
    }
    return dispatchPlain(scope, req, credentialCleartext);
  });

  // Emit cost AFTER dispatch returns (real usage figures only).
  if (result.usage?.inputTokens != null || result.usage?.outputTokens != null) {
    emitCost({
      provider: req.provider,
      model: req.model,
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
    });
  }

  // RFC 0026 — `provider.usage` event(s) were already emitted from
  // inside `dispatchPlain` (one per upstream provider invocation,
  // including each attempt inside `dispatchStructured`'s parse-retry
  // loop). callAI does NOT re-emit here — that would either double-
  // count single calls or collapse N retry attempts into 1 event.

  // `result` from dispatch* never carries `credentialRefHashed`, so
  // caching `{...result}` is already secret-free. The hashed ref is
  // re-attached for the current return value below.
  await invocationLog.put(cacheKey, result);
  return { ...result, credentialRefHashed };
}

/**
 * Single-round tool-calling. The pack receives `toolCalls[]` from the
 * model and orchestrates execution at the workflow level (downstream
 * nodes run the tools; the workflow re-invokes the LLM with the
 * results in `messages`). This matches the published
 * `core.ai.toolCalling` pack's expected return shape.
 *
 * NOT cached: the model's `toolCalls[]` output is intentionally
 * non-deterministic across attempts when the pack iterates (different
 * tool results lead to different next-round queries). The pack-level
 * cache for the eventual final text is the workflow's invocationLog,
 * not this single round.
 */
async function callAIWithTools(scope: AdapterScope, req: AiToolCallRequest): Promise<AiToolCallResult> {
  assertProviderSupported(req.provider);
  if (!TOOL_CALLING_PROVIDERS.includes(req.provider)) {
    throw new AiProviderError(
      'host_capability_missing',
      `Tool calling not supported for provider "${req.provider}" in this sample (advertised aiProviders.toolCalling.providers: ['anthropic']).`,
      { provider: req.provider, capability: 'aiProviders.toolCalling' },
    );
  }
  await enforcePolicy(scope, req.provider, req.model, req.credentialRef);
  const { cleartext: credentialCleartext, refUsed } = resolveCredential(scope, req.provider, req.credentialRef);
  const credentialRefHashed = sha256Hex(refUsed);

  const result = await wrapInSpan(scope, req.provider, req.model, async () => {
    return mapDispatchErrors(req.provider, () =>
      runWithTimeout(scope, (signal) =>
        dispatchAnthropicToolsRound({
          model: req.model,
          apiKey: credentialCleartext,
          messages: toChatMessages(req),
          ...(req.maxTokens != null ? { maxTokens: req.maxTokens } : {}),
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
          signal,
        }),
      ),
    );
  });

  if (result.inputTokens != null || result.outputTokens != null) {
    emitCost({
      provider: req.provider,
      model: req.model,
      promptTokens: result.inputTokens,
      completionTokens: result.outputTokens,
    });
  }

  // RFC 0026 — emit `provider.usage` after the tool-calling round so
  // billing reconciliation captures per-call records inside multi-turn
  // tool flows. The pack orchestrates subsequent rounds; each round
  // re-enters this function and emits its own event.
  await emitProviderUsage(scope, req.provider, req.model, result.inputTokens, result.outputTokens);

  const aiResult: AiToolCallResult = {
    content: result.text,
    toolCalls: result.toolUses,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
    finishReason: normalizeFinishReason(result.finishReason),
    credentialRefHashed,
  };
  return aiResult;
}

async function callAIManaged(scope: AdapterScope, req: AiCallRequest): Promise<AiCallResult> {
  if (req.responseSchema || req.embeddingMode) {
    throw new AiProviderError(
      'host_capability_missing',
      'Managed provider supports plain chat only (no structured-output / embedding mode in this sample).',
      { capability: 'managed_provider.modes' },
    );
  }
  const userFacingProvider = managedProviderIdFromRef(req.credentialRef!);
  const credentialRefHashed = sha256Hex(req.credentialRef!);
  try {
    const managed = await dispatchManagedChat({
      userFacingProvider,
      tenantId: scope.tenantId,
      messages: toChatMessages(req),
      ...(req.maxTokens != null ? { maxTokens: req.maxTokens } : {}),
    });
    if (managed.usage?.inputTokens != null || managed.usage?.outputTokens != null) {
      emitCost({
        provider: managed.provider,
        model: managed.model,
        promptTokens: managed.usage.inputTokens,
        completionTokens: managed.usage.outputTokens,
      });
    }

    // RFC 0026 — managed-provider calls emit the same event shape so
    // tenants can reconcile against their server-held-key spend.
    await emitProviderUsage(scope, managed.provider, managed.model, managed.usage?.inputTokens, managed.usage?.outputTokens);

    return {
      content: managed.completion,
      ...(managed.usage ? { usage: managed.usage } : {}),
      finishReason: normalizeFinishReason(managed.finishReason),
      model: managed.model,
      credentialRefHashed,
    };
  } catch (err) {
    if (err instanceof ManagedProviderError) {
      // Map managed-pipeline errors to canonical aiProviders codes so
      // existing callers don't need to learn a new vocabulary.
      const code: AiProviderErrorCode =
        err.code === 'sign_in_required' ? 'byok_required'
          : err.code === 'daily_limit_reached' ? 'provider_rate_limited'
          : 'provider_unavailable';
      throw new AiProviderError(code, err.message, { managedCode: err.code });
    }
    throw err;
  }
}

// ── Pipeline stages ───────────────────────────────────────────────

function assertProviderSupported(provider: string): asserts provider is ProviderId {
  if (!SUPPORTED_PROVIDERS.includes(provider as ProviderId)) {
    throw new AiProviderError(
      'provider_not_supported',
      `Provider "${provider}" is not in the host's aiProviders.supported list.`,
      { provider, supported: SUPPORTED_PROVIDERS },
    );
  }
}

async function enforcePolicy(
  scope: AdapterScope,
  provider: string,
  model: string,
  credentialRef: string | undefined,
): Promise<void> {
  let policies: readonly AiProviderPolicy[];
  try {
    policies = await scope.policyResolver.resolveForRun({
      tenantId: scope.tenantId,
      ...(scope.scopeId ? { scopeId: scope.scopeId } : {}),
    });
  } catch (err) {
    // Per `capabilities.md:284`, resolver outage fails open to `optional`.
    log.warn('policy resolver failed; failing open to optional', {
      tenantId: scope.tenantId,
      ...(scope.scopeId ? { scopeId: scope.scopeId } : {}),
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  const policy = policies.find((p) => p.provider === provider) ?? { provider, mode: 'optional' as const };
  switch (policy.mode) {
    case 'disabled':
      throw new AiProviderError(
        'provider_policy_denied',
        `Provider "${provider}" is disabled by host policy.`,
        { provider, reason: 'provider_disabled' },
      );
    case 'required': {
      // A credential MUST be resolvable for this provider. Packs from
      // `core.openwop.ai` don't forward credentialRef through
      // `ctx.callAI`, so we ALSO accept the convention-lookup paths
      // (`secrets[provider]`, `secrets[<provider>-*]`, etc.). The
      // call still fails if NONE of these resolve.
      try {
        resolveCredential(scope, provider, credentialRef);
      } catch (err) {
        if (err instanceof AiProviderError) throw err;
        throw new AiProviderError(
          'byok_required',
          `Provider "${provider}" requires a BYOK credential and none is available.`,
          { provider, reason: 'byok_required' },
        );
      }
      break;
    }
    case 'restricted': {
      // Per `capabilities.md:285`: restricted with empty allowedModels MUST fail closed.
      const allowed = policy.allowedModels ?? [];
      if (allowed.length === 0 || !modelMatchesAllowlist(model, allowed)) {
        throw new AiProviderError(
          'model_not_allowed',
          `Model "${model}" not allowed by policy for provider "${provider}".`,
          { provider, model, reason: 'model_not_allowed', allowed },
        );
      }
      break;
    }
    case 'optional':
    default:
      break;
  }
}

/**
 * Resolve the cleartext API key for a request.
 *
 * Per `spec/v1/host-capabilities.md §host.aiProviders`, the pack does
 * NOT pass an opaque credentialRef — the host resolves credentials
 * internally from whatever `configurable.credentialRefs[]` mapped to
 * `ctx.secrets`. The pack only knows `provider` + `model`; the host
 * is responsible for naming convention.
 *
 * Lookup order:
 *   1. If the caller explicitly passed `credentialRef`, use it.
 *   2. Exact match: `secrets[provider]` (e.g., `secrets['anthropic']`).
 *   3. Prefix match: any key starting with `<provider>-` or `<provider>:`
 *      (e.g., `anthropic-tenant-acme`, `anthropic:prod`).
 *
 * If nothing matches, throw `byok_required` with the list of refs the
 * caller actually has (just the refs — NEVER the values).
 */
function resolveCredential(
  scope: AdapterScope,
  provider: string,
  credentialRef: string | undefined,
): { cleartext: string; refUsed: string } {
  // Conformance-only `mock` provider does not consult real BYOK — it
  // reads its program from an in-memory queue keyed by (runId, nodeId).
  // Return a sentinel so the BYOK check passes; the value is never
  // surfaced to the mock dispatcher (`dispatchMock` ignores apiKey).
  if (provider === 'mock') {
    return { cleartext: 'mock-no-credential', refUsed: 'mock' };
  }
  if (credentialRef) {
    const direct = scope.secrets[credentialRef];
    if (!direct) {
      throw new AiProviderError(
        'byok_required_but_unresolved',
        `BYOK credentialRef "${credentialRef}" did not resolve to a value.`,
        { reason: 'byok_required_but_unresolved' },
      );
    }
    return { cleartext: direct, refUsed: credentialRef };
  }
  const exact = scope.secrets[provider];
  if (exact) return { cleartext: exact, refUsed: provider };
  for (const [ref, value] of Object.entries(scope.secrets)) {
    if (ref.startsWith(`${provider}-`) || ref.startsWith(`${provider}:`)) {
      return { cleartext: value, refUsed: ref };
    }
  }
  throw new AiProviderError(
    'byok_required',
    `No credential available for provider "${provider}". The host looks up secrets[provider] then any secret prefixed with "${provider}-" or "${provider}:". Available refs: ${Object.keys(scope.secrets).join(', ') || '(none)'}.`,
    {
      provider,
      reason: 'no_default_credential',
      availableRefs: Object.keys(scope.secrets),
    },
  );
}

// ── Dispatch ──────────────────────────────────────────────────────

async function dispatchPlain(
  scope: AdapterScope,
  req: AiCallRequest,
  apiKey: string,
): Promise<AiCallResult> {
  const result = await mapDispatchErrors(req.provider, () =>
    runWithTimeout(scope, async (signal) => {
      const raw = await dispatchChat({
        provider: req.provider as ProviderId,
        model: req.model,
        apiKey,
        messages: toChatMessages(req),
        ...(req.maxTokens != null ? { maxTokens: req.maxTokens } : {}),
        signal,
        // RFC 0032/0033 — the conformance-only `mock` provider reads
        // its pre-programmed response queue keyed by `nodeId`. Real
        // providers ignore this extension field. See `dispatchMock.ts`.
        ...(req.provider === 'mock' ? { nodeId: scope.nodeId } : {}),
      } as Parameters<typeof dispatchChat>[0]);
      return {
        content: raw.completion,
        usage: {
          inputTokens: raw.usage?.inputTokens,
          outputTokens: raw.usage?.outputTokens,
        },
        finishReason: normalizeFinishReason(raw.finishReason),
        model: raw.model,
      };
    }),
  );
  // RFC 0026 §B: emit one `provider.usage` event per upstream provider
  // invocation. Located here (NOT at the `callAI` boundary) so that
  // `dispatchStructured`'s parse-retry loop — which calls dispatchPlain
  // up to STRUCTURED_OUTPUT_RETRIES + 1 times — emits one event per
  // attempt rather than collapsing N invocations into a single event.
  await emitProviderUsage(scope, req.provider, req.model, result.usage?.inputTokens, result.usage?.outputTokens);
  return result;
}

const STRUCTURED_OUTPUT_RETRIES = 2;

async function dispatchStructured(
  scope: AdapterScope,
  req: AiCallRequest,
  apiKey: string,
): Promise<AiCallResult> {
  // Append a JSON-only instruction to the system prompt so the model
  // emits parseable output. Real production hosts use provider-native
  // structured output (Anthropic tool-use, OpenAI response_format,
  // Gemini responseSchema). Sample-grade: prompt nudge + retry.
  const schemaHint = `Respond with a JSON object that matches this schema, with no preamble or trailing text: ${JSON.stringify(req.responseSchema)}`;
  // RFC 0030 §A: when the responseSchema declares a top-level `reasoning`
  // property AND the host's posture is `"advisory"` or `"mandatory"`,
  // append the reasoning-field directive after the schema-shape hint.
  // The two directives compose: the schema hint shapes the JSON; the
  // reasoning directive shapes the order-of-thought inside it. Mirrors
  // the staged composition pattern in spec/v1/ai-envelope.md §"Reasoning
  // field (normative)". Hosts MUST NOT reject envelopes where `reasoning`
  // is absent regardless of directive strength (RFC 0030 §A).
  const reasoningConfig = getEnvelopeReasoningConfig();
  const reasoningDirective = reasoningConfig.supported
    ? buildReasoningDirective(req.responseSchema, reasoningConfig.promptDirective)
    : null;
  const augmentedSystem = [req.systemPrompt, schemaHint, reasoningDirective]
    .filter((s): s is string => Boolean(s))
    .join('\n\n');

  // RFC 0032 §B + RFC 0033 §A — envelope-reliability emission + truncation-
  // vs-schema-violation retry routing. When `endToEndEnabled` is false the
  // host reverts to the legacy undifferentiated retry loop (no event emit,
  // no truncation-budget-doubling). Operator circuit-breaker.
  const reliabilityCfg = getEnvelopeReliabilityConfig();
  if (!reliabilityCfg.endToEndEnabled) {
    return dispatchStructuredLegacy(scope, req, apiKey, augmentedSystem);
  }

  // Per-attempt state. `lastFailure` tracks the prior attempt's classified
  // failure mode so the NEXT iteration can:
  //   (a) emit envelope.retry.attempted with the right `reason`
  //   (b) route truncation through the budget-doubling path WITHOUT a
  //       corrective fragment (RFC 0033 §B), OR keep the corrective fragment
  //       on schema-violation WITHOUT a budget change (RFC 0033 §C).
  let lastError: unknown = null;
  let lastFailureReason: RetryReason | null = null;
  let lastFailureMessage: string | undefined;
  // Mutate per-attempt: truncation retries DOUBLE maxTokens; schema-violation
  // retries keep the original budget. Starting maxTokens defaults to the
  // request value (provider-default behavior preserves prior semantics
  // when undefined). The dispatch helper's request shape uses `maxTokens`
  // as an optional field — see ChatRequest in providers/dispatch.ts.
  let currentMaxTokens: number | undefined = req.maxTokens;
  // Schema hint is suppressed on truncation retries — RFC 0033 §B forbids
  // applying a schema-correction fragment to truncation failures (the
  // shape was right; only the output was incomplete).
  let suppressSchemaHint = false;

  for (let attempt = 1; attempt <= reliabilityCfg.maxRetryAttempts; attempt++) {
    // Emit envelope.retry.attempted BEFORE the second-and-subsequent calls
    // per RFC 0032 §B.1 normative text. The first attempt does NOT emit.
    if (attempt > 1 && lastFailureReason !== null) {
      await scope.emit?.('envelope.retry.attempted',
        buildRetryAttemptedPayload(scope.nodeId, attempt, lastFailureReason, lastFailureMessage),
      ).catch((err) => {
        log.warn('envelope.retry.attempted emit failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Compose this attempt's system prompt. Truncation retries skip the
    // schema-shape hint (the previous attempt's shape was correct; only
    // the budget was insufficient).
    const systemForAttempt = suppressSchemaHint
      ? [req.systemPrompt, reasoningDirective].filter((s): s is string => Boolean(s)).join('\n\n')
      : augmentedSystem;
    const enrichedReq: AiCallRequest = {
      ...req,
      systemPrompt: systemForAttempt,
      ...(currentMaxTokens !== undefined ? { maxTokens: currentMaxTokens } : {}),
    };

    let raw: AiCallResult;
    try {
      raw = await dispatchPlain(scope, enrichedReq, apiKey);
    } catch (err) {
      lastError = err;
      lastFailureReason = 'parse-error';
      lastFailureMessage = err instanceof Error ? err.message : String(err);
      // Reset the truncation-suppression state for the next attempt —
      // a dispatch-layer error isn't truncation.
      suppressSchemaHint = false;
      continue;
    }

    // Per-attempt failure-mode classification. Refusal is checked first
    // (it's terminal — no retry); truncation second (drives budget-doubling
    // on next attempt); schema-violation last (drives corrective-fragment
    // retry per the existing path).
    const refusalDetected = isRefusalFinishReason(raw.finishReason);
    const truncationStopReason = classifyTruncationStopReason(raw.finishReason);

    if (refusalDetected) {
      // RFC 0032 §B.3 — emit envelope.refusal AND break the loop. Hosts
      // MUST NOT retry on refusal (circumvention concern per RFC 0033 §D).
      await scope.emit?.('envelope.refusal',
        buildRefusalPayload(
          scope.nodeId,
          req.provider,
          req.model,
          // `refusalText` is the provider's safety message when surfaced.
          // The mock provider populates raw.content with the refusal text;
          // production hosts extract from the provider response shape.
          // SR-1 redaction runs at the eventLog.append boundary in executor.ts
          // (stripSecretsFromPersisted), so canary substrings get scrubbed
          // before the payload lands in the durable event log.
          raw.content ?? null,
          // safetyCategory is provider-specific; the sample doesn't extract
          // it from the response. Production hosts populate from the
          // provider's safety-categories metadata block.
          null,
        ),
      ).catch((err) => {
        log.warn('envelope.refusal emit failed', { err: err instanceof Error ? err.message : String(err) });
      });
      throw new AiProviderError(
        'envelope_refused_by_provider',
        // Error message MUST NOT echo the refusal text per RFC 0033 §F +
        // SECURITY invariant envelope-refusal-no-prompt-leak. The refusal
        // text lives only on the event-log entry (redacted).
        `LLM provider returned an explicit refusal for ${req.provider}/${req.model}.`,
        { provider: req.provider, model: req.model },
      );
    }

    if (truncationStopReason !== null) {
      // RFC 0032 §B.4 — emit envelope.truncated. Compute partialPayload
      // signal by attempting parse on the truncated content; success here
      // is unusual but a model could emit valid partial JSON.
      let partialPayloadAvailable = false;
      try {
        if (raw.content && raw.content.length > 0) {
          JSON.parse(raw.content);
          partialPayloadAvailable = true;
        }
      } catch {
        partialPayloadAvailable = false;
      }
      await scope.emit?.('envelope.truncated',
        buildTruncatedPayload(
          scope.nodeId,
          req.provider,
          req.model,
          truncationStopReason,
          partialPayloadAvailable,
          raw.usage?.outputTokens ?? null,
        ),
      ).catch((err) => {
        log.warn('envelope.truncated emit failed', { err: err instanceof Error ? err.message : String(err) });
      });
      // RFC 0033 §B truncation retry path. Double the budget for the next
      // attempt; skip the schema-correction fragment (the shape was right).
      // Combined truncation + parse-failure is routed as truncation per
      // RFC 0033 §A priority rule — output budget is the upstream cause.
      lastError = new Error(`response truncated at finish_reason=${raw.finishReason}`);
      lastFailureReason = 'truncation';
      lastFailureMessage = `finish_reason=${raw.finishReason}; tokens=${raw.usage?.outputTokens ?? 'unknown'}`;
      const newBudget =
        currentMaxTokens !== undefined
          ? Math.min(currentMaxTokens * reliabilityCfg.truncationBudgetMultiplier, 64_000)
          : 4_000;
      currentMaxTokens = newBudget;
      suppressSchemaHint = true;
      continue;
    }

    // Clean-stop branch: parse + schema-validate. Schema-violation drives
    // the corrective-fragment retry per RFC 0033 §C (already in the
    // existing schemaHint composition).
    const text = raw.content ?? '';
    try {
      const data = JSON.parse(text);
      if (validateAgainstSchema(data, req.responseSchema)) {
        return {
          ...raw,
          content: undefined,
          data,
        };
      }
      lastError = new Error('structured output did not match required-key check');
      lastFailureReason = 'schema-violation';
      lastFailureMessage = 'required-key check failed';
      // RFC 0033 §C — keep the corrective schema hint; don't change budget.
      suppressSchemaHint = false;
    } catch (parseErr) {
      lastError = parseErr;
      lastFailureReason = 'parse-error';
      lastFailureMessage = parseErr instanceof Error ? parseErr.message : String(parseErr);
      // Parse-error also drives the corrective-fragment retry — the model
      // emitted text that wasn't valid JSON, which is a schema-shape problem
      // in spirit even when JSON.parse threw before the validator ran.
      suppressSchemaHint = false;
    }
  }

  // Retry budget exhausted. RFC 0032 §B.2 — emit envelope.retry.exhausted
  // BEFORE throwing. The error code distinguishes truncation-exhaustion
  // (envelope_truncation_unrecoverable per RFC 0033 §F) from schema-
  // violation-exhaustion (envelope_payload_invalid, the existing RFC 0021
  // code). Refusal path threw above and doesn't reach here.
  const finalReason: RetryReason = lastFailureReason ?? 'unknown';
  await scope.emit?.('envelope.retry.exhausted',
    buildRetryExhaustedPayload(scope.nodeId, reliabilityCfg.maxRetryAttempts, finalReason, lastFailureMessage),
  ).catch((err) => {
    log.warn('envelope.retry.exhausted emit failed', { err: err instanceof Error ? err.message : String(err) });
  });

  const errorCode =
    finalReason === 'truncation'
      ? 'envelope_truncation_unrecoverable'
      : 'envelope_payload_invalid';
  const errorMessage =
    finalReason === 'truncation'
      ? `Provider truncated the structured-output emission across ${reliabilityCfg.maxRetryAttempts} attempts; truncation-retry budget exhausted (RFC 0033 §B + §F).`
      : `Provider did not emit valid JSON matching the response schema after ${reliabilityCfg.maxRetryAttempts} attempts.`;
  throw new AiProviderError(errorCode, errorMessage, {
    lastError: lastError instanceof Error ? lastError.message : String(lastError),
    finalReason,
  });
}

/**
 * Legacy undifferentiated retry loop preserved for operators that set
 * `OPENWOP_ENVELOPE_RELIABILITY_END_TO_END=false`. No envelope-reliability
 * emission; no truncation-vs-schema-violation routing. Mirrors the pre-
 * RFC-0032 dispatchStructured behavior verbatim so a future regression
 * can't silently change semantics for hosts that opted out of the new
 * code path.
 */
async function dispatchStructuredLegacy(
  scope: AdapterScope,
  req: AiCallRequest,
  apiKey: string,
  augmentedSystem: string,
): Promise<AiCallResult> {
  const enrichedReq: AiCallRequest = { ...req, systemPrompt: augmentedSystem };
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= STRUCTURED_OUTPUT_RETRIES; attempt++) {
    let raw: AiCallResult;
    try {
      raw = await dispatchPlain(scope, enrichedReq, apiKey);
    } catch (err) {
      lastError = err;
      continue;
    }
    const text = raw.content ?? '';
    try {
      const data = JSON.parse(text);
      if (validateAgainstSchema(data, req.responseSchema)) {
        return { ...raw, content: undefined, data };
      }
      lastError = new Error('structured output did not match required-key check');
    } catch (parseErr) {
      lastError = parseErr;
    }
  }
  throw new AiProviderError(
    'envelope_payload_invalid',
    `Provider did not emit valid JSON matching the response schema after ${STRUCTURED_OUTPUT_RETRIES + 1} attempts.`,
    { lastError: lastError instanceof Error ? lastError.message : String(lastError) },
  );
}

/** Shallow JSON Schema check: every key in `required[]` is present on
 *  the data object. Real production hosts run full Ajv2020 validation. */
function validateAgainstSchema(data: unknown, schema: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  if (!schema || typeof schema !== 'object') return true;
  const s = schema as Record<string, unknown>;
  const required = Array.isArray(s.required) ? (s.required as string[]) : [];
  for (const key of required) {
    if (!(key in (data as Record<string, unknown>))) return false;
  }
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────

function toChatMessages(req: AiCallRequest | AiToolCallRequest): readonly ChatMessage[] {
  const out: ChatMessage[] = [];
  if (req.systemPrompt) out.push({ role: 'system', content: req.systemPrompt });
  for (const m of req.messages) out.push({ role: m.role, content: m.content });
  return out;
}

function normalizeFinishReason(raw: string | undefined): AiCallResult['finishReason'] {
  if (!raw) return undefined;
  const r = raw.toLowerCase();
  if (['end_turn', 'stop'].includes(r)) return 'stop';
  if (['max_tokens', 'length'].includes(r)) return 'length';
  if (['safety', 'content_filter'].includes(r)) return 'content-filter';
  if (['tool_use', 'tool_calls'].includes(r)) return 'tool-call';
  return 'other';
}

function computeProviderKey(input: Record<string, unknown>): string {
  // Stable canonical JSON: walk keys in sorted order.
  const sorted = canonicalize(input);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] !== undefined) sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function modelMatchesAllowlist(model: string, allowed: readonly string[]): boolean {
  for (const pattern of allowed) {
    if (pattern === model) return true;
    if (pattern.endsWith('*') && model.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

async function mapDispatchErrors<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Preserve AbortError → provider_timed_out before string-matching.
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AiProviderError('provider_timed_out', 'Provider call exceeded the configured timeout.', { provider });
    }
    if (err instanceof AiProviderError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    // Provider error shapes (e.g., "anthropic_429: ...", "openai_404: ...")
    // get mapped to canonical aiProviders error codes per
    // `spec/v1/host-capabilities.md:141-154`. The provider's RAW error
    // body (which `providers/dispatch.ts` already truncates to 300
    // chars) is STASHED under `details.upstreamMessage` so audit
    // consumers can inspect it server-side, but the `AiProviderError.
    // message` itself never carries it — that prevents accidental
    // leakage of provider-side credential echoes through the run
    // event log's `node.failure.error.message` field.
    const upstreamMessage = msg.slice(0, 200);
    const match = msg.match(/^[a-z]+_(\d{3}):/i);
    if (match) {
      const status = Number(match[1]);
      if (status === 401 || status === 403) {
        throw new AiProviderError('byok_required_but_unresolved', 'Provider rejected credential.', { provider, status, upstreamMessage });
      }
      if (status === 404) {
        throw new AiProviderError('model_not_supported', 'Provider rejected model.', { provider, status, upstreamMessage });
      }
      if (status === 429) {
        throw new AiProviderError('provider_rate_limited', 'Provider rate-limited.', { provider, status, upstreamMessage });
      }
      if (status >= 500) {
        throw new AiProviderError('provider_unavailable', 'Provider 5xx.', { provider, status, upstreamMessage });
      }
      throw new AiProviderError('invalid_request', 'Provider rejected request.', { provider, status, upstreamMessage });
    }
    throw new AiProviderError('internal_error', 'Provider call failed — see span attributes for trace details.', { provider, upstreamMessage });
  }
}

/**
 * Bound an async operation by an AbortController. The signal is
 * passed into the operation so the underlying fetch can be aborted;
 * a separate timer rejects with an `AbortError` on timeout. Honors
 * `scope.timeoutMs` with a 120s default per `DEFAULT_TIMEOUT_MS`.
 */
async function runWithTimeout<T>(scope: AdapterScope, op: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeoutMs = scope.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await op(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      const e = new Error(`request_timed_out_after_${timeoutMs}ms`);
      e.name = 'AbortError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wrap an upstream provider call in an OTel span. Follows the spec
 * taxonomy at `spec/v1/observability.md`:
 *
 *   - Span name: `openwop.activity.<provider>` (per §"Span attributes"
 *     line 217 — wraps external API calls)
 *   - Run/node attrs: `openwop.tenant_id`, `openwop.scope_id?`,
 *     `openwop.run_id`, `openwop.node_id`
 *   - Cost attrs: `openwop.cost.provider`, `openwop.cost.tokens.input`,
 *     `openwop.cost.tokens.output` (per §"Cost attribution attributes"
 *     lines 711-721)
 *   - Model + finish reason use the OTel GenAI semantic conventions
 *     (`gen_ai.*`) outside the `openwop.*` namespace.
 */
async function wrapInSpan<T extends AiCallResult | { usage?: { inputTokens?: number; outputTokens?: number }; finishReason?: string }>(
  scope: AdapterScope,
  provider: string,
  model: string,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer('openwop.workflow-engine-sample');
  const span = tracer.startSpan(`openwop.activity.${provider}`, {
    attributes: {
      'openwop.tenant_id': scope.tenantId,
      ...(scope.scopeId ? { 'openwop.scope_id': scope.scopeId } : {}),
      'openwop.run_id': scope.runId,
      'openwop.node_id': scope.nodeId,
      'openwop.cost.provider': provider,
      'gen_ai.request.model': model,
    },
  });
  try {
    const r = await fn();
    const finish = 'finishReason' in r ? r.finishReason : undefined;
    if (finish) span.setAttribute('gen_ai.response.finish_reason', finish);
    const usage = 'usage' in r ? r.usage : undefined;
    if (usage?.inputTokens != null) span.setAttribute('openwop.cost.tokens.input', usage.inputTokens);
    if (usage?.outputTokens != null) span.setAttribute('openwop.cost.tokens.output', usage.outputTokens);
    span.setStatus({ code: SpanStatusCode.OK });
    return r;
  } catch (err) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    span.end();
  }
}
