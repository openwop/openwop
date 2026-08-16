/**
 * LLM cache-key recipe — `replay.md §"LLM cache-key recipe"` §A + §B, at the
 * RFC 0150 §C **v2** semantic request.
 *
 * Verifies that an OpenWOP host computes the LLM cache key per the normative
 * recipe: SHA-256 over RFC 8785 JCS-canonicalized JSON of the v2 canonical
 * object — `{ recipe: "openwop-semantic-request-v2", provider, model,
 * request: { messages, tools?, temperature?, topP?, topK?, maxOutputTokens?,
 * seed?, stop?, responseFormat?, safetySettings? }, providerOptions? }`.
 *
 * **Why this file was rewritten (2026-08-16).** Until suite 1.109.0 it
 * recomputed the expected key with the *v1* projection and asserted that
 * `max_tokens / stop / seed` MUST NOT influence the key — while
 * `semantic-digest-v2.test.ts`, in the same package since `730ff3de`, asserted
 * that excluding them "is wrong … a wrong hit, not a miss". A host that
 * implemented the current recipe (openwop-app, ADR 0549 P3) went red here for
 * being right, and the pinned suite contradicted itself. RFC 0150 §C replaced
 * v1 in place as a safety-fix; this file now follows it. `stream`, `metadata`,
 * `user`, request IDs, and trace context remain excluded — they are transport
 * or bookkeeping and cannot change the completion.
 *
 * The single-host assertions drive the seam at
 * `POST /v1/host/sample/test/llm-cache-key` (`host-sample-test-seams.md` §4)
 * and recompute the expected key locally, asserting equality. The cross-host
 * assertion requires `OPENWOP_BASE_URL_B` (operator-supplied).
 *
 * @see spec/v1/replay.md §"LLM cache-key recipe" (v2), RFC 0150 §C
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { semanticRequestDigestV2, callCacheKeySeam as callSeam } from '../lib/llm-cache-key-recipe.js';

describe('replay-llm-cache-key: SHA-256-over-JCS recipe, v2 (replay.md §B, RFC 0150 §C)', () => {
  it('host cache key MUST equal the locally-recomputed v2 semantic-request digest', async () => {
    const input = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20240620',
      messages: [
        { role: 'system' as const, content: 'You are a helpful assistant.' },
        { role: 'user' as const, content: 'What is 2+2?' },
      ],
      temperature: 0.7,
    };
    const result = await callSeam(input);
    if (result.status === 404) return; // seam not exposed
    expect(result.status).toBe(200);
    expect(
      result.cacheKey,
      driver.describe(
        'replay.md §B (RFC 0150 §C)',
        'host cache key MUST be lowercase-hex SHA-256 of the JCS-canonical v2 semantic request ' +
          '(stamped `recipe: "openwop-semantic-request-v2"`); a v1 key here is a host that has ' +
          'not adopted the safety-fix and would return wrong hits for requests differing in seed/stop/max tokens',
      ),
    ).toBe(semanticRequestDigestV2(input));
  });

  it('cache key MUST be 64 lowercase-hex characters (SHA-256 output shape)', async () => {
    const result = await callSeam({
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    });
    if (result.status === 404) return;
    expect(result.cacheKey).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('replay-llm-cache-key: transport-only fields are EXCLUDED (replay.md §A, v2)', () => {
  it('stream / metadata / user / request ids / trace context MUST NOT influence the cache key', async () => {
    const base = {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'unit test' }],
      temperature: 0.5,
    };
    const baseResult = await callSeam(base);
    if (baseResult.status === 404) return;

    // Transport / bookkeeping only. None of these can change what the model
    // returns, so none may change the key. (`max_tokens`, `stop`, and `seed`
    // used to be in this list — they CAN change the completion, which is why
    // RFC 0150 §C moved them into the recipe; see the next describe.)
    const noisy = {
      ...base,
      stream: true,
      metadata: { traceId: 'abcd' },
      user: 'unit-test-user',
      'x-request-id': 'req-123',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      tenantId: 'tenant-b',
      timeoutMs: 30_000,
    };
    const noisyResult = await callSeam(noisy);
    expect(
      noisyResult.cacheKey,
      driver.describe(
        'replay.md §A (v2)',
        'cache key MUST be invariant under transport-only fields (stream, metadata, user, request ids, trace context, tenant, timeout)',
      ),
    ).toBe(baseResult.cacheKey);
  });

  it('changing a recipe field (temperature) MUST yield a different cache key', async () => {
    const baseInput = {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'diversity-probe' }],
      temperature: 0.0,
    };
    const hotInput = { ...baseInput, temperature: 1.0 };
    const baseResult = await callSeam(baseInput);
    if (baseResult.status === 404) return;
    const hotResult = await callSeam(hotInput);
    expect(
      baseResult.cacheKey === hotResult.cacheKey,
      driver.describe('replay.md §A', 'changing a recipe field MUST yield a different cache key (no false collisions)'),
    ).toBe(false);
  });
});

describe('replay-llm-cache-key: outcome-affecting fields are INCLUDED (RFC 0150 §C — the v2 safety-fix)', () => {
  const base = {
    provider: 'openai',
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'v2-sensitivity-probe' }],
    temperature: 0.2,
  };

  // Each of these fields changes the completion. v1 excluded them, which keyed
  // two requests that produce DIFFERENT text to the SAME entry — a wrong hit,
  // not a miss. A host still keying under v1 passes the exclusion leg above and
  // fails here, which is the point: the two legs together distinguish "drops
  // transport fields" from "drops the wrong fields".
  it.each([
    ['seed', { seed: 42 }, { seed: 43 }],
    ['stop', { stop: ['STOP'] }, { stop: ['HALT'] }],
    ['maxOutputTokens', { maxOutputTokens: 100 }, { maxOutputTokens: 1000 }],
  ])('%s DOES change the cache key', async (_field, a, b) => {
    const ra = await callSeam({ ...base, ...a });
    if (ra.status === 404) return;
    const rb = await callSeam({ ...base, ...b });
    expect(
      ra.cacheKey === rb.cacheKey,
      driver.describe(
        'replay.md §A (RFC 0150 §C)',
        `\`${_field}\` decides the completion, so two requests differing only in it MUST NOT share a cache key — ` +
          'sharing one returns a response the caller never asked for, deterministically',
      ),
    ).toBe(false);
    // And each side MUST equal the locally-recomputed v2 digest, so a host cannot
    // pass this leg by salting the key with something arbitrary.
    expect(ra.cacheKey, driver.describe('replay.md §B (v2)', 'key MUST equal the v2 digest')).toBe(
      semanticRequestDigestV2({ ...base, ...a }),
    );
    expect(rb.cacheKey, driver.describe('replay.md §B (v2)', 'key MUST equal the v2 digest')).toBe(
      semanticRequestDigestV2({ ...base, ...b }),
    );
  });

  it('providerOptions are carried into the key, not dropped', async () => {
    const withOpts = { ...base, providerOptions: { 'vendor.openai.logitBias': { '50256': -100 } } };
    const withOtherOpts = { ...base, providerOptions: { 'vendor.openai.logitBias': { '50256': 100 } } };
    const r1 = await callSeam(withOpts);
    if (r1.status === 404) return;
    const r2 = await callSeam(withOtherOpts);
    expect(
      r1.cacheKey === r2.cacheKey,
      driver.describe(
        'replay.md §B step 1 (RFC 0150 §C)',
        'an unknown provider option MUST be carried into `providerOptions` before hashing — a dropped option ' +
          'that alters output is indistinguishable from one that was never set',
      ),
    ).toBe(false);
    expect(r1.cacheKey, driver.describe('replay.md §B (v2)', 'key MUST equal the v2 digest')).toBe(
      semanticRequestDigestV2(withOpts),
    );
  });
});

describe('replay-llm-cache-key: cross-host parity (replay.md §D)', () => {
  it('two hosts compute the same cache key for the same input (when OPENWOP_BASE_URL_B is configured)', async () => {
    const otherBaseUrl = process.env['OPENWOP_BASE_URL_B'];
    if (!otherBaseUrl) return; // operator-supplied second host not configured
    const input = {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'cross-host parity probe' }],
      temperature: 0.3,
      seed: 7,
    };
    const resA = await callSeam(input);
    if (resA.status === 404) return;
    const resB = await fetch(`${otherBaseUrl.replace(/\/$/, '')}/v1/host/sample/test/llm-cache-key`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (resB.status === 404) return;
    const jsonB = (await resB.json()) as { cacheKey?: string };
    expect(
      jsonB.cacheKey,
      driver.describe('replay.md §D', 'two compliant hosts MUST compute byte-identical cache keys for the same recipe input'),
    ).toBe(resA.cacheKey);
    expect(resA.cacheKey, driver.describe('replay.md §B (v2)', 'and both MUST equal the v2 digest')).toBe(
      semanticRequestDigestV2(input),
    );
  });
});
