/**
 * RFC 0176 §A.3 / §A.4 — `v1-events-translated` (suite 2.0.0, target major 2;
 * seam-gated on `openwop-conformance-seams-v2`).
 *
 * A v2 host reading a run in era `2` MUST translate every event through
 * `spec/v2/event-codemap.json` at the storage boundary: `type` is mapped,
 * `sequence` is preserved verbatim including `0`, `eventId` / `timestamp` /
 * `causationId` pass through (`spec/v2/core/persistence.md` §The reader rule).
 * The rule binds every reader — poll, SSE and fork are read here so a
 * wrapper-only adapter (one that some call sites bypass, §The seat) is caught.
 *
 * The era-2 log is seeded in v1 vocabulary through the event-log seed seam
 * (lib/era2-seed.ts names the contract) with two renamed codemap rows
 * (`agent.toolCalled` → `agent.tool-called`, `agent.toolReturned` →
 * `agent.tool-returned`). Without the seams profile, or without the seam,
 * every leg records `blocked` naming it.
 *
 * @see spec/v2/core/persistence.md §The reader rule, §The seat
 * @see spec/v2/core/events.md §Reading an era-2 log
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { codemapV1toV2, era2Gate, eventsOf, forkRun, pollEvents, seedEra2Log, streamEvents, v1FixtureLog, type ReadEvent, type SeedEvent } from '../lib/era2-seed.js';

const DOC = 'spec/v2/core/persistence.md §The reader rule';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

/** The assertions every reader must satisfy against the seeded log — one requirement id per leg, passed in. */
function assertTranslated(id: string, reader: string, seeded: readonly SeedEvent[], read: readonly ReadEvent[]): void {
  const map = codemapV1toV2();
  const expectedTypes = seeded.map((e) => map.get(e.type) ?? e.type);
  const renamed = seeded.filter((e) => map.get(e.type) !== undefined && map.get(e.type) !== e.type).map((e) => e.type);
  expect(read.length, req(id, DOC, `${reader} MUST return every seeded row (${seeded.length}) — got ${read.length}`)).toBeGreaterThanOrEqual(seeded.length);
  const bySeq = new Map<number, ReadEvent>();
  for (const e of read) if (typeof e.sequence === 'number') bySeq.set(e.sequence, e);
  expect(bySeq.has(0), req(id, DOC, `${reader}: sequence 0 MUST be present — sequence is preserved verbatim including 0 (RFC 0165 G7)`)).toBe(true);
  for (const s of seeded) {
    const got = bySeq.get(s.sequence);
    expect(got, req(id, DOC, `${reader}: the seeded sequence ${s.sequence} MUST be readable under its own sequence (the sequence space is preserved, never renumbered)`)).toBeDefined();
    expect(got?.type, req(id, DOC, `${reader}: v1 type ${s.type} at sequence ${s.sequence} MUST read back as the codemap's v2 name ${map.get(s.type) ?? s.type}`)).toBe(map.get(s.type) ?? s.type);
    if (s.timestamp !== undefined) {
      expect(got?.timestamp, req(id, DOC, `${reader}: timestamp passes through untouched at sequence ${s.sequence}`)).toBe(s.timestamp);
    }
  }
  const leaked = read.map((e) => String(e.type)).filter((t) => renamed.includes(t));
  expect(leaked, req(id, DOC, `${reader}: no v1 name of a renamed row may survive the read (a host MUST NOT carry a private mapping or pass an unmapped name through) — leaked [${leaked.join(', ')}]; expected [${expectedTypes.join(', ')}]`)).toEqual([]);
}

describe('RFC 0176 §A.3 — v1-events-translated (seam-gated)', () => {
  it('poll reads an era-2 log with v2 type names and sequence 0 present', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    const log = v1FixtureLog();
    const seeded = await seedEra2Log(log, 'completed');
    if (!seeded.ok) return softSkip(seeded.kind, seeded.reason);
    const res = await pollEvents(seeded.runId);
    if (res === null) return softSkip('blocked', 'GET /runs/{runId}/events/poll unreachable (fetch failed)');
    expect(res.status, req('openwop.requirement.0176.v1-events-translated.poll', DOC, `poll over an era-2 log the codemap fully names MUST answer 200 (got ${res.status}) — every row is mapped, so nothing refuses the read`)).toBe(200);
    assertTranslated('openwop.requirement.0176.v1-events-translated.poll', 'poll', log, eventsOf(res.json));
  });

  it('SSE reads the same era-2 log with v2 type names', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    const log = v1FixtureLog();
    const seeded = await seedEra2Log(log, 'completed');
    if (!seeded.ok) return softSkip(seeded.kind, seeded.reason);
    const stream = await streamEvents(seeded.runId);
    if (stream === null) return softSkip('blocked', 'GET /runs/{runId}/events (SSE) unreachable (fetch failed)');
    expect(stream.status, req('openwop.requirement.0176.v1-events-translated.sse', DOC, `streamRunEvents over an era-2 log MUST answer 200 text/event-stream (got ${stream.status}) — the stream reader is bound by the same rule as poll`)).toBe(200);
    assertTranslated('openwop.requirement.0176.v1-events-translated.sse', 'SSE (streamMode=debug)', log, stream.events);
  });

  it('a fork of the era-2 run reads its inherited prefix with v2 type names', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    if (!(await gateFamily('replay'))) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay) — the fork reader has no surface');
    const log = v1FixtureLog();
    const seeded = await seedEra2Log(log, 'completed');
    if (!seeded.ok) return softSkip(seeded.kind, seeded.reason);
    const last = Math.max(...log.map((e) => e.sequence));
    const fork = await forkRun(seeded.runId, { mode: 'replay', fromSeq: last });
    if (fork === null) return softSkip('blocked', 'POST /runs/{runId}:fork unreachable (fetch failed)');
    expect(fork.status, req('openwop.requirement.0176.v1-events-translated.fork', 'spec/v2/core/replay.md §Forking a v1 run', `a v2 host MUST fork a run created before the cut — POST /runs/{runId}:fork {mode: replay, fromSeq: ${last}} answered ${fork.status}`)).toBe(201);
    const forkId = (fork.json as { runId?: unknown } | undefined)?.runId;
    if (typeof forkId !== 'string') return softSkip('blocked', 'the fork answered 201 without a runId — the inherited prefix cannot be read');
    const res = await pollEvents(forkId);
    if (res === null || res.status !== 200) return softSkip('blocked', `GET /runs/{forkId}/events/poll answered ${res?.status ?? 'no response'}`);
    // The fork inherits the translated prefix [0, fromSeq) — the rows below the fork point.
    const prefix = log.filter((e) => e.sequence < last);
    assertTranslated('openwop.requirement.0176.v1-events-translated.fork', 'the fork\'s inherited prefix', prefix, eventsOf(res.json).filter((e) => typeof e.sequence === 'number' && e.sequence < last));
  });
});
