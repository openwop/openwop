/**
 * cross-engine-append-behavior — RFC 0036 §B cross-engine append-ordering behavioral probe.
 *
 * Companion to `cross-engine-append-ordering.test.ts` which carries the
 * advertisement-shape probes. This file exercises the canonical cross-engine
 * append-ordering behavior specified by `spec/v1/channels-and-reducers.md`
 * §"Cross-engine ordering" via the host-extension test seams:
 *
 *   POST /v1/host/sample/test/cross-engine/append   — single engine append
 *   GET  /v1/host/sample/test/cross-engine/read     — read ordered sequence
 *   POST /v1/host/sample/test/cross-engine/reset    — clear log
 *
 * The seam is conformance-only (host-extension namespace), gated on the
 * host's `OPENWOP_TEST_CROSS_ENGINE_HARNESS=true` env var. The seam itself
 * is OPTIONAL — hosts that don't expose it soft-skip; hosts that DO expose
 * it MUST honor the §B contract:
 *
 *   1. Multiple engines appending concurrently to the same channelId
 *      converge to a single globally-ordered linearization on read.
 *   2. Per-engine order is preserved within each engine's local sequence
 *      (writes from engine A appear in A's submission order, ditto B).
 *   3. The host's advertised `orderingModel` (lamport / vector-clock /
 *      global-sequencer) determines the cross-engine merge semantics.
 *   4. Read after partition heal converges to the same total order
 *      regardless of which engine's view we read from.
 *
 * @see RFCS/0036-multi-region-and-cross-engine-guarantees.md §B
 * @see spec/v1/channels-and-reducers.md §"Cross-engine ordering"
 */

import { describe, it, expect } from 'vitest';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface AppendEntry {
  engineId: string;
  value: unknown;
  lamport: number;
  seq: number;
}

async function appendEntry(
  engineId: string,
  channelId: string,
  value: unknown,
  lamport?: number,
): Promise<{ status: number; entry?: AppendEntry }> {
  const body: Record<string, unknown> = { engineId, channelId, value };
  if (lamport !== undefined) body.lamport = lamport;
  const res = await driver.post('/v1/host/sample/test/cross-engine/append', body);
  if (res.status === 200) {
    return { status: res.status, entry: res.json as AppendEntry };
  }
  return { status: res.status };
}

async function readEntries(channelId: string): Promise<{ status: number; entries: AppendEntry[] }> {
  const res = await driver.get(`/v1/host/sample/test/cross-engine/read?channelId=${encodeURIComponent(channelId)}`);
  return {
    status: res.status,
    entries: res.status === 200 ? (res.json as { entries: AppendEntry[] }).entries : [],
  };
}

async function resetLog(): Promise<number> {
  const res = await driver.post('/v1/host/sample/test/cross-engine/reset', {});
  return res.status;
}

/**
 * The cross-engine harness seam answered 404. Whether that is `blocked` (the host
 * advertises `eventLog.crossEngineOrdering.supported: true` and so made a claim
 * this file cannot check) or `inapplicable` (no such advertisement) depends on
 * discovery — record the honest one (RFC 0148 §A).
 */
async function noteHarnessAbsent(): Promise<void> {
  const disco = await driver.get('/.well-known/openwop');
  const el = capabilityFamily<{ crossEngineOrdering?: { supported?: unknown } }>(disco.json, 'eventLog');
  if (el?.crossEngineOrdering?.supported === true) {
    seamAbsent('host advertises `eventLog.crossEngineOrdering.supported: true` but `POST /v1/host/sample/test/cross-engine/reset` answered 404 — the ordering claim is unobservable (host-sample-test-seams.md)');
  } else {
    softSkip('inapplicable', 'optional advertisement — `eventLog.crossEngineOrdering` not advertised by this host, and the cross-engine harness seam is absent (RFC 0036 §B)');
  }
}

describe.skipIf(HTTP_SKIP)('cross-engine-append-behavior: §B cross-engine ordering (RFC 0036)', () => {
  it('interleaved appends from two engines converge to a single globally-ordered sequence', async (ctx) => {
    const resetStatus = await resetLog();
    if (resetStatus === 404) {
      await noteHarnessAbsent();
      ctx.skip(); // host doesn't expose the cross-engine harness seam
      return softSkip('blocked', 'precondition not met — `resetStatus === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(resetStatus).toBe(200);

    const ch = 'channel-A';

    // Engine A: 3 appends. Engine B: 2 appends. Interleaved.
    const a1 = await appendEntry('engine-A', ch, 'a-1');
    const b1 = await appendEntry('engine-B', ch, 'b-1');
    const a2 = await appendEntry('engine-A', ch, 'a-2');
    const a3 = await appendEntry('engine-A', ch, 'a-3');
    const b2 = await appendEntry('engine-B', ch, 'b-2');

    for (const r of [a1, b1, a2, a3, b2]) {
      expect(r.status).toBe(200);
      expect(r.entry).toBeDefined();
    }

    const read = await readEntries(ch);
    expect(read.status).toBe(200);

    expect(
      read.entries.length,
      req('openwop.it.cross-engine-append-behavior.interleaved-appends-from-two-engines-converge-to-a-single-globally-ordered-seque', 
        'channels-and-reducers.md §"Cross-engine ordering"',
        'all appends across all engines MUST appear in the linearized read',
      ),
    ).toBe(5);

    // Per-engine order MUST be preserved within each engine's submissions.
    const engineAEntries = read.entries.filter((e) => e.engineId === 'engine-A').map((e) => e.value);
    const engineBEntries = read.entries.filter((e) => e.engineId === 'engine-B').map((e) => e.value);
    expect(
      engineAEntries,
      req('openwop.it.cross-engine-append-behavior.interleaved-appends-from-two-engines-converge-to-a-single-globally-ordered-seque', 
        'channels-and-reducers.md §"Cross-engine ordering"',
        'engine-A submissions MUST appear in submission order within the linearization',
      ),
    ).toEqual(['a-1', 'a-2', 'a-3']);
    expect(
      engineBEntries,
      req('openwop.it.cross-engine-append-behavior.interleaved-appends-from-two-engines-converge-to-a-single-globally-ordered-seque', 
        'channels-and-reducers.md §"Cross-engine ordering"',
        'engine-B submissions MUST appear in submission order within the linearization',
      ),
    ).toEqual(['b-1', 'b-2']);
  });

  it('lamport clocks monotonically advance across engines', async (ctx) => {
    const resetStatus = await resetLog();
    if (resetStatus === 404) {
      await noteHarnessAbsent();
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `resetStatus === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(resetStatus).toBe(200);

    const ch = 'channel-B';
    const a1 = await appendEntry('engine-A', ch, 'a-1');
    const b1 = await appendEntry('engine-B', ch, 'b-1');
    const a2 = await appendEntry('engine-A', ch, 'a-2');

    expect(a1.entry?.lamport).toBeDefined();
    expect(b1.entry?.lamport).toBeDefined();
    expect(a2.entry?.lamport).toBeDefined();

    // Lamport invariant: each subsequent append on the same shared
    // channel MUST have strictly-higher clock than the previous.
    expect(
      a2.entry!.lamport > b1.entry!.lamport && b1.entry!.lamport > a1.entry!.lamport,
      req('openwop.it.cross-engine-append-behavior.lamport-clocks-monotonically-advance-across-engines', 
        'channels-and-reducers.md §"Cross-engine ordering" — Lamport',
        'lamport clocks MUST be strictly monotonic on the shared channel',
      ),
    ).toBe(true);
  });

  it('lamport hint from engine A advances engine B past it', async (ctx) => {
    const resetStatus = await resetLog();
    if (resetStatus === 404) {
      await noteHarnessAbsent();
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `resetStatus === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(resetStatus).toBe(200);

    const ch = 'channel-C';
    // Engine A appends, gets lamport L. Engine B then appends with
    // lamport hint == L (proxy for "B saw A's clock at L"); B's
    // resulting clock MUST be > L per the lamport receive rule
    // max(local, incoming) + 1.
    const a1 = await appendEntry('engine-A', ch, 'a-1');
    expect(a1.status).toBe(200);
    const seen = a1.entry!.lamport;
    const b1 = await appendEntry('engine-B', ch, 'b-1', seen);
    expect(b1.status).toBe(200);
    expect(
      b1.entry!.lamport > seen,
      req('openwop.it.cross-engine-append-behavior.lamport-hint-from-engine-a-advances-engine-b-past-it', 
        'channels-and-reducers.md §"Cross-engine ordering" — Lamport receive rule',
        'when engine B sees engine A\'s clock at L, B\'s next append MUST have clock > L',
      ),
    ).toBe(true);
  });

  it('linearization is deterministic — same appends → same total order', async (ctx) => {
    const resetStatus = await resetLog();
    if (resetStatus === 404) {
      await noteHarnessAbsent();
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `resetStatus === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(resetStatus).toBe(200);

    const ch = 'channel-D';
    await appendEntry('engine-A', ch, 'a-1');
    await appendEntry('engine-B', ch, 'b-1');
    await appendEntry('engine-A', ch, 'a-2');

    const r1 = await readEntries(ch);
    const r2 = await readEntries(ch);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(
      r1.entries.map((e) => `${e.engineId}:${String(e.value)}`),
      req('openwop.it.cross-engine-append-behavior.linearization-is-deterministic-same-appends-same-total-order', 
        'channels-and-reducers.md §"Cross-engine ordering" — determinism',
        'two reads MUST produce the same linearization (deterministic merge)',
      ),
    ).toEqual(r2.entries.map((e) => `${e.engineId}:${String(e.value)}`));
  });
});
