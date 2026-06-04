/**
 * managedProvider — server-held key, sign-in gating, per-tenant daily
 * token cap. The underlying provider stays hidden behind the user-
 * facing id ('openwop-free').
 *
 * Covers:
 *   1. Bootstrap reads MINIMAX_API_KEY → encrypts → writes to byok_secrets.
 *   2. Bootstrap is idempotent (same env value = no re-write).
 *   3. Bootstrap rotates when env value changes.
 *   4. Anonymous tenants (`anon:*`) get `sign_in_required` when the wall is
 *      on (OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED=true / posture `auth`); the
 *      default demo posture lets them through (mocked transport).
 *   5. Daily cap enforced once a tenant reaches OPENWOP_MANAGED_DAILY_TOKEN_CAP.
 *   5b. Global ceiling (OPENWOP_MANAGED_GLOBAL_DAILY_TOKEN_CAP) refuses a
 *       FRESH tenant once cross-tenant usage hits the cap; off when unset.
 *   6. Missing managed key → `managed_unavailable`.
 *   7. Happy path: signed-in tenant under cap → dispatch succeeds and
 *      usage is incremented. Result uses USER-FACING provider/model ids
 *      (underlying `minimax` / `MiniMax-M2` MUST NOT appear on the result).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStorage } from '../src/storage/index.js';
import { resetCachedMasterKey } from '../src/byok/encryption.js';
import {
  _clearManagedCacheForTests,
  GLOBAL_USAGE_TENANT,
  bootstrapManagedProvider,
  configureManagedProvider,
  dispatchManagedChat,
  getManagedProviderStatuses,
  isManagedCredentialRef,
  ManagedProviderError,
  managedProviderIdFromRef,
} from '../src/providers/managedProvider.js';
import type { Storage } from '../src/storage/storage.js';

// Deterministic master key so encrypt/decrypt is stable across the run.
const TEST_MASTER_KEY = 'a'.repeat(64);

let storage: Storage;

async function freshSetup(): Promise<void> {
  storage = await openStorage('memory://');
  configureManagedProvider({ storage, dataDir: '/tmp/openwop-managed-test' });
  _clearManagedCacheForTests();
  resetCachedMasterKey();
}

beforeAll(() => {
  process.env.OPENWOP_BYOK_ENCRYPTION_KEY = TEST_MASTER_KEY;
  process.env.OPENWOP_MANAGED_DAILY_TOKEN_CAP = '100';
});

beforeEach(async () => {
  await freshSetup();
  delete process.env.MINIMAX_API_KEY;
});

afterEach(async () => {
  await storage.close();
  vi.restoreAllMocks();
});

describe('isManagedCredentialRef / managedProviderIdFromRef', () => {
  it('detects managed prefix', () => {
    expect(isManagedCredentialRef('managed:openwop-free')).toBe(true);
    expect(isManagedCredentialRef('byok:anthropic:123')).toBe(false);
    expect(isManagedCredentialRef(undefined)).toBe(false);
    expect(isManagedCredentialRef(null)).toBe(false);
  });

  it('strips prefix to user-facing id', () => {
    expect(managedProviderIdFromRef('managed:openwop-free')).toBe('openwop-free');
  });
});

describe('bootstrapManagedProvider', () => {
  it('no-ops when env key absent', async () => {
    await bootstrapManagedProvider();
    expect(await storage.getEncryptedSecret('managed:openwop-free')).toBeNull();
  });

  it('seeds the encrypted key when env is set', async () => {
    process.env.MINIMAX_API_KEY = 'sk-test-1';
    await bootstrapManagedProvider();
    const enc = await storage.getEncryptedSecret('managed:openwop-free');
    expect(enc).toBeTruthy();
    // Cipher text MUST NOT contain the plaintext.
    expect(enc).not.toContain('sk-test-1');
  });

  it('is idempotent when env value unchanged', async () => {
    process.env.MINIMAX_API_KEY = 'sk-stable';
    await bootstrapManagedProvider();
    const first = await storage.getEncryptedSecret('managed:openwop-free');
    _clearManagedCacheForTests();
    await bootstrapManagedProvider();
    const second = await storage.getEncryptedSecret('managed:openwop-free');
    // Same plaintext → bootstrap detected unchanged → row NOT overwritten.
    expect(second).toBe(first);
  });

  it('rotates when env value changes', async () => {
    process.env.MINIMAX_API_KEY = 'sk-original';
    await bootstrapManagedProvider();
    const first = await storage.getEncryptedSecret('managed:openwop-free');

    process.env.MINIMAX_API_KEY = 'sk-rotated';
    _clearManagedCacheForTests();
    await bootstrapManagedProvider();
    const second = await storage.getEncryptedSecret('managed:openwop-free');
    // Different plaintext → rotation → cipher row replaced.
    expect(second).not.toBe(first);
    expect(second).not.toContain('sk-rotated');
  });
});

describe('dispatchManagedChat — gating', () => {
  // The sign-in wall is posture-derived since the deploy-posture work:
  // ON when OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED=true (or posture `auth`),
  // OFF in the demo postures. (This test originally asserted an
  // unconditional wall and was left failing — AND hitting the live MiniMax
  // API — when the default flipped; both posture branches are now pinned
  // deterministically.)
  it('rejects anonymous tenants with sign_in_required when the wall is on', async () => {
    process.env.MINIMAX_API_KEY = 'sk-test';
    process.env.OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED = 'true';
    try {
      await bootstrapManagedProvider();

      await expect(
        dispatchManagedChat({
          userFacingProvider: 'openwop-free',
          tenantId: 'anon:abc',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toMatchObject({ code: 'sign_in_required' });
    } finally {
      delete process.env.OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED;
    }
  });

  it('default demo posture lets anonymous tenants past the sign-in gate', async () => {
    process.env.MINIMAX_API_KEY = 'sk-test';
    await bootstrapManagedProvider();
    mockMiniMaxSseOnce('anon ok', 1, 1);

    const result = await dispatchManagedChat({
      userFacingProvider: 'openwop-free',
      tenantId: 'anon:abc',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.completion).toBe('anon ok');
  });

  it('rejects when no managed key seeded', async () => {
    await expect(
      dispatchManagedChat({
        userFacingProvider: 'openwop-free',
        tenantId: 'user:alice',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ code: 'managed_unavailable' });
  });

  it('rejects unknown user-facing provider id', async () => {
    process.env.MINIMAX_API_KEY = 'sk-test';
    await bootstrapManagedProvider();

    await expect(
      dispatchManagedChat({
        userFacingProvider: 'nope-not-a-provider',
        tenantId: 'user:alice',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ code: 'managed_unknown' });
  });

  it('rejects when daily cap already reached', async () => {
    process.env.MINIMAX_API_KEY = 'sk-test';
    await bootstrapManagedProvider();

    // Pre-seed usage at the cap (cap is 100 for the test env).
    const date = new Date().toISOString().slice(0, 10);
    await storage.incrementManagedUsage('user:alice', 'openwop-free', date, 60, 40);

    await expect(
      dispatchManagedChat({
        userFacingProvider: 'openwop-free',
        tenantId: 'user:alice',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ code: 'daily_limit_reached' });
  });

  it('global ceiling rejects a FRESH tenant once cross-tenant usage hits the cap', async () => {
    // The per-tenant cap is evadable on cookie-per-visitor deploys (every
    // fresh cookie jar = a fresh anon tenant). The global ceiling is the
    // operator's spend backstop: pre-seed the reserved bucket at the cap and
    // a brand-new tenant must still be refused.
    process.env.MINIMAX_API_KEY = 'sk-test';
    process.env.OPENWOP_MANAGED_GLOBAL_DAILY_TOKEN_CAP = '500';
    try {
      await bootstrapManagedProvider();
      const date = new Date().toISOString().slice(0, 10);
      await storage.incrementManagedUsage(GLOBAL_USAGE_TENANT, 'openwop-free', date, 300, 200);

      await expect(
        dispatchManagedChat({
          userFacingProvider: 'openwop-free',
          tenantId: 'user:fresh-never-seen',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toMatchObject({ code: 'daily_limit_reached' });
    } finally {
      delete process.env.OPENWOP_MANAGED_GLOBAL_DAILY_TOKEN_CAP;
    }
  });

  it('global ceiling is disabled when the env var is unset', async () => {
    // Same pre-seeded global bucket, no cap configured → the per-tenant cap
    // is the only gate, and this fresh tenant is under it (managed key absent
    // would be the next failure, so expect managed_unavailable NOT
    // daily_limit_reached after clearing the key).
    process.env.MINIMAX_API_KEY = 'sk-test';
    await bootstrapManagedProvider();
    const date = new Date().toISOString().slice(0, 10);
    await storage.incrementManagedUsage(GLOBAL_USAGE_TENANT, 'openwop-free', date, 9_000_000, 0);

    // No OPENWOP_MANAGED_GLOBAL_DAILY_TOKEN_CAP set → dispatch proceeds past
    // both cap checks (it will fail later on the mocked transport only if we
    // let it run — mock a tiny success instead).
    mockMiniMaxSseOnce('ok', 1, 1);
    const result = await dispatchManagedChat({
      userFacingProvider: 'openwop-free',
      tenantId: 'user:fresh-2',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.completion).toBe('ok');
  });
});

/** SSE mock shared with the happy-path block below (hoisted here so the
 *  global-ceiling-disabled test can dispatch end-to-end). */
function mockMiniMaxSseOnce(completion: string, inputTokens: number, outputTokens: number): void {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: completion } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens } })}\n\n`,
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

describe('dispatchManagedChat — happy path', () => {
  function mockMiniMaxSse(completion: string, inputTokens: number, outputTokens: number): void {
    // Synthesize an SSE response that dispatchMiniMax can stream-parse.
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: completion } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens } })}\n\n`,
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

  it('routes through the underlying provider but returns user-facing ids', async () => {
    process.env.MINIMAX_API_KEY = 'sk-happy';
    await bootstrapManagedProvider();
    mockMiniMaxSse('hello there', 7, 3);

    const result = await dispatchManagedChat({
      userFacingProvider: 'openwop-free',
      tenantId: 'user:alice',
      messages: [{ role: 'user', content: 'say hi' }],
    });

    expect(result.completion).toBe('hello there');
    expect(result.provider).toBe('openwop-free'); // user-facing, NOT 'minimax'
    expect(result.model).toBe('openwop-free');    // user-facing, NOT 'MiniMax-M2'
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('increments per-tenant usage after a successful dispatch', async () => {
    process.env.MINIMAX_API_KEY = 'sk-happy';
    await bootstrapManagedProvider();
    mockMiniMaxSse('ok', 5, 11);

    await dispatchManagedChat({
      userFacingProvider: 'openwop-free',
      tenantId: 'user:alice',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const date = new Date().toISOString().slice(0, 10);
    const usage = await storage.getManagedUsage('user:alice', 'openwop-free', date);
    expect(usage).toEqual({ inputTokens: 5, outputTokens: 11 });
    // The reserved global bucket accrues in lockstep (spend backstop history
    // exists even before the operator enables the ceiling).
    const globalUsage = await storage.getManagedUsage(GLOBAL_USAGE_TENANT, 'openwop-free', date);
    expect(globalUsage).toEqual({ inputTokens: 5, outputTokens: 11 });
  });

  it('underlying provider name does NOT appear in the returned result fields', async () => {
    // Belt-and-suspenders: scan the entire result object for the literal
    // string "minimax" — any leak would indicate the underlying id slipped
    // past the rewrite at the dispatchManagedChat boundary.
    process.env.MINIMAX_API_KEY = 'sk-test';
    await bootstrapManagedProvider();
    mockMiniMaxSse('greetings', 2, 1);

    const result = await dispatchManagedChat({
      userFacingProvider: 'openwop-free',
      tenantId: 'user:alice',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain('minimax');
  });
});

describe('dispatchManagedChat — system prompt injection', () => {
  /** Capture the request body sent to MiniMax so we can inspect the
   *  messages[] array for system-prompt injection. */
  function captureRequestBody(): { body: () => Record<string, unknown> | null } {
    const captured: { current: Record<string, unknown> | null } = { current: null };
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      try {
        captured.current = JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}'));
      } catch {
        captured.current = null;
      }
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`));
          controller.enqueue(enc.encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    return { body: () => captured.current };
  }

  it('injects the default system prompt when no system message is present', async () => {
    process.env.MINIMAX_API_KEY = 'sk-test';
    delete process.env.OPENWOP_MANAGED_SYSTEM_PROMPT;
    await bootstrapManagedProvider();
    const cap = captureRequestBody();

    await dispatchManagedChat({
      userFacingProvider: 'openwop-free',
      tenantId: 'user:alice',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const sent = cap.body();
    expect(sent).toBeTruthy();
    const messages = sent!.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe('system');
    // A default grounding prompt is injected, and it is brand-NEUTRAL: a
    // white-label deploy that doesn't set OPENWOP_MANAGED_SYSTEM_PROMPT must
    // not leak a product name. The branded variant is supplied via that env
    // var (covered by the override test below).
    expect(messages[0]?.content).toMatch(/helpful AI assistant/i);
    expect(messages[0]?.content).not.toMatch(/OpenWOP/i);
    expect(messages[1]?.role).toBe('user');
  });

  it('preserves a caller-supplied system message (no override)', async () => {
    process.env.MINIMAX_API_KEY = 'sk-test';
    await bootstrapManagedProvider();
    const cap = captureRequestBody();

    await dispatchManagedChat({
      userFacingProvider: 'openwop-free',
      tenantId: 'user:alice',
      messages: [
        { role: 'system', content: 'You are a pirate.' },
        { role: 'user', content: 'hi' },
      ],
    });

    const sent = cap.body();
    const messages = sent!.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe('You are a pirate.');
  });

  it('honors OPENWOP_MANAGED_SYSTEM_PROMPT env override', async () => {
    process.env.MINIMAX_API_KEY = 'sk-test';
    process.env.OPENWOP_MANAGED_SYSTEM_PROMPT = 'CUSTOM OPERATOR PROMPT';
    await bootstrapManagedProvider();
    const cap = captureRequestBody();

    await dispatchManagedChat({
      userFacingProvider: 'openwop-free',
      tenantId: 'user:alice',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const sent = cap.body();
    const messages = sent!.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe('CUSTOM OPERATOR PROMPT');

    delete process.env.OPENWOP_MANAGED_SYSTEM_PROMPT;
  });

  it('strips <think> blocks from the MiniMax response', async () => {
    process.env.MINIMAX_API_KEY = 'sk-test';
    delete process.env.OPENWOP_MANAGED_SYSTEM_PROMPT;
    await bootstrapManagedProvider();

    // Synthesize an SSE response with an inline think block.
    const enc = new TextEncoder();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '<think>scratchpad</think>' } }] })}\n\n`));
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'visible answer' } }] })}\n\n`));
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 5 } })}\n\n`));
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );

    const result = await dispatchManagedChat({
      userFacingProvider: 'openwop-free',
      tenantId: 'user:alice',
      messages: [{ role: 'user', content: 'hi' }],
    });

    // Visible answer should be the only content the caller sees.
    expect(result.completion).toBe('visible answer');
    expect(result.completion).not.toContain('think');
    expect(result.completion).not.toContain('scratchpad');
  });
});

describe('getManagedProviderStatuses — readiness probe', () => {
  it('reports openwop-free as NOT ready when no key is seeded', async () => {
    // No MINIMAX_API_KEY (deleted in beforeEach) → key never seeded.
    // This is the silent-degrade regression: tier advertised, key absent.
    const statuses = await getManagedProviderStatuses();
    const free = statuses.find((s) => s.providerId === 'openwop-free');
    expect(free).toBeTruthy();
    expect(free!.ready).toBe(false);
    // Detail names the env var an operator must set, so the readiness
    // payload is self-explanatory at deploy time.
    expect(free!.detail).toContain('MINIMAX_API_KEY');
  });

  it('reports openwop-free as ready once the key is seeded', async () => {
    process.env.MINIMAX_API_KEY = 'sk-ready';
    await bootstrapManagedProvider();

    const statuses = await getManagedProviderStatuses();
    const free = statuses.find((s) => s.providerId === 'openwop-free');
    expect(free!.ready).toBe(true);
    expect(free!.detail).toBe('');
  });

  it('only reports providers advertised as managed in providers.json', async () => {
    const statuses = await getManagedProviderStatuses();
    // providers.json advertises exactly one managed tier today.
    expect(statuses.map((s) => s.providerId)).toEqual(['openwop-free']);
  });
});

describe('ManagedProviderError', () => {
  it('carries an error code on the instance', () => {
    const err = new ManagedProviderError('sign_in_required', 'sign in');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('sign_in_required');
    expect(err.message).toBe('sign in');
  });
});
