/**
 * RFC 0026 — `aiProvidersHost.ts` emits one `provider.usage` event per
 * upstream LLM provider invocation.
 *
 * Spies on `globalThis.fetch` via `vi.spyOn` to return synthesized
 * OpenAI / Anthropic responses so the dispatcher runs end-to-end
 * without a real provider. The managed-provider path stubs
 * `dispatchManagedChat` via `vi.mock` to bypass the BYOK encryption /
 * daily-cap plumbing that lives outside this test's surface.
 *
 * Verifies the §B normative ("MUST emit exactly ONE per LLM provider
 * invocation") at the four boundaries the impl actually uses:
 *
 *   - Plain `callAI`               → 1 dispatchPlain call          → 1 event
 *   - Structured `callAI` w/ retry → N dispatchPlain calls         → N events
 *   - `callAIWithTools`            → 1 dispatchAnthropicToolsRound → 1 event
 *   - `callAIManaged`              → 1 dispatchManagedChat         → 1 event
 *
 * For the plain / structured paths the emission site is
 * `aiProvidersHost.ts:dispatchPlain` so `dispatchStructured`'s parse-
 * retry loop produces one event per attempt rather than collapsing N
 * invocations into 1. The tool-calling and managed branches emit
 * after their single per-call dispatch, with no internal retry.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAiProvidersAdapter } from '../src/aiProviders/aiProvidersHost.js';
import { setInvocationBackend } from '../src/executor/invocationLog.js';
import { openStorage } from '../src/storage/index.js';
import type { AiProviderPolicy, ProviderPolicyResolver } from '../src/host/index.js';

// Stub the managed-provider module so callAIManaged's emit path can be
// tested without bootstrapping the BYOK secret store, daily-cap state,
// and MINIMAX_API_KEY env. `dispatchManagedChat` is replaced by a vi.fn
// whose resolved value each test sets via `vi.mocked(...)`.
vi.mock('../src/providers/managedProvider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/managedProvider.js')>();
  return {
    ...actual,
    // Preserve isManagedCredentialRef / managedProviderIdFromRef so callAI's
    // routing logic still works; replace only the dispatch.
    dispatchManagedChat: vi.fn(),
  };
});

import { dispatchManagedChat } from '../src/providers/managedProvider.js';

beforeAll(async () => {
  // callAI consults `getInvocationLog()` for replay-determinism cache
  // hits; install an in-memory backend so the lookup returns null and
  // the dispatch path proceeds.
  const storage = await openStorage('memory://');
  setInvocationBackend(storage);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Synthesize an OpenAI-style SSE response carrying a single content
 *  delta + a final chunk with `usage`. The dispatcher's parser at
 *  `providers/dispatch.ts:274-300` consumes this shape. */
function mockOpenAiSse(content: string, promptTokens: number, completionTokens: number): void {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    })}\n\n`,
    `data: [DONE]\n\n`,
  ];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
  );
}

interface EmittedEvent {
  type: string;
  payload: unknown;
}

function buildScope(opts: {
  secrets: Record<string, string>;
  events: EmittedEvent[];
  policies?: AiProviderPolicy[];
}) {
  const policyResolver: ProviderPolicyResolver = {
    async resolveForRun() {
      return opts.policies ?? [];
    },
  };
  let nextSeq = 1;
  return {
    runId: 'test-run',
    nodeId: 'test-node',
    tenantId: 'test-tenant',
    attempt: 1,
    secrets: opts.secrets,
    policyResolver,
    emit: async (type: string, payload: unknown) => {
      const seq = nextSeq++;
      opts.events.push({ type, payload });
      return { eventId: `e${seq}`, sequence: seq };
    },
  };
}

describe('RFC 0026 — provider.usage emission via aiProvidersHost.dispatchPlain', () => {
  it('plain callAI emits exactly one provider.usage event with the upstream usage figures', async () => {
    const events: EmittedEvent[] = [];
    const scope = buildScope({ secrets: { openai: 'sk-test' }, events });

    mockOpenAiSse('hello', 12, 4);

    const adapter = createAiProvidersAdapter(scope);
    const res = await adapter.callAI({
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.content).toBe('hello');
    const usageEvents = events.filter((e) => e.type === 'provider.usage');
    expect(usageEvents.length, 'one event per provider invocation').toBe(1);
    expect(usageEvents[0]?.payload).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      nodeId: 'test-node',
    });
  });

  it('structured callAI emits one event per attempt when validation fails before succeeding', async () => {
    const events: EmittedEvent[] = [];
    const scope = buildScope({ secrets: { openai: 'sk-test' }, events });

    // dispatchStructured tries up to STRUCTURED_OUTPUT_RETRIES (2) + 1
    // = 3 times. Queue 3 responses on a SINGLE spy: the first two return
    // non-JSON (parse fails → continue), the third returns valid JSON.
    // That produces 3 dispatchPlain calls and MUST produce 3 events.
    const responses = [
      { content: 'not json', prompt: 5, completion: 1 },
      { content: 'also not json', prompt: 6, completion: 2 },
      { content: '{"answer":"ok"}', prompt: 7, completion: 3 },
    ];
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const r of responses) {
      const chunks = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: r.content }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: r.prompt, completion_tokens: r.completion },
        })}\n\n`,
        `data: [DONE]\n\n`,
      ];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          for (const c of chunks) controller.enqueue(enc.encode(c));
          controller.close();
        },
      });
      spy.mockResolvedValueOnce(
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    }

    const adapter = createAiProvidersAdapter(scope);
    const res = await adapter.callAI({
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'reply with JSON' }],
      responseSchema: {
        type: 'object',
        required: ['answer'],
        properties: { answer: { type: 'string' } },
      },
    });

    expect(res.data).toEqual({ answer: 'ok' });

    const usageEvents = events.filter((e) => e.type === 'provider.usage');
    expect(
      usageEvents.length,
      'RFC 0026 §B: MUST emit exactly ONE per LLM provider invocation — including each retry attempt',
    ).toBe(3);

    // Attempt-by-attempt token correlation: events fire in the same
    // order dispatchPlain runs.
    expect(usageEvents[0]?.payload).toMatchObject({ inputTokens: 5, outputTokens: 1 });
    expect(usageEvents[1]?.payload).toMatchObject({ inputTokens: 6, outputTokens: 2 });
    expect(usageEvents[2]?.payload).toMatchObject({ inputTokens: 7, outputTokens: 3 });
  });

  it('emitted payload carries no credentialRef or prompt content (RFC 0026 §D trust boundary)', async () => {
    const events: EmittedEvent[] = [];
    const scope = buildScope({ secrets: { openai: 'sk-leaked-secret-canary' }, events });

    mockOpenAiSse('reply', 3, 2);

    const adapter = createAiProvidersAdapter(scope);
    await adapter.callAI({
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'prompt-canary-must-not-leak' }],
      credentialRef: 'openai',
    });

    const usageEvents = events.filter((e) => e.type === 'provider.usage');
    expect(usageEvents.length).toBe(1);
    const serialized = JSON.stringify(usageEvents[0]?.payload);
    expect(serialized, 'cleartext API key MUST NOT appear in the emitted payload').not.toContain(
      'sk-leaked-secret-canary',
    );
    expect(serialized, 'prompt content MUST NOT appear in the emitted payload').not.toContain(
      'prompt-canary-must-not-leak',
    );
    expect(serialized, 'no credentialRef field MUST be present').not.toContain('credentialRef');
  });

  it('callAIWithTools emits exactly one provider.usage event after the tool-calling round', async () => {
    const events: EmittedEvent[] = [];
    const scope = buildScope({ secrets: { anthropic: 'sk-test' }, events });

    // dispatchAnthropicToolsRound issues a single non-streaming POST and
    // reads `data.usage.input_tokens` / `output_tokens` from the JSON
    // response. No SSE here — a plain `Response.json` shape suffices.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'tool-call response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 18, output_tokens: 9 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createAiProvidersAdapter(scope);
    const res = await adapter.callAIWithTools({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'use a tool' }],
      tools: [
        { name: 'noop', description: 'no-op tool', inputSchema: { type: 'object', properties: {} } },
      ],
    });

    expect(res.usage).toEqual({ inputTokens: 18, outputTokens: 9 });

    const usageEvents = events.filter((e) => e.type === 'provider.usage');
    expect(
      usageEvents.length,
      'callAIWithTools emits exactly one provider.usage event per tool round',
    ).toBe(1);
    expect(usageEvents[0]?.payload).toMatchObject({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 18,
      outputTokens: 9,
      totalTokens: 27,
      nodeId: 'test-node',
    });
  });

  it('callAIManaged emits exactly one provider.usage event with the USER-FACING provider/model ids', async () => {
    const events: EmittedEvent[] = [];
    const scope = buildScope({ secrets: {}, events });

    // The dispatchManagedChat stub returns the user-facing identifiers
    // (openwop-free / openwop-free), NOT the underlying provider name —
    // RFC 0026 §A: `provider` and `model` MUST carry the same values the
    // host advertises to its tenants (so billing reconciliation matches
    // what the user sees, not the underlying server-held provider).
    vi.mocked(dispatchManagedChat).mockResolvedValueOnce({
      provider: 'openwop-free',
      model: 'openwop-free',
      completion: 'hello from managed',
      usage: { inputTokens: 11, outputTokens: 4 },
      finishReason: 'stop',
    });

    const adapter = createAiProvidersAdapter(scope);
    const res = await adapter.callAI({
      provider: 'openwop-free',
      model: 'openwop-free',
      messages: [{ role: 'user', content: 'hi' }],
      credentialRef: 'managed:openwop-free',
    });

    expect(res.content).toBe('hello from managed');
    expect(res.model).toBe('openwop-free');

    const usageEvents = events.filter((e) => e.type === 'provider.usage');
    expect(
      usageEvents.length,
      'callAIManaged emits exactly one provider.usage event per dispatch',
    ).toBe(1);
    expect(usageEvents[0]?.payload).toMatchObject({
      provider: 'openwop-free',
      model: 'openwop-free',
      inputTokens: 11,
      outputTokens: 4,
      totalTokens: 15,
      nodeId: 'test-node',
    });

    // The serialized payload MUST NOT carry the underlying provider
    // name (the managed pipeline's whole job is to hide it).
    const serialized = JSON.stringify(usageEvents[0]?.payload).toLowerCase();
    expect(serialized, 'underlying provider name MUST NOT appear').not.toContain('minimax');
    expect(serialized, 'underlying provider name MUST NOT appear').not.toContain('anthropic');
  });
});
