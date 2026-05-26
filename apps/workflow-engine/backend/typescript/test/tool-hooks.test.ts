/**
 * RFC 0064 — tool-invocation hooks + per-tool authorization/rate-limit.
 *
 * Unit-tests the host evaluator that backs both the live MCP path and the
 * `POST /v1/host/sample/toolhooks/invoke` conformance seam:
 *   - ok path: status 'ok', argsHash is a 64-char hex digest
 *   - authorization fail-closed: missing/short scopes → 'forbidden' (403)
 *   - rate limit: bucket exhaustion / simulate flag → 'rate_limited' (429)
 *   - SR-1: a secret-shaped arg never survives into the hash preimage
 *
 * @see RFCS/0064-tool-invocation-hooks-and-authorization.md
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  evaluateToolHook,
  computeArgsHash,
  resetToolHookBuckets,
} from '../src/host/toolHooks.js';
import { canonicalize } from '../src/providers/llmCacheKey.js';
import { sanitizeFreeTextDeep } from '../src/byok/textRedaction.js';

beforeEach(() => {
  resetToolHookBuckets();
});

describe('RFC 0064 — evaluateToolHook', () => {
  it('ok: authorized + within budget runs the tool and hashes args', () => {
    const r = evaluateToolHook({
      principal: 'user:alice',
      toolName: 'search',
      requiredScopes: ['tools.search'],
      grantedScopes: ['tools.search', 'tools.read'],
      args: { q: 'hello' },
      transport: 'mcp',
    });
    expect(r.httpStatus).toBe(200);
    expect(r.toolReturned.status).toBe('ok');
    expect(r.toolReturned.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.toolCalled.transport).toBe('mcp');
    expect(r.toolCalled.principal).toBe('user:alice');
    expect(r.toolCalled.argsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.errorCode).toBeUndefined();
  });

  it('forbidden (fail-closed): principal lacks a required scope', () => {
    const r = evaluateToolHook({
      principal: 'user:bob',
      toolName: 'delete',
      requiredScopes: ['tools.delete'],
      grantedScopes: ['tools.read'],
      args: {},
    });
    expect(r.httpStatus).toBe(403);
    expect(r.toolReturned.status).toBe('forbidden');
    expect(r.toolReturned.durationMs).toBeUndefined();
    expect(r.errorCode).toBe('forbidden');
  });

  it('forbidden (fail-closed): scopes unevaluable (grantedScopes absent)', () => {
    const r = evaluateToolHook({
      principal: 'user:bob',
      toolName: 'delete',
      requiredScopes: ['tools.delete'],
      args: {},
    });
    expect(r.httpStatus).toBe(403);
    expect(r.toolReturned.status).toBe('forbidden');
  });

  it('rate_limited: simulate flag forces the rate-limit branch', () => {
    const r = evaluateToolHook({
      principal: 'user:alice',
      toolName: 'search',
      args: {},
      simulateRateLimitExhausted: true,
    });
    expect(r.httpStatus).toBe(429);
    expect(r.toolReturned.status).toBe('rate_limited');
    expect(r.toolReturned.durationMs).toBeUndefined();
    expect(r.errorCode).toBe('rate_limited');
  });

  it('rate_limited: per-(principal,tool) bucket exhausts after capacity', () => {
    const call = () =>
      evaluateToolHook({ principal: 'p', toolName: 't', args: {} }).toolReturned.status;
    // Capacity is 5; the 6th call within the window is rate-limited.
    const statuses = Array.from({ length: 6 }, call);
    expect(statuses.slice(0, 5)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(statuses[5]).toBe('rate_limited');
  });
});

describe('RFC 0064 — SR-1 content-free argsHash', () => {
  it('redacts a secret-shaped arg before hashing (preimage carries no secret)', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123';
    const redacted = sanitizeFreeTextDeep({ apiKey: secret });
    const preimage = canonicalize(redacted);
    expect(preimage).not.toContain(secret);
    expect(preimage).toContain('sk-***');
  });

  it('argsHash with a secret equals argsHash with the redacted placeholder', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123';
    const withSecret = computeArgsHash({ apiKey: secret });
    const withPlaceholder = computeArgsHash({ apiKey: 'sk-***' });
    expect(withSecret).toBe(withPlaceholder);
  });
});
