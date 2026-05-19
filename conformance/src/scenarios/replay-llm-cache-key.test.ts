/**
 * LLM cache-key recipe — `replay.md §"LLM cache-key recipe"` §A + §B.
 *
 * Verifies that an OpenWOP host computes the LLM cache key per the
 * normative recipe: SHA-256 over RFC 8785 JCS-canonicalized JSON of
 * the closed set of recipe fields (`provider, model, messages, tools,
 * temperature, topP, topK, responseFormat`).
 *
 * The single-host assertions drive the env-gated test seam at
 * `POST /v1/host/sample/test/llm-cache-key` and recompute the expected
 * key locally per the recipe, asserting equality. Non-recipe fields
 * (`max_tokens`, `stop`, `stream`, `seed`, etc.) MUST NOT influence
 * the key — per §A.
 *
 * The cross-host assertion (two hosts compute the same key) stays
 * deferred — it requires `OPENWOP_BASE_URL_B` for a second-host probe,
 * which is operator-supplied and outside this scenario file's scope.
 *
 * @see spec/v1/replay.md §"LLM cache-key recipe"
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { driver } from '../lib/driver.js';

/** Mirror of the reference impl's `canonicalize` so the conformance
 *  scenario can recompute the expected cache key locally and assert
 *  equality with what the host returns. RFC 8785 JCS-style:
 *  sorted-keys, no whitespace, preserve array order. */
function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',') + '}';
  }
  return JSON.stringify(value);
}

function projectRecipe(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { provider: raw.provider, model: raw.model, messages: raw.messages };
  if (Array.isArray(raw.tools) && raw.tools.length > 0) {
    out.tools = [...(raw.tools as Array<{ name: string }>)].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (typeof raw.temperature === 'number') out.temperature = raw.temperature;
  if (typeof raw.topP === 'number') out.topP = raw.topP;
  if (typeof raw.topK === 'number') out.topK = raw.topK;
  if (raw.responseFormat && typeof raw.responseFormat === 'object') out.responseFormat = raw.responseFormat;
  return out;
}

function expectedCacheKey(input: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalize(projectRecipe(input)), 'utf8').digest('hex');
}

async function callSeam(input: Record<string, unknown>): Promise<{ status: number; cacheKey?: string }> {
  const res = await driver.post('/v1/host/sample/test/llm-cache-key', input);
  const cacheKey = (res.json as { cacheKey?: string }).cacheKey;
  return cacheKey !== undefined ? { status: res.status, cacheKey } : { status: res.status };
}

describe('replay-llm-cache-key: SHA-256-over-JCS recipe (replay.md §B)', () => {
  it('host cache key MUST equal locally-recomputed SHA-256 over canonical JSON', async () => {
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
      driver.describe('replay.md §B', 'host cache key MUST be lowercase-hex SHA-256 of the canonical recipe JSON'),
    ).toBe(expectedCacheKey(input));
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

describe('replay-llm-cache-key: non-recipe fields are EXCLUDED (replay.md §A)', () => {
  it('max_tokens / stop / stream / seed / metadata / user MUST NOT influence the cache key', async () => {
    const base = {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'unit test' }],
      temperature: 0.5,
    };
    const baseResult = await callSeam(base);
    if (baseResult.status === 404) return;

    // All these non-recipe fields MUST NOT affect the cache key per §A.
    const noisy = {
      ...base,
      max_tokens: 1000,
      stop: ['STOP'],
      stream: true,
      seed: 42,
      metadata: { traceId: 'abcd' },
      user: 'unit-test-user',
    };
    const noisyResult = await callSeam(noisy);
    expect(
      noisyResult.cacheKey,
      driver.describe(
        'replay.md §A',
        'cache key MUST be invariant under non-recipe field changes (max_tokens, stop, stream, seed, metadata, user)',
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

describe('replay-llm-cache-key: cross-host parity (replay.md §D)', () => {
  it('two hosts compute the same cache key for the same input (when OPENWOP_BASE_URL_B is configured)', async () => {
    const otherBaseUrl = process.env.OPENWOP_BASE_URL_B;
    if (!otherBaseUrl || otherBaseUrl.length === 0) return; // second host not configured — soft-skip
    const input = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20240620',
      messages: [
        { role: 'system' as const, content: 'cross-host parity probe' },
        { role: 'user' as const, content: 'compute the same key' },
      ],
      temperature: 0.5,
    };
    const a = await callSeam(input);
    if (a.status === 404) return; // host A doesn't expose the seam
    const otherApiKey = process.env.OPENWOP_API_KEY_B ?? process.env.OPENWOP_API_KEY ?? '';
    // Issue the second probe directly via fetch since the driver is bound to
    // OPENWOP_BASE_URL. Authorization mirrors the suite's default.
    const resB = await fetch(`${otherBaseUrl.replace(/\/$/, '')}/v1/host/sample/test/llm-cache-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherApiKey}` },
      body: JSON.stringify(input),
    });
    if (resB.status === 404) return; // host B doesn't expose the seam
    expect(resB.status).toBe(200);
    const b = (await resB.json()) as { cacheKey?: string };
    expect(
      a.cacheKey,
      driver.describe('replay.md §D', 'two compliant hosts MUST compute byte-identical cache keys for the same recipe input'),
    ).toBe(b.cacheKey);
  });
});
