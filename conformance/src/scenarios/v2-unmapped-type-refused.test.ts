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
 * is advertised, through a fork.
 *
 * THE CONTROL, and why it was missing. Until this revision only the REFUSAL
 * half was driven, and a host that refuses EVERY type the codemap does not name
 * — including a registered vendor type it is required to pass through — went
 * green on the whole file while violating `persistence.md` §The codemap is data.
 * A one-sided rule is not witnessed by its own negative case. The positive half
 * needs an org registered in the `extensions` object of `spec/v2/declaration.json`
 * that no host owns; the registry did not exist, so the suite could not drive
 * it and this docblock recorded the gap instead of closing it. `extensions` now
 * exists and holds `example`, reserved by the protocol and never assignable to
 * a vendor (RFC 2606 precedent), so `example.thing-happened` is a type that is
 * registered, unmapped, and owned by nobody — exactly the control this file
 * lacked. The two legs are each other's non-vacuity check: refusing both is a
 * defect, accepting both is a defect, and only the pair can tell them apart.
 *
 * BECAUSE THEY CHECK OPPOSITE HALVES, THEY GATE SEPARATELY (`refusalGate` /
 * `controlGate`). Suite 2.0.5 gated both on the control leg's precondition and
 * so disabled the refusal witness wherever the registry did not resolve — on
 * exactly the hosts it exists to catch. A precondition belongs to the leg that
 * needs it, never to the file.
 *
 * @see spec/v2/core/persistence.md §The reader rule
 * @see spec/v2/core/events.md §Reading an era-2 log
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { readErrorCode, readRetriable } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { codemapV1toV2, era2Gate, eventsOf, forkRun, pollEvents, registeredOrgs, seedEra2Log, unmappedRefusalGate, vendorControlGate, type Gate, type SeedEvent } from '../lib/era2-seed.js';

const DOC = 'spec/v2/core/persistence.md §The reader rule';
const MAP = 'spec/v2/core/persistence.md §The codemap is data';
const CODE = 'event_type_unmapped';
const ID_VENDOR = 'openwop.requirement.0176.vendor-type-passthrough';
const UNMAPPED = 'foo.bar';
/** Registered (`extensions` in the declaration), unmapped, owned by no host. */
const VENDOR = 'example.thing-happened';

/**
 * The gate logic is PURE and lives in lib/era2-seed (`unmappedRefusalGate` /
 * `vendorControlGate`) so its truth table can be measured directly — see
 * `src/lib/era2-unmapped-gates.test.ts`. The rows that matter cannot be
 * exercised from here: they are the layouts where the registry does NOT
 * resolve, which is where the 2.0.5 defect lived and where a scenario running
 * against a live host can never put itself.
 */
const refusalGate = (): Gate => unmappedRefusalGate(registeredOrgs(), codemapV1toV2(), UNMAPPED);
const controlGate = (): Gate => vendorControlGate(registeredOrgs(), codemapV1toV2(), VENDOR);

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

function unmappedLog(): SeedEvent[] {
  const t0 = Date.parse('2026-01-15T11:00:00.000Z');
  const ts = (i: number) => new Date(t0 + i * 1000).toISOString();
  return [
    { type: 'run.started', sequence: 0, payload: { workflowId: 'conformance-noop' }, timestamp: ts(0) },
    { type: UNMAPPED, sequence: 1, payload: {}, timestamp: ts(1) },
    { type: 'run.completed', sequence: 2, payload: { durationMs: 2000 }, timestamp: ts(2) },
  ];
}

/** The same shape carrying a REGISTERED vendor type instead of an unmapped one. */
function vendorLog(): SeedEvent[] {
  const t0 = Date.parse('2026-01-15T12:00:00.000Z');
  const ts = (i: number) => new Date(t0 + i * 1000).toISOString();
  return [
    { type: 'run.started', sequence: 0, payload: { workflowId: 'conformance-noop' }, timestamp: ts(0) },
    { type: VENDOR, sequence: 1, payload: { marker: 'era2-vendor-passthrough' }, timestamp: ts(1) },
    { type: 'run.completed', sequence: 2, payload: { durationMs: 2000 }, timestamp: ts(2) },
  ];
}

describe('RFC 0176 §A.3 — unmapped-type-refused (seam-gated)', () => {
  it('poll over a log with an unmapped, unprefixed type fails with 500 event_type_unmapped', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    const pre = refusalGate();
    if (!pre.ok) return softSkip(pre.kind, pre.reason);
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

  it('a REGISTERED vendor type the codemap does not name is read under its own name, unchanged', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    const pre = controlGate();
    if (!pre.ok) return softSkip(pre.kind, pre.reason);
    const seeded = await seedEra2Log(vendorLog(), 'completed');
    if (!seeded.ok) return softSkip(seeded.kind, seeded.reason);
    const res = await pollEvents(seeded.runId);
    if (res === null) return softSkip('blocked', 'GET /runs/{runId}/events/poll unreachable (fetch failed)');
    // The whole point of the control: this is the SAME log shape as the refusal
    // leg with one segment changed, so a 500 here says the host is refusing on
    // "not in the codemap" and not on "not a registered org" — the tolerant
    // reader's mirror image, and just as wrong.
    expect(
      res.status,
      req(ID_VENDOR, MAP, `a vendor-prefixed type whose org IS registered MUST be read under its own name unchanged, not refused — got ${res.status}${res.status === 500 ? ` ${readErrorCode(res.json) ?? ''}: the host refuses every type the codemap does not name, which fails the registered half of the rule` : ''}`.trim()),
    ).toBe(200);
    const types = eventsOf(res.json).map((e) => String(e.type));
    expect(
      types.includes(VENDOR),
      req(ID_VENDOR, MAP, `the ${VENDOR} row MUST appear under its own name — read back [${types.join(', ')}]; a translated or dropped row is a private mapping, and the codemap is the only authority`),
    ).toBe(true);
  });

  it('a fork of the same log is refused for the same reason — the rule binds every reader', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    if (!(await gateFamily('replay'))) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay) — the fork reader has no surface');
    // The fork leg drives the UNMAPPED type, so it takes the refusal gate.
    const pre = refusalGate();
    if (!pre.ok) return softSkip(pre.kind, pre.reason);
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
