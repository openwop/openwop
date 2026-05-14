/**
 * RFC 0012 §B — `memory.compacted` event emission shape.
 *
 * Verifies that hosts advertising
 * `capabilities.memory.compaction.supported: true` emit a canonical
 * `memory.compacted` event payload per `run-event-payloads.schema.json`
 * §`memoryCompacted` whenever a compaction run completes.
 *
 * Required fields per the schema:
 *   - `memoryRef` (string, non-empty)
 *   - `outputId` (string, non-empty)
 *   - `sourceCount` (integer ≥ 1)
 *   - `trigger` (closed enum: `host-managed | client-requested | both`)
 *   - `byteSize` (integer ≥ 0)
 *
 * Optional:
 *   - `sourceIds` (array of non-empty strings; exhaustive within the
 *     array — no "and N more" semantics — when present)
 *
 * Gating identical to `memory-compaction-sr1-carry-forward.test.ts`:
 * capability advertisement + test seam reachable.
 *
 * @see RFCS/0012-memory-compaction-profile.md §B
 * @see schemas/run-event-payloads.schema.json §memoryCompacted
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const MEMORY_REF = 'mem_tenant:default_agent:conformance-rfc0012-event_longTerm';

interface MemoryCaps {
  compaction?: { supported?: boolean };
}

async function isCompactionAdvertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const memory = (disco.json as { capabilities?: { memory?: MemoryCaps } }).capabilities?.memory;
  return memory?.compaction?.supported === true;
}

async function isTestSeamReachable(): Promise<boolean> {
  const r = await driver.post('/v1/test/memory/compact', {});
  return r.status !== 404;
}

describe('memory-compaction-event-emitted: canonical memory.compacted payload shape', () => {
  it('compaction run returns a canonical memoryCompacted payload', async () => {
    if (!(await isCompactionAdvertised())) {
      // eslint-disable-next-line no-console
      console.warn('[rfc0012-event] capabilities.memory.compaction.supported not advertised; skipping');
      return;
    }
    if (!(await isTestSeamReachable())) {
      // eslint-disable-next-line no-console
      console.warn('[rfc0012-event] test seam unreachable; skipping');
      return;
    }

    const seed = await driver.post('/v1/test/memory/seed', {
      memoryRef: MEMORY_REF,
      entries: [
        { id: `event-src-${Date.now()}-a`, content: 'First memory entry.' },
        { id: `event-src-${Date.now()}-b`, content: 'Second memory entry.' },
        { id: `event-src-${Date.now()}-c`, content: 'Third memory entry.' },
      ],
    });
    expect(seed.status).toBe(201);

    const compactRes = await driver.post('/v1/test/memory/compact', {
      memoryRef: MEMORY_REF,
    });
    expect(compactRes.status).toBe(200);

    const event = compactRes.json as {
      type?: string;
      payload?: Record<string, unknown>;
    };

    expect(event.type, driver.describe(
      'observability.md §"Canonical run lifecycle event names"',
      'event MUST be type=memory.compacted',
    )).toBe('memory.compacted');

    const payload = event.payload ?? {};

    expect(typeof payload.memoryRef, driver.describe(
      'RFC 0012 §B / run-event-payloads.schema.json §memoryCompacted',
      'memoryRef MUST be a non-empty string',
    )).toBe('string');
    expect((payload.memoryRef as string).length).toBeGreaterThan(0);

    expect(typeof payload.outputId, driver.describe(
      'RFC 0012 §B',
      'outputId MUST be a string identifying the distilled entry',
    )).toBe('string');
    expect((payload.outputId as string).length).toBeGreaterThan(0);

    expect(Number.isInteger(payload.sourceCount), driver.describe(
      'RFC 0012 §B',
      'sourceCount MUST be an integer',
    )).toBe(true);
    expect(payload.sourceCount as number).toBeGreaterThanOrEqual(1);

    expect(['host-managed', 'client-requested', 'both']).toContain(payload.trigger);

    expect(Number.isInteger(payload.byteSize), driver.describe(
      'RFC 0012 §B',
      'byteSize MUST be an integer',
    )).toBe(true);
    expect(payload.byteSize as number).toBeGreaterThanOrEqual(0);

    if (payload.sourceIds !== undefined) {
      expect(Array.isArray(payload.sourceIds)).toBe(true);
      for (const id of payload.sourceIds as unknown[]) {
        expect(typeof id, 'sourceIds entries MUST be strings').toBe('string');
        expect((id as string).length).toBeGreaterThan(0);
      }
    }
  });
});
