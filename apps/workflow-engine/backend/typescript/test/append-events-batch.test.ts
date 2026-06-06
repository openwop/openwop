/**
 * `Storage.appendEventsBatch` — the bulk-append used by the demo seed (one
 * round-trip instead of N). The replay-safety contract (architect-flagged): it
 * MUST assign the exact same monotonic per-(runId) `sequence` that N
 * `appendEvent` calls would, continuing from each run's current max, so the
 * event log stays replay/fork-deterministic (`replay.md`).
 */
import { describe, expect, it } from 'vitest';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import type { EventRecord } from '../src/types.js';

const ev = (eventId: string, runId: string, n: number): Omit<EventRecord, 'sequence'> => ({
  eventId,
  runId,
  type: 'demo.event',
  payload: { n },
  timestamp: '2026-06-06T00:00:00.000Z',
});

describe('Storage.appendEventsBatch (sqlite)', () => {
  it('assigns monotonic per-run sequence in array order, across interleaved runs', async () => {
    const storage = openSqliteStorage(':memory:');
    const out = await storage.appendEventsBatch([
      ev('a1', 'r1', 1),
      ev('b1', 'r2', 1),
      ev('a2', 'r1', 2),
      ev('a3', 'r1', 3),
      ev('b2', 'r2', 2),
    ]);
    expect(out.map((e) => [e.runId, e.sequence])).toEqual([
      ['r1', 1],
      ['r2', 1],
      ['r1', 2],
      ['r1', 3],
      ['r2', 2],
    ]);
    // persisted + ordered per run
    expect((await storage.listEvents('r1')).map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect((await storage.listEvents('r2')).map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('continues from the run current max (matches appendEvent)', async () => {
    const storage = openSqliteStorage(':memory:');
    await storage.appendEvent(ev('x1', 'r1', 1)); // seq 1 via the single path
    const out = await storage.appendEventsBatch([ev('x2', 'r1', 2), ev('x3', 'r1', 3)]);
    expect(out.map((e) => e.sequence)).toEqual([2, 3]);
    expect((await storage.listEvents('r1')).map((e) => e.eventId)).toEqual(['x1', 'x2', 'x3']);
  });

  it('is a no-op on an empty batch', async () => {
    const storage = openSqliteStorage(':memory:');
    expect(await storage.appendEventsBatch([])).toEqual([]);
  });
});
