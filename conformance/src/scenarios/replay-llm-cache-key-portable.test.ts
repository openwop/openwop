/**
 * replay-llm-cache-key-portable — RFC 0041 §E SECURITY-invariant probe.
 *
 * Status: ACTIVE (capability-gated behavioral). Gated on
 * `capabilities.multiAgent.executionModel.version >= 4` AND
 * `capabilities.multiAgent.executionModel.replayDeterminism.llmCacheKeyRecipe: "spec-rfc-0041"`.
 *
 * The CROSS-host parity assertion in `replay-llm-cache-key.test.ts §D`
 * (gated on `OPENWOP_BASE_URL_B`) is the cross-instance probe. This file
 * is the SECURITY-tier complement: it asserts that the SINGLE-host
 * recipe is portable in the strict sense — given the recipe input, the
 * host's emitted key is reproducible offline from the recipe alone
 * (no host-internal secrets, sequence numbers, or trace context
 * influence the key).
 *
 * Asserts:
 *
 *   1. Two probes with byte-identical recipe input MUST yield the same
 *      cache key (intra-host determinism; subsumes the SECURITY
 *      portability requirement at the single-host boundary).
 *
 *   2. The emitted key is reproducible offline: locally recomputed
 *      SHA-256-over-RFC-8785-JCS over the canonical recipe MUST equal
 *      the host's emission. This is the load-bearing claim — without
 *      it, the recipe is private host state masquerading as a content-
 *      addressable hash.
 *
 *   3. (Negative) Permuting any non-recipe field (`max_tokens`, `stop`,
 *      `stream`, `seed`, `metadata`, `user`, request IDs, trace context)
 *      MUST NOT shift the key. This is the security boundary: hosts
 *      that mix non-recipe state into the key leak that state across
 *      the cache boundary, defeating the portability claim and (via
 *      the SR-1 sibling invariant) potentially leaking BYOK plaintexts
 *      through the cache.
 *
 *   4. (Gated on Phase 4 advertisement.) The host's discovery doc MUST
 *      advertise `replayDeterminism.llmCacheKeyRecipe` matching the
 *      recipe it honors — `spec-rfc-0041` for the canonical recipe,
 *      `x-host-<host>-<recipe-name>` for vendor variants per
 *      `host-extensions.md` §"Canonical prefixes".
 *
 * The behavioral assertions reuse the existing test seam at
 * `POST /v1/host/sample/test/llm-cache-key` (the same seam the sibling
 * `replay-llm-cache-key.test.ts` drives). Hosts that don't expose the
 * seam return 404 and the scenario soft-skips.
 *
 * @see RFCS/0041-multi-agent-replay-under-nondeterminism.md §E
 * @see SECURITY/invariants.yaml §replay-llm-cache-key-portable
 * @see spec/v1/replay.md §"LLM cache-key recipe" §A + §B + §D
 * @see conformance/src/scenarios/replay-llm-cache-key.test.ts (the sibling behavioral suite)
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

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

interface DiscoveryDoc {
  capabilities?: {
    multiAgent?: {
      executionModel?: {
        version?: unknown;
        replayDeterminism?: {
          supported?: unknown;
          llmCacheKeyRecipe?: unknown;
        };
      };
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch { return null; }
}

describe.skipIf(HTTP_SKIP)('replay-llm-cache-key-portable: intra-host reproducibility (RFC 0041 §E)', () => {
  it('host cache key MUST equal locally-recomputed SHA-256 over canonical JSON (reproducible offline)', async () => {
    const input = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20240620',
      messages: [
        { role: 'system' as const, content: 'portability probe' },
        { role: 'user' as const, content: 'reproduce offline' },
      ],
      temperature: 0.3,
    };
    const result = await callSeam(input);
    if (result.status === 404) return; // seam not exposed — soft-skip
    expect(result.status).toBe(200);
    expect(
      result.cacheKey,
      driver.describe(
        'SECURITY/invariants.yaml §replay-llm-cache-key-portable + replay.md §B',
        'host cache key MUST be reproducible offline from the recipe alone — no host-internal state',
      ),
    ).toBe(expectedCacheKey(input));
  });

  it('two identical probes MUST yield byte-identical keys (intra-host determinism)', async () => {
    const input = {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user' as const, content: 'idempotence probe' }],
      temperature: 0.0,
    };
    const a = await callSeam(input);
    if (a.status === 404) return; // soft-skip
    const b = await callSeam(input);
    expect(
      a.cacheKey,
      driver.describe(
        'SECURITY/invariants.yaml §replay-llm-cache-key-portable',
        'two byte-identical recipe inputs MUST yield byte-identical keys (no per-request entropy)',
      ),
    ).toBe(b.cacheKey);
  });
});

describe.skipIf(HTTP_SKIP)('replay-llm-cache-key-portable: non-recipe-field invariance (RFC 0041 §E security boundary)', () => {
  it('non-recipe fields (request ID, trace context, tenant ID) MUST NOT influence the cache key', async () => {
    const base = {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user' as const, content: 'security-boundary probe' }],
      temperature: 0.5,
    };
    const baseResult = await callSeam(base);
    if (baseResult.status === 404) return; // soft-skip

    // The security boundary: ANY of these fields leaking into the key
    // would expose tenant/request state through cache-collision behavior.
    const polluted = {
      ...base,
      max_tokens: 1000,
      stop: ['STOP'],
      stream: true,
      seed: 42,
      metadata: { tenantId: 'tenant-A', traceparent: '00-deadbeef-cafe-01' },
      user: 'user-42',
      'x-request-id': 'req-abc-123',
    };
    const pollutedResult = await callSeam(polluted);
    expect(
      pollutedResult.cacheKey,
      driver.describe(
        'SECURITY/invariants.yaml §replay-llm-cache-key-portable + replay.md §A',
        'non-recipe fields (request id, trace context, tenant id) MUST NOT influence the cache key — leaking them defeats the portability invariant',
      ),
    ).toBe(baseResult.cacheKey);
  });
});

describe.skipIf(HTTP_SKIP)('replay-llm-cache-key-portable: Phase 4 advertisement alignment (RFC 0041 §D)', () => {
  it('hosts advertising version: 4 MUST advertise replayDeterminism.llmCacheKeyRecipe', async () => {
    const d = await readDiscovery();
    const em = d?.capabilities?.multiAgent?.executionModel;
    if ((em?.version as number) < 4) return; // soft-skip — pre-Phase-4

    const recipe = em?.replayDeterminism?.llmCacheKeyRecipe;
    expect(
      typeof recipe === 'string',
      driver.describe(
        'RFCS/0041-multi-agent-replay-under-nondeterminism.md §D',
        'Phase 4 host MUST advertise replayDeterminism.llmCacheKeyRecipe (`spec-rfc-0041` or `x-host-<host>-<recipe>`)',
      ),
    ).toBe(true);

    const r = recipe as string;
    const canonical = r === 'spec-rfc-0041';
    const vendor = /^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/.test(r);
    expect(
      canonical || vendor,
      driver.describe(
        'schemas/capabilities.schema.json §replayDeterminism.llmCacheKeyRecipe',
        'llmCacheKeyRecipe MUST be `spec-rfc-0041` OR match `^x-host-<host>-<recipe>$` per host-extensions.md',
      ),
    ).toBe(true);
  });
});
