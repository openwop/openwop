/**
 * managedProvider — server-held key, sign-in gating, per-tenant daily
 * token cap. The underlying provider stays hidden behind the user-
 * facing id ('openwop-free').
 *
 * Covers:
 *   1. Bootstrap reads MINIMAX_API_KEY → encrypts → writes to byok_secrets.
 *   2. Bootstrap is idempotent (same env value = no re-write).
 *   3. Bootstrap rotates when env value changes.
 *   4. Anonymous tenants (`anon:*`) get `sign_in_required`.
 *   5. Daily cap enforced once a tenant reaches OPENWOP_MANAGED_DAILY_TOKEN_CAP.
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
  bootstrapManagedProvider,
  configureManagedProvider,
  dispatchManagedChat,
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
  it('rejects anonymous tenants with sign_in_required', async () => {
    process.env.MINIMAX_API_KEY = 'sk-test';
    await bootstrapManagedProvider();

    await expect(
      dispatchManagedChat({
        userFacingProvider: 'openwop-free',
        tenantId: 'anon:abc',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ code: 'sign_in_required' });
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
});

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

describe('ManagedProviderError', () => {
  it('carries an error code on the instance', () => {
    const err = new ManagedProviderError('sign_in_required', 'sign in');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('sign_in_required');
    expect(err.message).toBe('sign in');
  });
});
