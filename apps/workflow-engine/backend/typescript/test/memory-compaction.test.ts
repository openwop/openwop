/**
 * RFC 0012 — memory compaction (host-internal distill + SR-1 carry-forward).
 *
 * Exercises the helpers behind the /v1/test/memory/{seed,compact} seam:
 *   - compact collapses N seeded entries into 1 distilled entry
 *   - the distilled entry carries a well-formed `compacted-from:<id>` tag
 *   - SR-1 §D: source-side leak signatures are re-substituted with the
 *     canonical `[REDACTED:...]`, never echoed and never silently stripped
 *
 * @see RFCS/0012-memory-compaction-profile.md §B/§C/§D
 */

import { describe, expect, it, beforeAll } from 'vitest';
import {
  initInMemorySurfaces,
  seedMemoryEntry,
  compactMemory,
  listMemoryEntries,
} from '../src/host/inMemorySurfaces.js';
import { redactForCompaction } from '../src/byok/textRedaction.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TENANT = 'compaction-conformance';
const REF = 'mem_tenant:agent:rfc0012-test_longTerm';
const COMPACTED_FROM_RE = /^compacted-from:[^\s:][^\s]*$/;

beforeAll(() => {
  initInMemorySurfaces({ dataDir: mkdtempSync(join(tmpdir(), 'openwop-compact-')) });
});

describe('RFC 0012 — compactMemory', () => {
  it('collapses seeded entries into one distilled, provenance-tagged entry', () => {
    const ref = `${REF}-basic`;
    seedMemoryEntry(TENANT, ref, { id: 'a', content: 'First.' });
    seedMemoryEntry(TENANT, ref, { id: 'b', content: 'Second.' });
    seedMemoryEntry(TENANT, ref, { id: 'c', content: 'Third.' });

    const result = compactMemory(TENANT, ref);
    expect(result).not.toBeNull();
    expect(result!.sourceCount).toBe(3);
    expect(result!.sourceIds).toEqual(['a', 'b', 'c']);
    expect(result!.byteSize).toBeGreaterThan(0);
    expect(result!.outputId).toMatch(/^mem_/);

    // Sources collapsed into exactly the one archive.
    const remaining = listMemoryEntries(TENANT, ref);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(result!.outputId);
    const provenance = remaining[0]!.tags.find((t) => t.startsWith('compacted-from:'));
    expect(provenance).toBeTruthy();
    expect(provenance!).toMatch(COMPACTED_FROM_RE);
  });

  it('returns null when there is nothing to compact', () => {
    expect(compactMemory(TENANT, `${REF}-empty`)).toBeNull();
  });

  it('SR-1 §D: derived content re-substitutes source leaks with [REDACTED:...]', () => {
    const ref = `${REF}-sr1`;
    seedMemoryEntry(TENANT, ref, { id: '1', content: 'User confirmed: [BYOK:hk_live_canary_42]' });
    seedMemoryEntry(TENANT, ref, { id: '2', content: 'Resolved <REDACTED:db-prod-creds> outage.' });
    seedMemoryEntry(TENANT, ref, { id: '3', content: 'Customer asked about pricing tiers.' });

    const result = compactMemory(TENANT, ref)!;
    expect(result.outputContent).not.toContain('[BYOK:hk_live_canary_42]');
    expect(result.outputContent).not.toContain('<REDACTED:db-prod-creds>');
    expect(result.outputContent).toMatch(/\[REDACTED:[^\]]+\]/);
  });
});

describe('RFC 0012 — redactForCompaction', () => {
  it('converts both source-leak forms + standard key shapes', () => {
    const out = redactForCompaction('a [BYOK:x] b <REDACTED:y> c sk-ant-api03-abcdefghijklmnop1234');
    expect(out).not.toContain('[BYOK:x]');
    expect(out).not.toContain('<REDACTED:y>');
    expect(out).toContain('[REDACTED:byok]');
    expect(out).toContain('[REDACTED:y]');
    expect(out).toContain('sk-***');
  });
});
