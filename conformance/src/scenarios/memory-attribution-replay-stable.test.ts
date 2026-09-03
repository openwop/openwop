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
 * The spec was never actually ambiguous, and an earlier revision of this file
 * said it was — that was wrong. `replay.md` §"Determinism guarantees"
 * caveat 5 (Stable, unchanged since v1.2) names this exact case: recorded-fact
 * events such as `memory.written` "are fixed history. On replay against a
 * checkpoint a host MUST re-emit them from the event log and MUST NOT
 * regenerate their identifiers or timestamps." RFC 0041 §C independently
 * requires caching "emitted events" so a replay reproduces the observable
 * sequence. RFC 0057 §D's implementation note appeared to bless suppression
 * and conceded in its own words that it satisfied only the "MUST NOT
 * regenerate" half; that note is retired (RFC 0057, Correction 2026-08-18).
 *
 * So this asserts BOTH halves — every replayed id is a recorded id, AND the
 * source's recorded ids all reappear. A suppressing host fails, and always
 * should have: nothing normative changed, the instrument just could not see
 * it before.
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
import { req } from '../lib/requirement-ids.js';

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
      return softSkip('blocked', 'precondition not met — an earlier step threw (seam, prior step, or fixture unavailable)');
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
    // Half 1 — MUST re-emit. The source's recorded ids all reappear on the
    // replay. This is the half that went unasserted for months: the loop below
    // is vacuously true on an empty array, so a host that suppressed the
    // re-emission entirely passed.
    const replayedIds = new Set(
      replayed.map((e) => memoryIdOf(e.payload)).filter((x): x is string => x !== null),
    );
    const missing = [...recordedIds].filter((id) => !replayedIds.has(id));
    expect(
      missing,
      req('openwop.it.memory-attribution-replay-stable.a-replay-mode-fork-introduces-no-memory-written-with-a-new-memoryid', 
        'replay.md §"Determinism guarantees" caveat 5',
        'recorded-fact events are fixed history: a replay MUST re-emit the source run\'s ' +
          '`memory.written` events from the log. A replay whose log is SHORT of the source\'s is not ' +
          'a reproduction of the observable sequence (RFC 0041 §C). Suppressing the write is not ' +
          'enough — that satisfies only the MUST-NOT-regenerate half',
      ),
    ).toEqual([]);

    // Half 2 — MUST NOT regenerate. Every id on the replay is one the source recorded.
    for (const e of replayed) {
      const id = memoryIdOf(e.payload);
      expect(
        id !== null && recordedIds.has(id),
        req('openwop.it.memory-attribution-replay-stable.a-replay-mode-fork-introduces-no-memory-written-with-a-new-memoryid', 'RFC 0057 §D', 'a replay MUST NOT regenerate memoryId — every replayed memory.written reuses a recorded id'),
      ).toBe(true);
    }
  });
});
