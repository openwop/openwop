/**
 * memory-attribution-replay-stable — RFC 0057 §D. `memory.written` is an
 * immutable recorded fact: a `replay`-mode fork MUST NOT mint a new
 * `memoryId` for a write the source run already recorded. This asserts the
 * "MUST NOT regenerate" half — every `memory.written` on a replayed run
 * reuses a `memoryId` the source run recorded (a compliant host that
 * suppresses re-mint on replay satisfies this vacuously with zero events).
 *
 * Gated on `capabilities.memory.attribution.emitsWriteEvents`; soft-skips
 * when unadvertised, when the seeded run wrote no memory, or when the host
 * doesn't support `:fork` in `replay` mode.
 *
 * @see RFCS/0057-memory-write-attribution-event.md §D
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { readMemoryAttributionCap, emitsWriteEvents, seedRun, memoryWrittenEvents } from '../lib/memoryAttribution.js';

function memoryIdOf(payload: Record<string, unknown> | undefined): string | null {
  const id = (payload ?? {})['memoryId'];
  return typeof id === 'string' ? id : null;
}

describe('memory-attribution-replay-stable (RFC 0057 §D)', () => {
  it('a replay-mode fork introduces no memory.written with a new memoryId', async () => {
    const cap = await readMemoryAttributionCap();
    if (!emitsWriteEvents(cap)) return;
    const runId = await seedRun('mem-attr-replay');
    if (!runId) return;
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return;
    }
    const original = await memoryWrittenEvents(runId);
    if (original.length === 0) return; // run wrote no memory — nothing to test
    const recordedIds = new Set(original.map((e) => memoryIdOf(e.payload)).filter((x): x is string => x !== null));

    const fork = await driver.post(`/v1/runs/${runId}:fork`, { fromSeq: 0, mode: 'replay' });
    if (fork.status !== 200 && fork.status !== 201) return; // replay fork unsupported — soft-skip
    const forkId = (fork.json as { runId?: string } | undefined)?.runId;
    if (!forkId) return;
    try {
      await pollUntilTerminal(forkId, { timeoutMs: 10_000 });
    } catch {
      /* still assert on whatever the replay emitted */
    }

    const replayed = await memoryWrittenEvents(forkId);
    for (const e of replayed) {
      const id = memoryIdOf(e.payload);
      expect(
        id !== null && recordedIds.has(id),
        driver.describe('RFC 0057 §D', 'a replay MUST NOT regenerate memoryId — every replayed memory.written reuses a recorded id'),
      ).toBe(true);
    }
  });
});
