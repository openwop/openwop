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
 *      SHA-256-over-RFC-8785-JCS over the canonical **v2** semantic request
 *      (RFC 0150 §C, `recipe: "openwop-semantic-request-v2"`) MUST equal
 *      the host's emission. This is the load-bearing claim — without
 *      it, the recipe is private host state masquerading as a content-
 *      addressable hash.
 *
 *   3. (Negative) Permuting any transport-only field (`stream`, `metadata`,
 *      `user`, request IDs, trace context, tenant id, timeout) MUST NOT
 *      shift the key. (`max_tokens`/`stop`/`seed` were in this list until
 *      suite 1.109.0; RFC 0150 §C moved them INTO the recipe because each
 *      changes the completion — see `replay-llm-cache-key.test.ts` for the
 *      sensitivity legs. Asserting their exclusion here was the suite
 *      contradicting `semantic-digest-v2.test.ts` in the same package.) This is the security boundary: hosts
 *      that mix non-recipe state into the key leak that state across
 *      the cache boundary, defeating the portability claim and (via
 *      the SR-1 sibling invariant) potentially leaking BYOK plaintexts
 *      through the cache.
 *
 *   4. (Gated on Phase 4 advertisement.) The host's discovery doc MUST
 *      advertise `replayDeterminism.llmCacheKeyRecipe` matching the
 *      recipe it honors — `spec-rfc-0041` for the canonical recipe (which,
 *      since RFC 0150 §C replaced §A/§B in place, IS the v2 recipe),
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
 * @see spec/v1/replay.md §"LLM cache-key recipe" §A + §B + §D (v2, RFC 0150 §C)
 * @see conformance/src/scenarios/replay-llm-cache-key.test.ts (the sibling behavioral suite)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { semanticRequestDigestV2, callCacheKeySeam as callSeam } from '../lib/llm-cache-key-recipe.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

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
  it('host cache key MUST equal locally-recomputed SHA-256 over canonical JSON (reproducible offline)', async (ctx) => {
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
    if (result.status === 404) {
      ctx.skip(); // host doesn't expose the test seam
      return softSkip('blocked', 'precondition not met — `result.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(result.status).toBe(200);
    expect(
      result.cacheKey,
      req('openwop.it.replay-llm-cache-key-portable.host-cache-key-must-equal-locally-recomputed-sha-256-over-canonical-json-reprodu', 
        'SECURITY/invariants.yaml §replay-llm-cache-key-portable + replay.md §B',
        'host cache key MUST be reproducible offline from the recipe alone — no host-internal state',
      ),
    ).toBe(semanticRequestDigestV2(input));
  });

  it('two identical probes MUST yield byte-identical keys (intra-host determinism)', async (ctx) => {
    const input = {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user' as const, content: 'idempotence probe' }],
      temperature: 0.0,
    };
    const a = await callSeam(input);
    if (a.status === 404) {
      ctx.skip(); // host doesn't expose the test seam
      return softSkip('blocked', 'precondition not met — `a.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    const b = await callSeam(input);
    expect(
      a.cacheKey,
      req('openwop.it.replay-llm-cache-key-portable.two-identical-probes-must-yield-byte-identical-keys-intra-host-determinism', 
        'SECURITY/invariants.yaml §replay-llm-cache-key-portable',
        'two byte-identical recipe inputs MUST yield byte-identical keys (no per-request entropy)',
      ),
    ).toBe(b.cacheKey);
  });
});

describe.skipIf(HTTP_SKIP)('replay-llm-cache-key-portable: non-recipe-field invariance (RFC 0041 §E security boundary)', () => {
  it('transport-only fields (request ID, trace context, tenant ID) MUST NOT influence the cache key', async (ctx) => {
    const base = {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user' as const, content: 'security-boundary probe' }],
      temperature: 0.5,
    };
    const baseResult = await callSeam(base);
    if (baseResult.status === 404) {
      ctx.skip(); // host doesn't expose the test seam
      return softSkip('blocked', 'precondition not met — `baseResult.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }

    // The security boundary: ANY of these fields leaking into the key
    // would expose tenant/request state through cache-collision behavior.
    const polluted = {
      ...base,
      stream: true,
      metadata: { tenantId: 'tenant-A', traceparent: '00-deadbeef-cafe-01' },
      user: 'user-42',
      'x-request-id': 'req-abc-123',
      tenantId: 'tenant-A',
      timeoutMs: 30_000,
      runId: 'run_123',
    };
    const pollutedResult = await callSeam(polluted);
    expect(
      pollutedResult.cacheKey,
      req('openwop.it.replay-llm-cache-key-portable.transport-only-fields-request-id-trace-context-tenant-id-must-not-influence-the', 
        'SECURITY/invariants.yaml §replay-llm-cache-key-portable + replay.md §A',
        'transport-only fields (request id, trace context, tenant id, run id, timeout) MUST NOT influence the cache key — leaking them defeats the portability invariant',
      ),
    ).toBe(baseResult.cacheKey);
  });
});

describe.skipIf(HTTP_SKIP)('replay-llm-cache-key-portable: Phase 4 advertisement alignment (RFC 0041 §D)', () => {
  it('hosts advertising version: 4 MUST advertise replayDeterminism.llmCacheKeyRecipe', async (ctx) => {
    const d = await readDiscovery();
    const em = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel;
    const version = em?.version;
    if (typeof version !== 'number' || version < 4) {
      ctx.skip(); // pre-Phase-4 or no multiAgent advertisement
      return softSkip('blocked', 'precondition not met — `typeof version !== \'number\' || version < 4` returned early (seam, prior step, or fixture unavailable)');
    }

    const recipe = em?.replayDeterminism?.llmCacheKeyRecipe;
    expect(
      typeof recipe === 'string',
      req('openwop.it.replay-llm-cache-key-portable.hosts-advertising-version-4-must-advertise-replaydeterminism-llmcachekeyrecipe', 
        'RFCS/0041-multi-agent-replay-under-nondeterminism.md §D',
        'Phase 4 host MUST advertise replayDeterminism.llmCacheKeyRecipe (`spec-rfc-0041` or `x-host-<host>-<recipe>`)',
      ),
    ).toBe(true);

    const r = recipe as string;
    const canonical = r === 'spec-rfc-0041';
    const vendor = /^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/.test(r);
    expect(
      canonical || vendor,
      req('openwop.it.replay-llm-cache-key-portable.hosts-advertising-version-4-must-advertise-replaydeterminism-llmcachekeyrecipe', 
        'schemas/capabilities.schema.json §replayDeterminism.llmCacheKeyRecipe',
        'llmCacheKeyRecipe MUST be `spec-rfc-0041` OR match `^x-host-<host>-<recipe>$` per host-extensions.md',
      ),
    ).toBe(true);
  });
});
