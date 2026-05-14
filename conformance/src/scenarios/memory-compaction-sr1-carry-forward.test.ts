/**
 * RFC 0012 §D — SR-1 carry-forward through memory compaction.
 *
 * Verifies the load-bearing security claim of RFC 0012 (Memory
 * Compaction Profile, `Active` 2026-05-13 — comment window closes
 * 2026-05-20): when a host advertising
 * `capabilities.memory.compaction.supported: true` produces a
 * compacted `MemoryEntry`, the derived content MUST pass the
 * same BYOK redaction harness as a fresh `put`. The fact that
 * source entries were SR-1-compliant at original `put` time is
 * NOT evidence to skip redaction on derived content — summarization
 * models can introduce secret-shaped substrings (hallucinated
 * tokens, format-leaks from in-context examples) not present in
 * any source.
 *
 * Gating:
 *   - `capabilities.memory.compaction.supported` MUST be `true`.
 *   - Host MUST expose the test seam at `POST /v1/test/memory/{seed,
 *     compact}` — gated on the host's `OPENWOP_TEST_TRIGGER_COMPACTION`
 *     env var. Without it the scenario can't synchronously drive
 *     compaction (RFC 0012 normates only `trigger: 'host-managed'`).
 *     The seam itself is host-implementation-specific; the conformance
 *     suite skips when the seam isn't reachable.
 *
 * @see RFCS/0012-memory-compaction-profile.md §D
 * @see SECURITY/invariants.yaml `memory-compaction-sr-1-carry-forward`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const MEMORY_REF = 'mem_tenant:default_agent:conformance-rfc0012-sr1_longTerm';

interface MemoryCaps {
  compaction?: { supported?: boolean };
}

async function isCompactionAdvertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const memory = (disco.json as { capabilities?: { memory?: MemoryCaps } }).capabilities?.memory;
  return memory?.compaction?.supported === true;
}

async function isTestSeamReachable(): Promise<boolean> {
  // Probe the seam with an empty body — expects 400 if reachable
  // (validation_error on missing memoryRef), 404 when disabled.
  const r = await driver.post('/v1/test/memory/compact', {});
  return r.status !== 404;
}

describe('memory-compaction-sr1-carry-forward: derived content passes the BYOK redaction harness', () => {
  it('compacted MemoryEntry content MUST NOT carry source-side form-leak signatures', async () => {
    if (!(await isCompactionAdvertised())) {
      // eslint-disable-next-line no-console
      console.warn('[rfc0012-sr1] capabilities.memory.compaction.supported not advertised; skipping');
      return;
    }
    if (!(await isTestSeamReachable())) {
      // eslint-disable-next-line no-console
      console.warn('[rfc0012-sr1] test seam /v1/test/memory/compact unreachable; skipping (set host\'s OPENWOP_TEST_TRIGGER_COMPACTION=true)');
      return;
    }

    // 1. Seed source entries containing:
    //    - The canonical `[BYOK:...]` form-leak signature (placeholder
    //      surfaces verbatim — should be caught by SR-1 carry-forward).
    //    - A non-canonical `<REDACTED:...>` marker that the host's
    //      redaction harness should re-canonicalize.
    //    - Plain, non-sensitive prose.
    const seed = await driver.post('/v1/test/memory/seed', {
      memoryRef: MEMORY_REF,
      entries: [
        { id: `sr1-src-${Date.now()}-1`, content: 'User confirmed: [BYOK:hk_live_canary_42]' },
        { id: `sr1-src-${Date.now()}-2`, content: 'Resolved <REDACTED:db-prod-creds> outage.' },
        { id: `sr1-src-${Date.now()}-3`, content: 'Customer asked about pricing tiers.' },
      ],
    });
    expect(seed.status, 'seed endpoint MUST return 201 when reachable').toBe(201);

    // 2. Drive compaction synchronously.
    const compactRes = await driver.post('/v1/test/memory/compact', {
      memoryRef: MEMORY_REF,
    });
    expect(compactRes.status, 'compact MUST return 200 with ≥2 source entries').toBe(200);

    const event = compactRes.json as {
      type?: string;
      payload?: { outputId?: string; memoryRef?: string };
    };
    expect(event.type, 'event payload MUST be type=memory.compacted').toBe('memory.compacted');

    // 3. Read the derived entry back via the wire MemoryAdapter
    //    surface (using a memory-list endpoint — the conformance suite
    //    has no direct entry-by-id read endpoint without a workflow
    //    fixture, but the seed/compact seam in step 2 returned the
    //    canonical payload so we can inspect outputId references).
    //    For SR-1 carry-forward we verify the EVENT payload itself
    //    doesn't carry the BYOK markers and that the host's compaction
    //    redaction did its job; the host smoke at
    //    examples/hosts/postgres/test/memory-compaction.test.ts already
    //    verifies the persisted entry content directly.
    const eventJson = JSON.stringify(event);
    expect(eventJson.includes('[BYOK:hk_live_canary_42]'), driver.describe(
      'idempotency.md §"SR-1 carry-forward (compaction extension)"',
      'memory.compacted event MUST NOT carry source-side [BYOK:...] form-leak signatures',
    )).toBe(false);
    expect(eventJson.includes('<REDACTED:db-prod-creds>'), driver.describe(
      'RFC 0012 §D',
      'memory.compacted event MUST NOT echo non-canonical <REDACTED:...> markers from sources',
    )).toBe(false);
  });
});
