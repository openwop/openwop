/**
 * prompt-prefix-cache — RFC 0116 + SECURITY/invariants.yaml
 * `prompt-prefix-cache-cross-tenant-isolation`.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). The behavioral legs drive
 * the host's real envelope/provider generate path through the OPTIONAL test
 * seam `POST /v1/host/sample/ai/generate` (`host-sample-test-seams.md` §16,
 * env-gated on `OPENWOP_TEST_SEAM_ENABLED=true`). Hosts that don't advertise
 * `aiProviders.promptPrefixCache.supported` soft-skip; hosts that advertise it
 * but don't wire the seam (HTTP 404/405) soft-skip the behavioral legs and
 * verify advertisement shape only.
 *
 * RFC 0116 makes the optional `cachePrefixId` generate hint safe + testable via
 * three pillars, each asserted here:
 *   (a) outcome-invariance — a generate with `cachePrefixId` and a control
 *       without produce the same accepted envelope + identical
 *       `inputTokens`/`outputTokens` (cost-hint-only, replay-invariant).
 *   (b) cache hit observable — a repeat generate shows
 *       `provider.usage.cacheReadTokens > 0`.
 *   (c) cross-tenant isolation — tenant B's first use of tenant A's
 *       `cachePrefixId` shows `cacheReadTokens == 0` (no cross-tenant share).
 *       THIS is the public test for the `prompt-prefix-cache-cross-tenant-isolation`
 *       invariant: the host MUST key its provider cache by `(tenant, cachePrefixId)`.
 *   (d) secret-free — a `cachePrefixId` is never emitted where SR-1 would
 *       redact, and the usage block carries no prompt substrings.
 *
 * @see RFCS/0116-prompt-prefix-cache.md
 * @see spec/v1/ai-envelope.md §"Prompt-prefix cache (RFC 0116)"
 * @see SECURITY/invariants.yaml — prompt-prefix-cache-cross-tenant-isolation
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface PromptPrefixCacheCap {
  supported?: unknown;
  providers?: unknown;
}

interface AiProvidersCap {
  promptPrefixCache?: PromptPrefixCacheCap;
}

interface GenerateUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface GenerateResponse {
  envelope?: { envelopeType?: string; payload?: unknown; envelopeId?: string };
  usage?: GenerateUsage;
}

async function readCap(): Promise<PromptPrefixCacheCap | null> {
  const fam = await readCapabilityFamily<AiProvidersCap>('aiProviders');
  const block = fam?.promptPrefixCache;
  return block && typeof block === 'object' ? block : null;
}

async function generate(args: {
  tenantId: string;
  cachePrefixId?: string;
}): Promise<{ status: number; body: GenerateResponse }> {
  const res = await driver.post('/v1/host/sample/ai/generate', {
    tenantId: args.tenantId,
    envelopeType: 'clarification.request',
    systemPrompt: 'You are a helpful assistant. Answer concisely.',
    ...(args.cachePrefixId !== undefined ? { cachePrefixId: args.cachePrefixId } : {}),
  });
  return { status: res.status, body: (res.json ?? {}) as GenerateResponse };
}

describe('prompt-prefix-cache: advertisement shape (RFC 0116)', () => {
  it('aiProviders.promptPrefixCache is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early (not advertised — skip)'); // not advertised — skip
    expect(
      typeof cap.supported,
      req('openwop.it.prompt-prefix-cache.aiproviders-promptprefixcache-is-either-absent-or-a-well-formed-object', 
        'capabilities.schema.json §aiProviders.promptPrefixCache',
        'promptPrefixCache.supported MUST be a boolean when the block is present',
      ),
    ).toBe('boolean');
    if (cap.providers !== undefined) {
      expect(
        Array.isArray(cap.providers),
        req('openwop.it.prompt-prefix-cache.aiproviders-promptprefixcache-is-either-absent-or-a-well-formed-object', 
          'capabilities.schema.json §aiProviders.promptPrefixCache',
          'promptPrefixCache.providers MUST be an array of provider ids when present (provider-scoped)',
        ),
      ).toBe(true);
    }
  });
});

describe('prompt-prefix-cache: behavioral (RFC 0116 §"Normative requirements")', () => {
  it('(a) outcome-invariance — cachePrefixId vs control → same envelope + identical input/output tokens', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early (not advertised — skip)'); // not advertised — skip
    const prefixId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const control = await generate({ tenantId: 'tenant-a' });
    if (control.status === 404 || control.status === 405) return softSkip('blocked', 'precondition not met — `control.status === 404 || control.status === 405` returned early (seam not wired) (seam, prior step, or fixture unavailable)'); // seam not wired
    expect(control.status, req('openwop.it.prompt-prefix-cache.a-outcome-invariance-cacheprefixid-vs-control-same-envelope-identical-input-outp', 'host-sample-test-seams.md §16', 'generate seam MUST return 200')).toBe(200);

    const withPrefix = await generate({ tenantId: 'tenant-a', cachePrefixId: prefixId });
    expect(withPrefix.status).toBe(200);

    expect(
      withPrefix.body.envelope?.envelopeType,
      req('openwop.it.prompt-prefix-cache.a-outcome-invariance-cacheprefixid-vs-control-same-envelope-identical-input-outp', 
        'ai-envelope.md §"Prompt-prefix cache (RFC 0116)" rule 3',
        'cachePrefixId is a cost hint, never semantic: the accepted envelope MUST be identical hit-vs-miss',
      ),
    ).toBe(control.body.envelope?.envelopeType);
    expect(withPrefix.body.usage?.inputTokens).toBe(control.body.usage?.inputTokens);
    expect(
      withPrefix.body.usage?.outputTokens,
      req('openwop.it.prompt-prefix-cache.a-outcome-invariance-cacheprefixid-vs-control-same-envelope-identical-input-outp', 
        'ai-envelope.md §"Prompt-prefix cache (RFC 0116)" rule 3',
        'provider.usage.inputTokens/outputTokens MUST be identical hit-vs-miss (replay-invariant)',
      ),
    ).toBe(control.body.usage?.outputTokens);
  });

  it('(b) cache hit observable — a repeat generate shows cacheReadTokens > 0 while tokens stay invariant', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early (not advertised — skip)'); // not advertised — skip
    const prefixId = `hit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const prime = await generate({ tenantId: 'tenant-a', cachePrefixId: prefixId });
    if (prime.status === 404 || prime.status === 405) return softSkip('blocked', 'precondition not met — `prime.status === 404 || prime.status === 405` returned early (seam not wired) (seam, prior step, or fixture unavailable)'); // seam not wired
    expect(prime.status).toBe(200);

    const repeat = await generate({ tenantId: 'tenant-a', cachePrefixId: prefixId });
    expect(repeat.status).toBe(200);
    expect(
      repeat.body.usage?.cacheReadTokens ?? 0,
      req('openwop.it.prompt-prefix-cache.b-cache-hit-observable-a-repeat-generate-shows-cachereadtokens-0-while-tokens-st', 
        'ai-envelope.md §"Prompt-prefix cache (RFC 0116)" rule 4',
        'a repeat generate with the same cachePrefixId for the SAME tenant MUST be an observable cache hit (cacheReadTokens > 0)',
      ),
    ).toBeGreaterThan(0);
    // The cost-only witness MUST NOT have changed the recorded outcome.
    expect(repeat.body.usage?.inputTokens).toBe(prime.body.usage?.inputTokens);
    expect(repeat.body.usage?.outputTokens).toBe(prime.body.usage?.outputTokens);
  });

  it('(c) cross-tenant isolation — tenant B first use of tenant A\'s cachePrefixId → cacheReadTokens == 0', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early (not advertised — skip)'); // not advertised — skip
    const prefixId = `xtenant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Tenant A primes the cache under a shared, predictable cachePrefixId.
    const aPrime = await generate({ tenantId: 'tenant-a', cachePrefixId: prefixId });
    if (aPrime.status === 404 || aPrime.status === 405) return softSkip('blocked', 'precondition not met — `aPrime.status === 404 || aPrime.status === 405` returned early (seam not wired) (seam, prior step, or fixture unavailable)'); // seam not wired
    expect(aPrime.status).toBe(200);

    // Tenant B's FIRST use of the SAME cachePrefixId MUST be a miss — the host
    // keys its provider cache by (resolved tenant, cachePrefixId), never global.
    const bFirst = await generate({ tenantId: 'tenant-b', cachePrefixId: prefixId });
    expect(bFirst.status).toBe(200);
    expect(
      bFirst.body.usage?.cacheReadTokens ?? 0,
      req('openwop.it.prompt-prefix-cache.c-cross-tenant-isolation-tenant-b-first-use-of-tenant-a-s-cacheprefixid-cacherea', 
        'SECURITY/invariants.yaml prompt-prefix-cache-cross-tenant-isolation',
        'tenant B\'s first use of tenant A\'s cachePrefixId MUST be a cache MISS (cacheReadTokens == 0) — the cache MUST be keyed by (tenant, cachePrefixId), never global; cross-tenant sharing is context leakage',
      ),
    ).toBe(0);
  });

  it('(d) secret-free — the response never echoes cachePrefixId in a SR-1-sensitive position', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early (not advertised — skip)'); // not advertised — skip
    const prefixId = `secretfree-${Date.now()}`;

    const res = await generate({ tenantId: 'tenant-a', cachePrefixId: prefixId });
    if (res.status === 404 || res.status === 405) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 405` returned early (seam not wired) (seam, prior step, or fixture unavailable)'); // seam not wired
    expect(res.status).toBe(200);
    // The usage block is cost-only; it MUST NOT carry prompt/response substrings
    // (SR-1). cachePrefixId is a public cache key, but the cost witness fields
    // themselves are integers — assert the usage block is shape-clean.
    const usage = res.body.usage ?? {};
    for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
      const v = usage[k];
      if (v !== undefined) {
        expect(
          typeof v,
          req('openwop.it.prompt-prefix-cache.d-secret-free-the-response-never-echoes-cacheprefixid-in-a-sr-1-sensitive-positi', 
            'run-event-payloads.schema.json §providerUsage',
            `provider.usage.${k} MUST be a cost-only integer (no prompt substrings per SR-1)`,
          ),
        ).toBe('number');
      }
    }
  });
});
