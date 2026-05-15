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
      // Out-of-band field from the test seam carrying the persisted
      // entry bytes; the wire-level `memory.compacted` event does NOT
      // carry content. Required for SR-1 verification — the canonical
      // event payload is shape-only and would pass this scenario
      // trivially without it.
      outputContent?: string;
    };
    expect(event.type, 'event payload MUST be type=memory.compacted').toBe('memory.compacted');

    if (typeof event.outputContent !== 'string') {
      // eslint-disable-next-line no-console
      console.warn('[rfc0012-sr1] test seam did not return outputContent; the wire-level memory.compacted shape does not surface content so without a host-side seam we cannot verify §D end-to-end. Skipping.');
      return;
    }

    // The load-bearing assertion: the PERSISTED entry content (what
    // future MemoryAdapter.get / list consumers would see) MUST NOT
    // carry source-side form-leak signatures. A host that skips its
    // BYOK redaction pass on derived content fails here.
    expect(event.outputContent.includes('[BYOK:hk_live_canary_42]'), driver.describe(
      'RFC 0012 §D',
      'derived MemoryEntry.content MUST NOT carry source-side [BYOK:...] form-leak signatures (SR-1 carry-forward)',
    )).toBe(false);
    expect(event.outputContent.includes('<REDACTED:db-prod-creds>'), driver.describe(
      'RFC 0012 §D',
      'derived MemoryEntry.content MUST NOT echo non-canonical <REDACTED:...> markers from sources',
    )).toBe(false);

    // Positive: the canonical `[REDACTED:...]` placeholder MUST be
    // present where SR-1 carry-forward re-substituted a source-side
    // leak. Pinning this prevents a host from "passing" by simply
    // stripping source content rather than redacting it (which would
    // also lose audit signal).
    expect(event.outputContent, driver.describe(
      'RFC 0012 §D',
      'derived MemoryEntry.content MUST carry canonical [REDACTED:...] placeholders where source-side leaks were re-substituted',
    )).toMatch(/\[REDACTED:[^\]]+\]/);
  });
});
