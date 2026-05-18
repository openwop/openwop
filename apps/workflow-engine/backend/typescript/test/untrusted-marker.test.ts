/**
 * Untrusted-marker propagation through reference packs (RFC 0020 §D
 * + SECURITY/threat-model-prompt-injection.md `prompt-injection-input-marker`
 * + `prompt-injection-mcp-marker`).
 *
 * Verifies that when a workflow runs under `ctx.trustBoundary === 'untrusted'`,
 * the reference `core.openwop.ai` and `core.openwop.mcp` pack delegates
 * honor the existing marker convention before forwarding content to the
 * LLM / re-emitting MCP tool results downstream.
 *
 * Tests the pack runtime directly with a mocked ctx — no HTTP harness,
 * no live LLM. Each test < 5ms.
 *
 * @see RFCS/0020-host-mcp-server-composition.md §D
 * @see SECURITY/threat-model-prompt-injection.md
 * @see packs/core.openwop.ai/index.mjs `applyUntrustedMarkers`
 * @see packs/core.openwop.mcp/index.mjs `invokeTool`
 */

import { describe, it, expect } from 'vitest';

// Import the reference pack delegates directly (`.mjs` modules; Node ESM).
// The pack runtime is host-agnostic so we can exercise it with a mock ctx.
// Ambient types in `test/types/pack-modules.d.ts` declare the minimal
// delegate signature so the imports typecheck without `@ts-expect-error`.
import { chatCompletion, classify, extract, transform, embeddings } from '../../../../packs/core.openwop.ai/index.mjs';
import { invokeTool } from '../../../../packs/core.openwop.mcp/index.mjs';

interface CapturedCallAI {
  messages: ReadonlyArray<{ role: string; content: string }>;
  systemPrompt?: string;
}

function makeMockCtx(opts: {
  trustBoundary?: 'trusted' | 'untrusted';
  inputs?: Record<string, unknown>;
  config?: Record<string, unknown>;
  mockResult?: Record<string, unknown>;
}): { ctx: Record<string, unknown>; captured: CapturedCallAI[] } {
  const captured: CapturedCallAI[] = [];
  const ctx: Record<string, unknown> = {
    runId: 'r-test',
    nodeId: 'n-test',
    tenantId: 't-test',
    inputs: opts.inputs ?? {},
    config: opts.config ?? {},
    secrets: {},
    attempt: 1,
    async emit() {},
    callAI: async (req: CapturedCallAI) => {
      captured.push(req);
      return opts.mockResult ?? { content: '', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
  if (opts.trustBoundary !== undefined) ctx.trustBoundary = opts.trustBoundary;
  return { ctx, captured };
}

describe('core.openwop.ai — UNTRUSTED-marker discipline (RFC 0020 §D)', () => {
  it('chatCompletion: trusted run → no marker on user messages', async () => {
    const { ctx, captured } = makeMockCtx({
      trustBoundary: 'trusted',
      inputs: { messages: [{ role: 'user', content: 'hello' }] },
      config: { provider: 'anthropic', model: 'claude' },
    });
    await chatCompletion(ctx);
    expect(captured[0]!.messages[0]!.content).toBe('hello');
  });

  it('chatCompletion: trustBoundary absent → no marker (default trusted)', async () => {
    const { ctx, captured } = makeMockCtx({
      inputs: { messages: [{ role: 'user', content: 'hello' }] },
      config: { provider: 'anthropic', model: 'claude' },
    });
    await chatCompletion(ctx);
    expect(captured[0]!.messages[0]!.content).toBe('hello');
  });

  it('chatCompletion: untrusted run → user message wrapped in <UNTRUSTED>', async () => {
    const { ctx, captured } = makeMockCtx({
      trustBoundary: 'untrusted',
      inputs: { messages: [{ role: 'user', content: 'hello' }] },
      config: { provider: 'anthropic', model: 'claude' },
    });
    await chatCompletion(ctx);
    expect(captured[0]!.messages[0]!.content).toBe('<UNTRUSTED>hello</UNTRUSTED>');
  });

  it('chatCompletion: untrusted run → system messages stay UNwrapped', async () => {
    const { ctx, captured } = makeMockCtx({
      trustBoundary: 'untrusted',
      inputs: {
        messages: [
          { role: 'system', content: 'you are a helper' },
          { role: 'user', content: 'hello' },
        ],
      },
      config: { provider: 'anthropic', model: 'claude' },
    });
    await chatCompletion(ctx);
    expect(captured[0]!.messages[0]!.content).toBe('you are a helper');
    expect(captured[0]!.messages[1]!.content).toBe('<UNTRUSTED>hello</UNTRUSTED>');
  });

  it('chatCompletion: idempotent — already-wrapped content stays single-wrapped', async () => {
    const { ctx, captured } = makeMockCtx({
      trustBoundary: 'untrusted',
      inputs: { messages: [{ role: 'user', content: '<UNTRUSTED>prior wrap</UNTRUSTED>' }] },
      config: { provider: 'anthropic', model: 'claude' },
    });
    await chatCompletion(ctx);
    expect(captured[0]!.messages[0]!.content).toBe('<UNTRUSTED>prior wrap</UNTRUSTED>');
  });

  it('classify: untrusted run → wraps the synthetic user message', async () => {
    const { ctx, captured } = makeMockCtx({
      trustBoundary: 'untrusted',
      inputs: { text: 'this is the input' },
      config: { labels: ['A', 'B'], model: 'claude' },
      mockResult: { content: 'A' },
    });
    await classify(ctx);
    const content = captured[0]!.messages[0]!.content;
    expect(content.startsWith('<UNTRUSTED>')).toBe(true);
    expect(content).toContain('this is the input');
    expect(content.endsWith('</UNTRUSTED>')).toBe(true);
  });

  it('extract: untrusted run → wraps the synthetic user message', async () => {
    const { ctx, captured } = makeMockCtx({
      trustBoundary: 'untrusted',
      inputs: { text: 'extract me' },
      config: { schema: { type: 'object' }, model: 'claude' },
      mockResult: { data: { x: 1 } },
    });
    await extract(ctx);
    expect(captured[0]!.messages[0]!.content.startsWith('<UNTRUSTED>')).toBe(true);
  });

  it('transform: untrusted run → wraps the synthetic user message', async () => {
    const { ctx, captured } = makeMockCtx({
      trustBoundary: 'untrusted',
      inputs: { instruction: 'uppercase', value: 'hi' },
      config: { model: 'claude' },
      mockResult: { content: '"HI"' },
    });
    await transform(ctx);
    expect(captured[0]!.messages[0]!.content.startsWith('<UNTRUSTED>')).toBe(true);
  });

  it('embeddings: untrusted run → wraps the synthetic user message', async () => {
    const { ctx, captured } = makeMockCtx({
      trustBoundary: 'untrusted',
      inputs: { text: 'embed me' },
      config: { provider: 'openai', model: 'ada' },
      mockResult: { embedding: [0.1, 0.2] },
    });
    await embeddings(ctx);
    expect(captured[0]!.messages[0]!.content).toBe('<UNTRUSTED>embed me</UNTRUSTED>');
  });
});

describe('core.openwop.mcp.invoke-tool — markedContent (RFC 0020 §D)', () => {
  interface CapturedMcp {
    serverId: string;
    toolName: string;
    args: unknown;
  }
  function makeMcpCtx(opts: {
    trustBoundary?: 'trusted' | 'untrusted';
    mockResult: Record<string, unknown>;
  }): { ctx: Record<string, unknown>; captured: CapturedMcp[] } {
    const captured: CapturedMcp[] = [];
    const ctx: Record<string, unknown> = {
      runId: 'r-test',
      nodeId: 'n-test',
      tenantId: 't-test',
      inputs: { args: { hello: 'world' } },
      config: { serverId: 'srv-1', toolName: 'lookup' },
      secrets: {},
      attempt: 1,
      async emit() {},
      mcp: {
        listTools: async () => ({ tools: [] }),
        invokeTool: async (serverId: string, toolName: string, args: unknown) => {
          captured.push({ serverId, toolName, args });
          return opts.mockResult;
        },
      },
    };
    if (opts.trustBoundary !== undefined) ctx.trustBoundary = opts.trustBoundary;
    return { ctx, captured };
  }

  it('trusted run + result.untrustedContent=false → no markedContent', async () => {
    const { ctx } = makeMcpCtx({
      trustBoundary: 'trusted',
      mockResult: { result: 'tool output', isError: false, untrustedContent: false },
    });
    const out = (await invokeTool(ctx)) as { outputs: { markedContent?: string } };
    expect(out.outputs.markedContent).toBeUndefined();
  });

  it('trusted run + result.untrustedContent=true → markedContent wraps', async () => {
    const { ctx } = makeMcpCtx({
      trustBoundary: 'trusted',
      mockResult: { result: 'tool output', isError: false, untrustedContent: true },
    });
    const out = (await invokeTool(ctx)) as { outputs: { markedContent?: string } };
    expect(out.outputs.markedContent).toBe('<UNTRUSTED tool="lookup">tool output</UNTRUSTED>');
  });

  it('untrusted run → markedContent wraps even when result.untrustedContent is absent', async () => {
    const { ctx } = makeMcpCtx({
      trustBoundary: 'untrusted',
      mockResult: { result: 'tool output', isError: false },
    });
    const out = (await invokeTool(ctx)) as { outputs: { markedContent?: string } };
    expect(out.outputs.markedContent).toBe('<UNTRUSTED tool="lookup">tool output</UNTRUSTED>');
  });

  it('untrusted run + object result → JSON-stringified inside marker', async () => {
    const { ctx } = makeMcpCtx({
      trustBoundary: 'untrusted',
      mockResult: { result: { foo: 'bar' }, isError: false },
    });
    const out = (await invokeTool(ctx)) as { outputs: { markedContent?: string } };
    expect(out.outputs.markedContent).toBe('<UNTRUSTED tool="lookup">{"foo":"bar"}</UNTRUSTED>');
  });

  it('null result → no markedContent (nothing to wrap)', async () => {
    const { ctx } = makeMcpCtx({
      trustBoundary: 'untrusted',
      mockResult: { result: null, isError: true },
    });
    const out = (await invokeTool(ctx)) as { outputs: { markedContent?: string } };
    expect(out.outputs.markedContent).toBeUndefined();
  });
});
