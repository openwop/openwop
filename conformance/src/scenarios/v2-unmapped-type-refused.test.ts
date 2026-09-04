/**
 * RFC 0176 §A.3 — `unmapped-type-refused` (suite 2.0.0, target major 2;
 * seam-gated on `openwop-conformance-seams-v2`).
 *
 * A type the codemap does not name and that carries no reserved vendor prefix
 * MUST fail the read with `event_type_unmapped` (`spec/v2/errors.json`, `500`,
 * not retriable) — a run whose log the host cannot translate is not readable,
 * not "tolerantly" readable (`spec/v2/core/persistence.md` §The reader rule;
 * migration row C9.3). The v1 tolerant reader (unknown type passed through) is
 * the forbidden path.
 *
 * An era-2 log carrying one `foo.bar` row is seeded through the event-log seed
 * seam (lib/era2-seed.ts); the read is driven through poll and, where `replay`
 * is advertised, through a fork. A vendor-prefixed control (read under its own
 * name) needs an org registered under `extensions` in `spec/v2/declaration.json`
 * that the suite does not own, so that half is not driven.
 *
 * @see spec/v2/core/persistence.md §The reader rule
 * @see spec/v2/core/events.md §Reading an era-2 log
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { readErrorCode, readRetriable } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { era2Gate, eventsOf, forkRun, pollEvents, seedEra2Log, type SeedEvent } from '../lib/era2-seed.js';

const DOC = 'spec/v2/core/persistence.md §The reader rule';
const CODE = 'event_type_unmapped';
const UNMAPPED = 'foo.bar';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

function unmappedLog(): SeedEvent[] {
  const t0 = Date.parse('2026-01-15T11:00:00.000Z');
  const ts = (i: number) => new Date(t0 + i * 1000).toISOString();
  return [
    { type: 'run.started', sequence: 0, payload: { workflowId: 'conformance-noop' }, timestamp: ts(0) },
    { type: UNMAPPED, sequence: 1, payload: { note: 'not a codemap row, not a vendor org' }, timestamp: ts(1) },
    { type: 'run.completed', sequence: 2, payload: { durationMs: 2000 }, timestamp: ts(2) },
  ];
}

describe('RFC 0176 §A.3 — unmapped-type-refused (seam-gated)', () => {
  it('poll over a log with an unmapped, unprefixed type fails with 500 event_type_unmapped', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    const seeded = await seedEra2Log(unmappedLog(), 'completed');
    if (!seeded.ok) return softSkip(seeded.kind, seeded.reason);
    const res = await pollEvents(seeded.runId);
    if (res === null) return softSkip('blocked', 'GET /runs/{runId}/events/poll unreachable (fetch failed)');
    expect(
      res.status,
      req('openwop.requirement.0176.unmapped-type-refused', DOC, `a read over a log the host cannot translate MUST fail — ${CODE} is registered 500 (spec/v2/errors.json); got ${res.status}${res.status === 200 ? ` with types [${eventsOf(res.json).map((e) => String(e.type)).join(', ')}] — the tolerant reader RFC 0176 forbids` : ''}`),
    ).toBe(500);
    expect(
      readErrorCode(res.json),
      req('openwop.requirement.0176.unmapped-type-refused', DOC, `the refusal MUST name ${CODE} in the canonical envelope`),
    ).toBe(CODE);
    expect(
      readRetriable(res.json) === true,
      req('openwop.requirement.0176.unmapped-type-refused', 'spec/v2/errors.json', `${CODE} is not retriable — the log does not become translatable by asking again`),
    ).toBe(false);
  });

  it('a fork of the same log is refused for the same reason — the rule binds every reader', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    if (!(await gateFamily('replay'))) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay) — the fork reader has no surface');
    const log = unmappedLog();
    const seeded = await seedEra2Log(log, 'completed');
    if (!seeded.ok) return softSkip(seeded.kind, seeded.reason);
    const last = Math.max(...log.map((e) => e.sequence));
    const fork = await forkRun(seeded.runId, { mode: 'replay', fromSeq: last });
    if (fork === null) return softSkip('blocked', 'POST /runs/{runId}:fork unreachable (fetch failed)');
    // The fork loads the source prefix through the storage boundary (replay.md
    // §Replay-from-event-log internals step 1) — the unmapped row at sequence 1
    // is inside it, so the fork MUST fail the read rather than copy the row.
    expect(
      fork.status,
      req('openwop.requirement.0176.unmapped-type-refused.fork', 'spec/v2/core/replay.md §Replay-from-event-log internals', `a fork whose inherited prefix holds an unmapped type MUST fail the read with ${CODE} (500) — got ${fork.status}; a 201 copied a row the host cannot translate into a new log`),
    ).toBe(500);
    expect(
      readErrorCode(fork.json),
      req('openwop.requirement.0176.unmapped-type-refused.fork', DOC, `the fork's refusal MUST name ${CODE}`),
    ).toBe(CODE);
  });
});
