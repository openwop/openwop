/**
 * Regression test for the managed-chat dispatch timeout landed
 * 2026-05-25. Without this bound, run f960d01c-… (Triple-AI review
 * board) hung forever at step 7/11 — `currentNodeId: chat_6` was set
 * but `node.started [chat_6]` never fired because the worker was
 * parked inside `dispatchManagedChat` awaiting an upstream MiniMax
 * response that never arrived. The fix bounds the dispatch with an
 * `AbortController`; this test pins it.
 *
 * Strategy: stub `dispatchManagedChat` to return a never-resolving
 * promise (until the AbortSignal fires), call the chat-responder
 * directly via the exported `sampleChatResponderNode`, assert the
 * outcome is `{status: 'failure', error: {code: 'timeout', ...}}`
 * within `OPENWOP_MANAGED_CHAT_TIMEOUT_MS`. Override the timeout
 * via the `_setManagedChatTimeoutMs` test affordance so the test
 * runs in ~250ms instead of 60s.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '../src/executor/types.js';

// `vi.mock` runs before the import of `./nodes.js` resolves. Replace
// `dispatchManagedChat` with a stub that honors the AbortSignal — when
// the signal fires we reject with an AbortError, matching what the
// underlying fetch implementation would do.
vi.mock('../src/providers/managedProvider.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/providers/managedProvider.js')>();
  return {
    ...original,
    dispatchManagedChat: vi.fn(async (req: { signal?: AbortSignal }) => {
      // Never-resolving promise that rejects only on abort. Matches
      // the behavior of a fetch that's stuck waiting on an upstream
      // host — the only way out is the AbortSignal.
      return new Promise((_resolve, reject) => {
        if (req.signal) {
          if (req.signal.aborted) {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          req.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          }, { once: true });
        }
        // Without a signal the promise hangs forever — that's the
        // pre-fix behavior we're guarding against.
      });
    }),
  };
});

// Import AFTER vi.mock so the stub is in place.
let sampleChatResponderNode: typeof import('../src/bootstrap/nodes.js')['sampleChatResponderNode'];
let _setManagedChatTimeoutMs: typeof import('../src/bootstrap/nodes.js')['_setManagedChatTimeoutMs'];

beforeAll(async () => {
  const mod = await import('../src/bootstrap/nodes.js');
  sampleChatResponderNode = mod.sampleChatResponderNode;
  _setManagedChatTimeoutMs = mod._setManagedChatTimeoutMs;
});

afterEach(() => {
  // Restore the default so other tests in the same vitest worker
  // don't inherit a 250ms timeout.
  _setManagedChatTimeoutMs(60_000);
});

interface CapturedEvent { type: string; payload: unknown }

function makeCtx(overrides?: { credentialRef?: string }): { ctx: NodeContext; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  let nextSeq = 1;
  const ctx: NodeContext = {
    runId: 'run-timeout-test',
    nodeId: 'chat-test',
    tenantId: 'user:test-tenant',
    inputs: {
      messages: [{ role: 'user' as const, content: 'critique this' }],
    },
    config: {
      credentialRef: overrides?.credentialRef ?? 'managed:openwop-free',
    },
    configurable: {},
    attempt: 1,
    secrets: {},
    async emit(type, payload) {
      const eventId = `evt-${nextSeq.toString().padStart(8, '0')}`;
      const sequence = nextSeq++;
      events.push({ type, payload });
      return { eventId, sequence };
    },
  };
  return { ctx, events };
}

describe('chat-responder: managed-chat dispatch timeout', () => {
  it('fails with code=timeout when the upstream never responds within MANAGED_CHAT_TIMEOUT_MS', async () => {
    _setManagedChatTimeoutMs(250);
    const { ctx } = makeCtx();
    const t0 = Date.now();
    const outcome = await sampleChatResponderNode.execute(ctx);
    const elapsed = Date.now() - t0;
    expect(outcome.status).toBe('failure');
    if (outcome.status !== 'failure') return; // type narrowing
    expect(outcome.error.code).toBe('timeout');
    expect(outcome.error.message).toMatch(/exceeded 250ms/);
    expect(outcome.error.message).toMatch(/upstream provider unresponsive/);
    // The timeout MUST fire within the configured window plus a small
    // buffer for the rejection + catch path. If this test starts
    // taking longer than ~1s, something is wrong with the abort
    // plumbing.
    expect(elapsed).toBeGreaterThanOrEqual(240);
    expect(elapsed).toBeLessThan(1000);
  });

  it('error message uses the resolved timeout value (not the raw env var)', async () => {
    // Regression for the formatting bug where the catch branch read
    // `process.env.OPENWOP_MANAGED_CHAT_TIMEOUT_MS ?? 60_000` and
    // rendered the raw env value (or "60000" for unset) instead of
    // the actual `Number()`-coerced value. With `_setManagedChatTimeoutMs`
    // the source of truth is the module constant, not the env.
    _setManagedChatTimeoutMs(420);
    const { ctx } = makeCtx();
    const outcome = await sampleChatResponderNode.execute(ctx);
    expect(outcome.status).toBe('failure');
    if (outcome.status !== 'failure') return;
    expect(outcome.error.message).toMatch(/exceeded 420ms/);
  });
});
