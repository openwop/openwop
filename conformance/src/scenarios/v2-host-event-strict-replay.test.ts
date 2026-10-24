/**
 * v2 — opt-in strict host-event replay (RFC 0250; the rules are the
 * `hostEvents.replay` description in `spec/v2/facets/hostEvents.schema.json`
 * and `events.md` §Host events).
 *
 * Server-free (always on):
 *   1. `0250.shape` — the `replay` facet member validates; a zero retention,
 *      an unknown member and the old `mode` member are refused.
 *
 * Host legs — gated on `hostEvents.replay` and the RFC 0241 trigger
 * (`host-test.durable-triggered` and `host-test.ephemeral-triggered` listed).
 * One sequence per worker: emit durable D1, D2, ephemeral E, durable D3 with
 * no stream open, then reconnect with `replay=required` and `Last-Event-ID: D1`
 * and emit D4 while the stream is open. Judges in
 * `lib/host-event-replay-witness.ts`.
 *   2. `0250.resume-backlog` — exactly D2, D3, D4 arrive, in that order, never
 *      D1: the backlog, then live, with no gap at the handoff.
 *   3. `0250.ephemeral-not-replayed` — E does not come back.
 *   4. `0250.cursor-refused` — an unknown cursor is `409
 *      host_event_resync_required` before any SSE byte.
 *   5. `0250.refusal-uniform` — E's id and a second tenant's real durable id
 *      (`OPENWOP_TEST_TENANT_B_API_KEY`) are refused byte-identically to the
 *      unknown cursor, so a refusal is no oracle; and an unauthenticated
 *      request naming D1 is refused (401 or the uniform 409), never resumed.
 *   6. `0250.legacy-unchanged` — without `replay=required`, an unknown cursor
 *      is not answered with the new refusal.
 *
 * Retention across process replacement and expiry are not caused here: losing
 * an event inside the retention window is a violation of leg 2 however it
 * happens, and the suite cannot replace a host's process.
 *
 * @see RFCS/0250-opt-in-host-event-replay-and-resync.md
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { subscribe } from '../lib/sse.js';
import { advertisedTypes, testTypeListed, TEST_TYPES } from '../lib/host-event-witness.js';
import {
  judgeLegacy, judgeNoEphemeralReplay, judgeRefused, judgeUnauthenticatedNotResumed, judgeResume, judgeUniform,
  type RefusalAnswer, type ReplayFinding, type ReplayFrame,
} from '../lib/host-event-replay-witness.js';

const DOC = 'hostEvents.schema.json §replay, events.md §Host events (RFC 0250)';
const ID_SHAPE = 'openwop.requirement.0250.shape';
const ID_RESUME = 'openwop.requirement.0250.resume-backlog';
const ID_EPHEMERAL = 'openwop.requirement.0250.ephemeral-not-replayed';
const ID_REFUSED = 'openwop.requirement.0250.cursor-refused';
const ID_UNIFORM = 'openwop.requirement.0250.refusal-uniform';
const ID_LEGACY = 'openwop.requirement.0250.legacy-unchanged';

const TRIGGER = '/host/events/test';
const V2 = { 'OpenWOP-Version': '2.0' };
const STREAM_MS = 4_000;
const REFUSAL_MS = 4_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Skip = { skip: [Parameters<typeof softSkip>[0], string] };
async function gate(): Promise<Skip | { ok: true }> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { skip: ['blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0'] };
  const record = await familyAdvertised('hostEvents');
  if (record === null) return { skip: ['inapplicable', 'the host does not advertise hostEvents'] };
  const replay = record['replay'];
  if (replay === null || typeof replay !== 'object') return { skip: ['inapplicable', 'the host does not advertise hostEvents.replay'] };
  const types = advertisedTypes(record);
  if (testTypeListed(types, 'durable') === null || testTypeListed(types, 'ephemeral') === null) {
    return { skip: ['inapplicable', `hostEvents.types lists ${TEST_TYPES.durable} and ${TEST_TYPES.ephemeral} not both, so the suite cannot cause the sequence (RFC 0241 §B.1)`] };
  }
  return { ok: true };
}

async function emit(delivery: 'durable' | 'ephemeral', bearer?: string): Promise<string | null> {
  try {
    const res = await driver.post(TRIGGER, { delivery }, bearer === undefined ? {} : { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } });
    const id = (res.json as { eventId?: unknown } | undefined)?.eventId;
    return res.status === 202 && typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/** A `replay=required` request expected to be refused; `null` when a stream opened instead. */
async function refusalFor(cursor: string, anonymous = false): Promise<RefusalAnswer> {
  try {
    const r = await driver.get('/host/events?replay=required', { headers: { ...V2, 'Last-Event-ID': cursor }, timeoutMs: REFUSAL_MS, ...(anonymous ? { authenticated: false } : {}) });
    return { status: r.status, contentType: r.headers.get('content-type'), text: r.text, json: r.json };
  } catch {
    return null;
  }
}

interface Sequence {
  readonly blockedAt?: string;
  readonly d1?: string; readonly after?: string[]; readonly e?: string;
  readonly frames?: ReplayFrame[];
}
let seq: Promise<Sequence> | undefined;
function sequence(): Promise<Sequence> {
  seq ??= drive();
  return seq;
}
async function drive(): Promise<Sequence> {
  const d1 = await emit('durable'); if (d1 === null) return { blockedAt: `${TRIGGER} did not accept durable D1` };
  const d2 = await emit('durable'); if (d2 === null) return { blockedAt: `${TRIGGER} did not accept durable D2` };
  const e = await emit('ephemeral'); if (e === null) return { blockedAt: `${TRIGGER} did not accept ephemeral E` };
  const d3 = await emit('durable'); if (d3 === null) return { blockedAt: `${TRIGGER} did not accept durable D3` };
  const sub = subscribe('/host/events?replay=required', { timeoutMs: STREAM_MS, extraHeaders: V2, lastEventId: d1 });
  await sleep(800);
  const d4 = await emit('durable');
  const res = await sub;
  if (d4 === null) return { blockedAt: `${TRIGGER} did not accept durable D4 while the resumed stream was open` };
  if (res.status !== 200) return { blockedAt: `the replay=required stream with cursor D1 answered ${res.status}` };
  return { d1, after: [d2, d3, d4], e, frames: res.events.map((x) => ({ id: x.id, event: x.event, data: x.data })) };
}

const expectAll = (id: string, findings: readonly ReplayFinding[]): void => {
  for (const x of findings) expect(x.ok, req(id, DOC, x.message)).toBe(true);
};

describe('v2 RFC 0250 — hostEvents.replay shape (server-free)', () => {
  it('the replay facet member validates, and its negatives are refused', () => {
    const v = v2RefValidator('capabilities.schema.json#/properties/hostEvents/properties/replay');
    const S = 'hostEvents.schema.json §replay (RFC 0250)';
    expect(v({ minRetentionSeconds: 3600 }).ok, req(ID_SHAPE, S, 'a positive retention MUST validate')).toBe(true);
    expect(v({ minRetentionSeconds: 0 }).ok, req(ID_SHAPE, S, 'a zero retention MUST be refused')).toBe(false);
    expect(v({}).ok, req(ID_SHAPE, S, 'minRetentionSeconds is required')).toBe(false);
    expect(v({ minRetentionSeconds: 60, mode: 'required-cursor-v1' }).ok, req(ID_SHAPE, S, 'the member is closed (the Draft mode const was dropped)')).toBe(false);
  });
});

describe('v2 RFC 0250 — strict replay (host)', () => {
  it('a resumed stream delivers the backlog after the cursor, then live, in order', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const s = await sequence();
    if (s.frames === undefined) return softSkip('blocked', s.blockedAt ?? 'the sequence did not complete');
    expectAll(ID_RESUME, judgeResume(s.frames, s.d1!, s.after!, s.e!));
  }, 30_000);

  it('an ephemeral event is not replayed', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const s = await sequence();
    if (s.frames === undefined) return softSkip('blocked', s.blockedAt ?? 'the sequence did not complete');
    expectAll(ID_EPHEMERAL, judgeNoEphemeralReplay(s.frames, s.e!));
  }, 30_000);

  it('an unknown cursor is refused 409 host_event_resync_required before any SSE byte', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    expectAll(ID_REFUSED, judgeRefused(await refusalFor(`conformance-unknown-${randomBytes(8).toString('hex')}`), 'an unknown cursor'));
  }, 15_000);

  it('a foreign or ephemeral cursor is refused byte-identically to an unknown one', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const tenantB = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
    if (!tenantB) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set');
    if (tenantB === process.env['OPENWOP_API_KEY']) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the leg needs a second tenant');
    const s = await sequence();
    if (s.e === undefined) return softSkip('blocked', s.blockedAt ?? 'the sequence did not complete');
    const foreign = await emit('durable', tenantB);
    if (foreign === null) return softSkip('blocked', `${TRIGGER} as tenant B did not accept a durable event`);
    const unknown = await refusalFor(`conformance-unknown-${randomBytes(8).toString('hex')}`);
    const answers = [
      { what: 'an unknown cursor', a: unknown },
      { what: "another tenant's real durable cursor", a: await refusalFor(foreign) },
      { what: "an ephemeral event's id", a: await refusalFor(s.e) },
    ];
    const anonymous = await refusalFor(s.d1!, true);
    expectAll(ID_UNIFORM, [...answers.flatMap(({ what, a }) => judgeRefused(a, what)), ...judgeUniform(answers), ...judgeUnauthenticatedNotResumed(anonymous)]);
  }, 30_000);

  it('without replay=required an unknown cursor keeps its existing answer', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const r = await subscribe('/host/events', { timeoutMs: 1_500, extraHeaders: V2, lastEventId: `conformance-unknown-${randomBytes(8).toString('hex')}` });
    expectAll(ID_LEGACY, judgeLegacy(r.status === 0 ? null : r.status));
  }, 15_000);
});
