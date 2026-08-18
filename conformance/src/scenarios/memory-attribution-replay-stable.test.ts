/**
 * memory-attribution-replay-stable — RFC 0057 §D. `memory.written` is an
 * immutable recorded fact: a `replay`-mode fork MUST NOT mint a new
 * `memoryId` for a write the source run already recorded. This asserts the
 * "MUST NOT regenerate" half — every `memory.written` on a replayed run
 * reuses a `memoryId` the source run recorded.
 *
 * H2 (2026-08-18): this file used to say, in this docstring, that "a
 * compliant host that suppresses re-mint on replay satisfies this vacuously
 * with zero events" — and it did: the assertion is a `for` loop over the
 * replayed events, so a host that emits NONE passed trivially. Two hosts
 * diverged under it and both stayed green (openwop-app re-emits the source's
 * events; a tier-2 host suppressed them, which leaves the replayed log SHORT
 * of the source's and breaks RFC 0041 §C byte-equivalence).
 *
 * The divergence is the spec's, not the hosts': RFC 0057 §D says the host
 * "MUST re-emit the recorded events from the log" and then, in a
 * non-normative implementation note in the same section, blesses the
 * reference host for "suppress[ing] rather than re-emit[ting]". Resolving
 * that contradiction is a normative decision (it plausibly makes one shipped
 * host non-conformant), so this leg does NOT pick a side. What it stops
 * doing is passing silently: an empty replay now records `blocked` naming
 * the contradiction, per RFC 0148 §A — a leg that cannot observe MUST NOT
 * read as a pass. Once §D is resolved, the winning side becomes an assertion
 * here.
 *
 * Gated on `capabilities.memory.attribution.emitsWriteEvents`; soft-skips
 * when unadvertised, when the seeded run wrote no memory, or when the host
 * doesn't support `:fork` in `replay` mode.
 *
 * @see RFCS/0057-memory-write-attribution-event.md §D
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
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
    if (!emitsWriteEvents(cap)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!emitsWriteEvents(cap)` returned early');
    const runId = await seedRun('mem-attr-replay');
    if (!runId) return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)');
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return;
    }
    const original = await memoryWrittenEvents(runId);
    if (original.length === 0) return softSkip('blocked', 'run wrote no memory — nothing to test');
    const recordedIds = new Set(original.map((e) => memoryIdOf(e.payload)).filter((x): x is string => x !== null));

    const fork = await driver.post(`/v1/runs/${runId}:fork`, { fromSeq: 0, mode: 'replay' });
    if (fork.status !== 200 && fork.status !== 201) return softSkip('inapplicable', 'replay fork unsupported — soft-skip (fork.status !== 200 && fork.status !== 201)');
    const forkId = (fork.json as { runId?: string } | undefined)?.runId;
    if (!forkId) return softSkip('blocked', 'precondition not met — `!forkId` returned early (seam, prior step, or fixture unavailable)');
    try {
      await pollUntilTerminal(forkId, { timeoutMs: 10_000 });
    } catch {
      /* still assert on whatever the replay emitted */
    }

    const replayed = await memoryWrittenEvents(forkId);
    if (replayed.length === 0) {
      // NOT a pass. The source run recorded `memory.written` events and the
      // replay carries none, so this host is on the "suppress" side of the
      // RFC 0057 §D contradiction. Whether that is conformant is undecided;
      // that it is unobserved here is not (RFC 0148 §A).
      return softSkip(
        'blocked',
        `replay emitted no memory.written while the source recorded ${recordedIds.size} — ` +
          'the host suppresses rather than re-emits. RFC 0057 §D requires re-emission in its ' +
          'normative half and blesses suppression in its implementation note; until that ' +
          'contradiction is resolved this leg records the divergence instead of passing on it.',
      );
    }
    for (const e of replayed) {
      const id = memoryIdOf(e.payload);
      expect(
        id !== null && recordedIds.has(id),
        driver.describe('RFC 0057 §D', 'a replay MUST NOT regenerate memoryId — every replayed memory.written reuses a recorded id'),
      ).toBe(true);
    }
  });
});
