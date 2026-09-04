/**
 * RFC 0176 §B.1 — `pinned-run-disposition` (suite 2.0.0, target major 2;
 * seam-gated on `openwop-conformance-seams-v2`).
 *
 * A non-terminal run a v2 host inherits carries `version.pinned` events naming
 * change ids. The host MUST continue it or cancel it, never follow a pin
 * silently: every pinned change id still implemented ⇒ the run continues under
 * the reader rule with the pin honoured verbatim (`version.pinned` is never
 * rewritten); any pinned change id no longer implemented ⇒ `run.cancelled`
 * with reason `v1_pin_unsupported` and `cancelledBy: "v2-cutover"`
 * (`spec/v2/core/persistence.md` §Runs pinned to v1; migration rows C9.4/C9.5).
 *
 * Legs:
 *   1. an era-2 running log seeded through the event-log seed seam
 *      (lib/era2-seed.ts) whose `version.pinned` names a change id no host
 *      implements reads back `cancelled` with the named reason and actor, and
 *      the pin row survives untouched;
 *   2. a pin naming a change id the host implements continues — no normative
 *      surface lists implemented change ids, so the id is the operator opt-in
 *      `OPENWOP_TEST_IMPLEMENTED_CHANGE_ID`; absent, the leg records `skipped`.
 *
 * @see spec/v2/core/persistence.md §Runs pinned to v1
 * @see schemas/v2/run-event-payloads.schema.json runCancelled
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { era2Gate, eventsOf, pollEvents, seedEra2Log, type ReadEvent, type SeedEvent } from '../lib/era2-seed.js';

const DOC = 'spec/v2/core/persistence.md §Runs pinned to v1';
const REASON = 'v1_pin_unsupported';
const CANCELLED_BY = 'v2-cutover';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const SETTLE_MS = Number(process.env['OPENWOP_LIFECYCLE_TIMEOUT_MS'] ?? 10_000);

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

function pinnedLog(changeId: string): SeedEvent[] {
  const t0 = Date.parse('2026-01-15T12:00:00.000Z');
  const ts = (i: number) => new Date(t0 + i * 1000).toISOString();
  return [
    { type: 'run.started', sequence: 0, payload: { workflowId: 'conformance-noop' }, timestamp: ts(0) },
    { type: 'version.pinned', sequence: 1, payload: { changeId, version: 1 }, timestamp: ts(1) },
  ];
}

type Read = { readonly ok: true; readonly status: string; readonly events: ReadEvent[] } | { readonly ok: false; readonly kind: 'blocked' | 'inapplicable' | 'skipped'; readonly reason: string };

/** Seed, then read the snapshot status and the log once the host has decided (the disposition is applied at first v2 read or at the cut). */
async function seedAndRead(changeId: string): Promise<Read> {
  const seeded = await seedEra2Log(pinnedLog(changeId), 'running');
  if (!seeded.ok) return { ok: false, kind: seeded.kind, reason: seeded.reason };
  const deadline = Date.now() + SETTLE_MS;
  let status = '';
  for (;;) {
    const snap = await http(() => driver.get(`/runs/${encodeURIComponent(seeded.runId)}`));
    if (snap === null || snap.status !== 200) return { ok: false, kind: 'blocked', reason: `GET /runs/{runId} answered ${snap?.status ?? 'no response'} for the seeded run` };
    status = String((snap.json as { status?: unknown } | undefined)?.status ?? '');
    if (TERMINAL.has(status) || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const poll = await pollEvents(seeded.runId);
  if (poll === null || poll.status !== 200) return { ok: false, kind: 'blocked', reason: `GET /runs/{runId}/events/poll answered ${poll?.status ?? 'no response'} for the seeded run` };
  return { ok: true, status, events: eventsOf(poll.json) };
}

describe('RFC 0176 §B.1 — pinned-run-disposition (seam-gated)', () => {
  it('a pin naming a change id the host does not implement is cancelled with v1_pin_unsupported / v2-cutover', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    const changeId = `conformance-unknown-change-${Date.now().toString(36)}`;
    const r = await seedAndRead(changeId);
    if (!r.ok) return softSkip(r.kind, r.reason);
    expect(
      r.status,
      req('openwop.requirement.0176.pinned-run-disposition.cancelled', DOC, `a run pinned to a change id the host no longer implements MUST be cancelled, never followed silently — snapshot status is ${r.status}`),
    ).toBe('cancelled');
    const cancelled = r.events.filter((e) => e.type === 'run.cancelled');
    expect(cancelled.length, req('openwop.requirement.0176.pinned-run-disposition.cancelled', DOC, 'the cancellation MUST be an event on the run\'s own log (run.cancelled), not a silent status flip')).toBe(1);
    const payload = (cancelled[0]?.payload ?? {}) as { reason?: unknown; cancelledBy?: unknown };
    expect(payload.reason, req('openwop.requirement.0176.pinned-run-disposition.cancelled', 'run-event-payloads.schema.json runCancelled.reason', `reason MUST be the registered ${REASON}`)).toBe(REASON);
    expect(payload.cancelledBy, req('openwop.requirement.0176.pinned-run-disposition.cancelled', 'run-event-payloads.schema.json runCancelled.cancelledBy', `cancelledBy MUST be ${CANCELLED_BY}`)).toBe(CANCELLED_BY);
    const pin = r.events.find((e) => e.type === 'version.pinned');
    expect(pin, req('openwop.requirement.0176.pinned-run-disposition.cancelled', DOC, 'the version.pinned row MUST survive the cancellation — the log is preserved (adversarial review 4)')).toBeDefined();
    expect(
      (pin?.payload as { changeId?: unknown } | undefined)?.changeId,
      req('openwop.requirement.0176.pinned-run-disposition.cancelled', DOC, 'version.pinned is never rewritten: the pin still names the change id it was seeded with'),
    ).toBe(changeId);
  });

  it('a pin naming a change id the host still implements continues under the reader rule with the pin verbatim', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    const changeId = process.env['OPENWOP_TEST_IMPLEMENTED_CHANGE_ID']?.trim();
    if (!changeId) return softSkip('skipped', 'opt-in not supplied: no normative surface lists the change ids a host implements, so the continue leg needs OPENWOP_TEST_IMPLEMENTED_CHANGE_ID naming one');
    const r = await seedAndRead(changeId);
    if (!r.ok) return softSkip(r.kind, r.reason);
    expect(
      r.status,
      req('openwop.requirement.0176.pinned-run-disposition.continued', DOC, `a run whose every pinned change id is still implemented MUST continue under the adapter — it was cancelled (status ${r.status}) for a pin the operator says the host implements (${changeId})`),
    ).not.toBe('cancelled');
    expect(
      r.events.filter((e) => e.type === 'run.cancelled' && (e.payload as { reason?: unknown } | undefined)?.reason === REASON),
      req('openwop.requirement.0176.pinned-run-disposition.continued', DOC, `no run.cancelled { reason: ${REASON} } may appear on a run whose pin is implemented`),
    ).toEqual([]);
    const pin = r.events.find((e) => e.type === 'version.pinned');
    expect(
      (pin?.payload as { changeId?: unknown; version?: unknown } | undefined),
      req('openwop.requirement.0176.pinned-run-disposition.continued', DOC, 'the pin is honoured verbatim — version.pinned reads back with the seeded changeId and version'),
    ).toMatchObject({ changeId, version: 1 });
  });
});
