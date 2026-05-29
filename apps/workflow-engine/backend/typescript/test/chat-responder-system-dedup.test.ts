/**
 * Regression test for the multiple-system-messages dispatch bug
 * (2026-05-28). The chat-tab path bundles its own default system
 * prompt into `inputs.messages`. When a workflow ALSO pins a system
 * prompt (via `config.systemPrompt`, `config.systemPromptRef`, or
 * `inputs.agentId`), the chat-responder used to prepend its
 * resolved systemBody on top of the existing system, producing TWO
 * `role: 'system'` messages back-to-back.
 *
 * MiniMax-M2.7 rejects that with HTTP 400
 * `invalid params, invalid chat setting (2013)` (confirmed by
 * direct curl bisect against the MiniMax endpoint: single-system
 * passes, two-system fails with this exact error code). Anthropic
 * accepts multi-system but collapses internally; OpenAI accepts
 * but its API contract increasingly recommends one. De-duplicating
 * at the chat-responder boundary is the correct shape for every
 * provider.
 *
 * The fix: when the resolved `systemBody` is non-null, strip every
 * existing `role: 'system'` message from the incoming `messages`
 * before prepending. The resolved systemBody (agent → config literal
 * → PromptRef precedence) is authoritative.
 *
 * Strategy mirrors `chat-responder-timeout.test.ts`: mock
 * `dispatchManagedChat`, capture the `messages` it receives,
 * assert exactly one system message and that it's the one resolved
 * by the chat-responder, not the chat-tab default.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '../src/executor/types.js';

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
let capturedMessages: ChatMessage[] | null = null;

vi.mock('../src/providers/managedProvider.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/providers/managedProvider.js')>();
  return {
    ...original,
    dispatchManagedChat: vi.fn(async (req: { messages: readonly ChatMessage[] }) => {
      capturedMessages = req.messages.map((m) => ({ ...m }));
      // Return a minimal success so the chat-responder finishes
      // without erroring. Shape mirrors `ManagedDispatchResult`.
      return {
        provider: 'openwop-free',
        model: 'openwop-free',
        completion: 'ok',
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      };
    }),
  };
});

// Mock the BYOK dispatch path too. The dedup lives at the chat-responder
// boundary BEFORE the managed-vs-BYOK split, so a regression that only
// reached the BYOK dispatcher (Anthropic / OpenAI / Google / MiniMax-BYOK)
// would slip past the managed-only mock above. Capturing both paths
// locks in the dispatch-path-agnostic correctness of the fix.
vi.mock('../src/providers/dispatch.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/providers/dispatch.js')>();
  return {
    ...original,
    dispatchChat: vi.fn(async (req: { messages: readonly ChatMessage[] }) => {
      capturedMessages = req.messages.map((m) => ({ ...m }));
      return {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        completion: 'ok',
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      };
    }),
  };
});

let sampleChatResponderNode: typeof import('../src/bootstrap/nodes.js')['sampleChatResponderNode'];

beforeAll(async () => {
  const mod = await import('../src/bootstrap/nodes.js');
  sampleChatResponderNode = mod.sampleChatResponderNode;
});

afterEach(() => {
  capturedMessages = null;
});

function makeCtx(overrides: {
  inputMessages: ChatMessage[];
  systemPrompt?: string;
  credentialRef?: string;
  secrets?: Record<string, string>;
}): { ctx: NodeContext } {
  let nextSeq = 1;
  const credentialRef = overrides.credentialRef ?? 'managed:openwop-free';
  const ctx: NodeContext = {
    runId: 'run-system-dedup-test',
    nodeId: 'chat-test',
    tenantId: 'user:test-tenant',
    inputs: {
      messages: overrides.inputMessages,
    },
    config: {
      credentialRef,
      ...(overrides.systemPrompt !== undefined ? { systemPrompt: overrides.systemPrompt } : {}),
    },
    configurable: {},
    attempt: 1,
    secrets: overrides.secrets ?? {},
    async emit(_type, _payload) {
      const eventId = `evt-${nextSeq.toString().padStart(8, '0')}`;
      const sequence = nextSeq++;
      return { eventId, sequence };
    },
  };
  return { ctx };
}

describe('chat-responder: system-message de-duplication', () => {
  it('strips an existing system message when the workflow pins a new one via config.systemPrompt', async () => {
    const { ctx } = makeCtx({
      inputMessages: [
        { role: 'system', content: 'You are a helpful AI assistant inside the OpenWOP workflow-engine sample.' },
        { role: 'user', content: 'What does Elon Musk mean by saying everyone should understand physics' },
      ],
      systemPrompt: 'You are Deep Researcher. Plan, retrieve, evaluate, write up findings.',
    });
    const outcome = await sampleChatResponderNode.execute(ctx);
    expect(outcome.status).toBe('success');
    expect(capturedMessages).not.toBeNull();
    const systemMessages = capturedMessages!.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]!.content).toBe('You are Deep Researcher. Plan, retrieve, evaluate, write up findings.');
    // The user message survives.
    const userMessages = capturedMessages!.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]!.content).toBe('What does Elon Musk mean by saying everyone should understand physics');
  });

  it('does not touch the messages array when no systemBody is resolved', async () => {
    const { ctx } = makeCtx({
      inputMessages: [
        { role: 'system', content: 'pre-existing system from caller' },
        { role: 'user', content: 'hi' },
      ],
      // No config.systemPrompt and no agentId — chat-responder resolves nothing.
    });
    const outcome = await sampleChatResponderNode.execute(ctx);
    expect(outcome.status).toBe('success');
    expect(capturedMessages).not.toBeNull();
    // Caller's exact messages flow through unmodified.
    expect(capturedMessages).toEqual([
      { role: 'system', content: 'pre-existing system from caller' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('strips an existing system on the BYOK dispatch path too (not just managed)', async () => {
    // The dedup lives at the chat-responder boundary BEFORE the
    // managed-vs-BYOK split (bootstrap/nodes.ts:1250-ish), so it MUST
    // apply to the BYOK dispatcher (Anthropic, OpenAI, Google,
    // MiniMax-BYOK) too. A regression that only re-introduced
    // multi-system on the BYOK path would slip past the managed-only
    // cases above. Pin both paths so the fix can't silently drift.
    const { ctx } = makeCtx({
      inputMessages: [
        { role: 'system', content: 'pre-existing default chat system' },
        { role: 'user', content: 'hi' },
      ],
      systemPrompt: 'workflow-pinned system',
      credentialRef: 'byok:anthropic-test',
      secrets: { 'byok:anthropic-test': 'sk-ant-test-key-not-real' },
    });
    const outcome = await sampleChatResponderNode.execute(ctx);
    expect(outcome.status).toBe('success');
    expect(capturedMessages).not.toBeNull();
    const systemMessages = capturedMessages!.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]!.content).toBe('workflow-pinned system');
  });

  it('handles two consecutive user messages without erroring (only system messages are deduped)', async () => {
    // The chat-tab can produce two consecutive user messages when the
    // prior workflow run never recorded an assistant response.
    // MiniMax accepts this (verified by curl bisect); we shouldn't
    // collapse them. Only the system-message de-dup is in scope.
    const { ctx } = makeCtx({
      inputMessages: [
        { role: 'system', content: 'default chat system' },
        { role: 'user', content: 'first turn' },
        { role: 'user', content: 'second turn' },
      ],
      systemPrompt: 'workflow-pinned system',
    });
    const outcome = await sampleChatResponderNode.execute(ctx);
    expect(outcome.status).toBe('success');
    expect(capturedMessages).not.toBeNull();
    const systemMessages = capturedMessages!.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]!.content).toBe('workflow-pinned system');
    // Both user messages survive in their original order.
    const userMessages = capturedMessages!.filter((m) => m.role === 'user');
    expect(userMessages.map((m) => m.content)).toEqual(['first turn', 'second turn']);
  });
});
