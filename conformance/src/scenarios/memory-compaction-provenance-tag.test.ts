/**
 * RFC 0012 §C — `compacted-from:<id>` provenance tag convention.
 *
 * The distilled entry SHOULD (not MUST) carry a tag of the form
 * `compacted-from:<compactionRunId>` where `<compactionRunId>` is a
 * host-issued opaque identifier. This lets `MemoryAdapter.list`
 * consumers detect compacted entries without needing access to the
 * `memory.compacted` event stream.
 *
 * SOFT ASSERTION: log-and-warn if absent, fail only if a present tag
 * is malformed. Hosts with structurally-constrained tag-spaces (legacy
 * tag-prefix discipline, fixed-vocabulary tagging) MAY omit this —
 * the `memory.compacted` event itself remains the canonical provenance
 * signal.
 *
 * Gating identical to the other RFC 0012 scenarios.
 *
 * @see RFCS/0012-memory-compaction-profile.md §C
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

const MEMORY_REF = 'mem_tenant:default_agent:conformance-rfc0012-tag_longTerm';
const COMPACTED_FROM_RE = /^compacted-from:[^\s:][^\s]*$/;

interface MemoryCaps {
  compaction?: { supported?: boolean };
}

interface MemoryListResponse {
  entries?: Array<{ id?: string; tags?: string[] }>;
}

async function isCompactionAdvertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const memory = capabilityFamily<MemoryCaps>(disco.json, 'memory');
  return memory?.compaction?.supported === true;
}

async function isTestSeamReachable(): Promise<boolean> {
  const r = await driver.post('/v1/test/memory/compact', {});
  return r.status !== 404;
}

describe('memory-compaction-provenance-tag: compacted-from:<id> tag follows §C convention', () => {
  it('compacted entry carries a well-formed compacted-from tag, OR omits it cleanly (no malformed tags)', async () => {
    if (!(await isCompactionAdvertised())) {
      // eslint-disable-next-line no-console
      console.warn('[rfc0012-tag] capabilities.memory.compaction.supported not advertised; skipping');
      return softSkip('inapplicable', '[rfc0012-tag] capabilities.memory.compaction.supported not advertised; skipping');
    }
    if (!(await isTestSeamReachable())) {
      // eslint-disable-next-line no-console
      console.warn('[rfc0012-tag] test seam unreachable; skipping');
      return softSkip('blocked', '[rfc0012-tag] test seam unreachable; skipping');
    }

    // Seed + compact.
    const seedStamp = Date.now();
    const seed = await driver.post('/v1/test/memory/seed', {
      memoryRef: MEMORY_REF,
      entries: [
        { id: `tag-src-${seedStamp}-1`, content: 'Source content alpha.' },
        { id: `tag-src-${seedStamp}-2`, content: 'Source content beta.' },
      ],
    });
    expect(seed.status).toBe(201);

    const compactRes = await driver.post('/v1/test/memory/compact', {
      memoryRef: MEMORY_REF,
    });
    expect(compactRes.status).toBe(200);

    const event = compactRes.json as { payload?: { outputId?: string } };
    const outputId = event.payload?.outputId;
    expect(typeof outputId).toBe('string');

    // Resolve the entry via the wire MemoryAdapter list surface (no
    // direct get-by-id wire endpoint; we filter list results).
    // Hosts that don't expose memory:list on the wire skip — this is
    // a `MemoryAdapter.list` surface check, which the canonical
    // capabilities.memory.supported claim already covers.
    const listRes = await driver.get(
      `/v1/memory/${encodeURIComponent(MEMORY_REF)}?limit=50`,
    );
    if (listRes.status === 404) {
      // eslint-disable-next-line no-console
      console.warn('[rfc0012-tag] host does not expose memory:list at /v1/memory/{ref}; skipping tag inspection (canonical provenance signal remains the memory.compacted event itself)');
      return softSkip('blocked', '[rfc0012-tag] host does not expose memory:list at /v1/memory/{ref}; skipping tag inspection (canonical provenance signal remains the memory.compacted event itself)');
    }
    expect(listRes.status, req('openwop.it.memory-compaction-provenance-tag.compacted-entry-carries-a-well-formed-compacted-from-tag-or-omits-it-cleanly-no', 'RFC 0012 §C', 'memory:list MUST return 200 when reachable')).toBe(200);

    const body = (listRes.json as MemoryListResponse) ?? {};
    const entries = body.entries ?? [];
    const output = entries.find((e) => e.id === outputId);
    if (!output) {
      // eslint-disable-next-line no-console
      console.warn(`[rfc0012-tag] outputId ${outputId} not visible via memory:list; cannot inspect tags`);
      return softSkip('blocked', '[rfc0012-tag] outputId … not visible via memory:list; cannot inspect tags');
    }
    const tags = output.tags ?? [];

    // RFC 0012 §C: SHOULD-tag, soft assertion.
    const provenance = tags.find((t) => t.startsWith('compacted-from:'));
    if (provenance === undefined) {
      // eslint-disable-next-line no-console
      console.warn('[rfc0012-tag] output entry has no compacted-from:<id> tag — RFC 0012 §C is SHOULD, not MUST; pass with warning');
      return softSkip('inapplicable', '[rfc0012-tag] output entry has no compacted-from:<id> tag — RFC 0012 §C is SHOULD, not MUST; pass with warning');
    }
    expect(provenance, req('openwop.it.memory-compaction-provenance-tag.compacted-entry-carries-a-well-formed-compacted-from-tag-or-omits-it-cleanly-no', 
      'RFC 0012 §C',
      'compacted-from tag MUST match `compacted-from:<id>` shape (non-empty id, no whitespace) when present',
    )).toMatch(COMPACTED_FROM_RE);
  });
});
