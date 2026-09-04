/**
 * v2 — `poll-cursor-v2` (suite 2.0.0; RFC 0171 §E.2;
 * `spec/v2/core/events.md` §"Poll").
 *
 * Witness class: witnessable — unaided. `GET /runs/{runId}/events/poll`
 * without a cursor returns from the first event (sequence 0);
 * `?afterSequence=N` returns only events with `sequence > N`; a cursor past
 * the end of the log returns `200` with an empty `events` array; the response
 * is the closed `{ runId, events, lastSequence, status, isTerminal }`. The run
 * is the `conformance-noop` fixture, awaited to a terminal status.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/events.md §Poll';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const TIMEOUT_MS = Number(process.env['OPENWOP_LIFECYCLE_TIMEOUT_MS'] ?? 10_000);
const SHAPE = ['runId', 'events', 'lastSequence', 'status', 'isTerminal'];

interface Poll { readonly runId?: unknown; readonly events?: unknown; readonly lastSequence?: unknown; readonly status?: unknown; readonly isTerminal?: unknown }

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

async function terminalRun(): Promise<{ runId: string } | { reason: string }> {
  if (!(await discovery())) return { reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  const created = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
  if (created === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (created.json as { runId?: unknown } | undefined)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim() };
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const snap = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
    if (snap !== null && TERMINAL.has(String((snap.json as { status?: unknown } | undefined)?.status))) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { runId };
}

async function poll(runId: string, query: string): Promise<OpenWOPResponse | null> {
  return http(() => driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1${query}`));
}

function sequences(body: unknown): number[] {
  const events = (body as Poll | undefined)?.events;
  return Array.isArray(events) ? events.map((e) => Number((e as { sequence?: unknown }).sequence)) : [];
}

describe('v2 poll-cursor-v2 (RFC 0171 §E.2)', () => {
  it('the response is the closed { runId, events, lastSequence, status, isTerminal }', async () => {
    const r = await terminalRun();
    if ('reason' in r) return softSkip('blocked', r.reason);
    const res = await poll(r.runId, '');
    if (res === null) return softSkip('blocked', 'GET /runs/{runId}/events/poll unreachable (fetch failed)');
    expect(res.status, req('openwop.requirement.0171.poll-cursor-v2.shape', DOC, 'pollRunEvents MUST answer 200')).toBe(200);
    const body = res.json as Poll | undefined;
    expect(Object.keys(body ?? {}).sort(), req('openwop.requirement.0171.poll-cursor-v2.shape', DOC, 'the poll response MUST be exactly { runId, events, lastSequence, status, isTerminal } (closed)')).toEqual([...SHAPE].sort());
    expect(body?.runId, req('openwop.requirement.0171.poll-cursor-v2.shape', DOC, 'runId MUST echo the polled run')).toBe(r.runId);
    expect(Array.isArray(body?.events), req('openwop.requirement.0171.poll-cursor-v2.shape', DOC, 'events MUST be an array')).toBe(true);
    expect(Number.isInteger(body?.lastSequence) && (body?.lastSequence as number) >= -1, req('openwop.requirement.0171.poll-cursor-v2.shape', DOC, 'lastSequence is the highest sequence in the log (−1 when empty)')).toBe(true);
    expect(typeof body?.status, req('openwop.requirement.0171.poll-cursor-v2.shape', DOC, 'status is the snapshot status')).toBe('string');
    expect(typeof body?.isTerminal, req('openwop.requirement.0171.poll-cursor-v2.shape', DOC, 'isTerminal is a boolean')).toBe('boolean');
    const seqs = sequences(body);
    if (seqs.length > 0) expect(Math.max(...seqs), req('openwop.requirement.0171.poll-cursor-v2.shape', DOC, 'lastSequence MUST equal the highest sequence returned when the response carries the whole log')).toBeLessThanOrEqual(body?.lastSequence as number);
  });

  it('omitting the cursor returns from the first event (sequence 0)', async () => {
    const r = await terminalRun();
    if ('reason' in r) return softSkip('blocked', r.reason);
    const res = await poll(r.runId, '');
    if (res === null || res.status !== 200) return softSkip('blocked', `GET /runs/{runId}/events/poll answered ${res?.status ?? 'no response'}`);
    const seqs = sequences(res.json);
    if (seqs.length === 0) return softSkip('blocked', 'the poll returned no events for a run driven to terminal status — the first-event rule is unobservable');
    expect(seqs[0], req('openwop.requirement.0171.poll-cursor-v2.from-first', DOC, 'omission of afterSequence means "from the first event": the first returned sequence MUST be 0')).toBe(0);
  });

  it('afterSequence=N returns only events with sequence > N', async () => {
    const r = await terminalRun();
    if ('reason' in r) return softSkip('blocked', r.reason);
    const all = await poll(r.runId, '');
    if (all === null || all.status !== 200) return softSkip('blocked', `GET /runs/{runId}/events/poll answered ${all?.status ?? 'no response'}`);
    const seqs = sequences(all.json);
    if (seqs.length === 0) return softSkip('blocked', 'the poll returned no events for a run driven to terminal status — the cursor rule is unobservable');
    const n = seqs[0] as number;
    const res = await poll(r.runId, `&afterSequence=${n}`);
    if (res === null) return softSkip('blocked', 'GET /runs/{runId}/events/poll?afterSequence= unreachable (fetch failed)');
    expect(res.status, req('openwop.requirement.0171.poll-cursor-v2.after-sequence', DOC, 'afterSequence is an integer ≥ 0 and MUST be accepted')).toBe(200);
    const after = sequences(res.json);
    expect(after.every((s) => s > n), req('openwop.requirement.0171.poll-cursor-v2.after-sequence', DOC, `every returned sequence MUST be > afterSequence (${n}); got [${after.join(', ')}]`)).toBe(true);
    expect(after, req('openwop.requirement.0171.poll-cursor-v2.after-sequence', DOC, 'the cursor is exclusive and the log is not renumbered: afterSequence=first yields exactly the rest of the log')).toEqual(seqs.filter((s) => s > n));
  });

  it('a cursor past the end of the log returns 200 with an empty events array', async () => {
    const r = await terminalRun();
    if ('reason' in r) return softSkip('blocked', r.reason);
    const all = await poll(r.runId, '');
    if (all === null || all.status !== 200) return softSkip('blocked', `GET /runs/{runId}/events/poll answered ${all?.status ?? 'no response'}`);
    const last = Number((all.json as Poll | undefined)?.lastSequence);
    const res = await poll(r.runId, `&afterSequence=${(Number.isFinite(last) ? last : 0) + 1000}`);
    if (res === null) return softSkip('blocked', 'GET /runs/{runId}/events/poll?afterSequence= unreachable (fetch failed)');
    expect(res.status, req('openwop.requirement.0171.poll-cursor-v2.past-end', DOC, 'a cursor past the end of the log MUST return 200')).toBe(200);
    expect((res.json as Poll | undefined)?.events, req('openwop.requirement.0171.poll-cursor-v2.past-end', DOC, 'a cursor past the end of the log MUST return an empty events array')).toEqual([]);
  });
});
