/**
 * `spec/v2/core/events.md` §SSE frames — `Last-Event-ID` is an exclusive
 * cursor (RFC 0213 §A; suite 2.37.0, target major 2; unaided; one run created).
 *
 * `Last-Event-ID: N` streams the events with `sequence > N`. When N is at or
 * beyond the last persisted sequence there is no backlog: a terminal run's
 * stream closes without a frame. A host MUST NOT refuse a well-formed
 * non-negative integer because no event carries that sequence; any other value
 * SHOULD be refused `400 validation_error`. The header is evaluated only after
 * the caller is authorized to read the run: for a run the caller cannot read
 * the answer MUST be the one the host gives without the header.
 *
 * Off the core-standard floor: `v2-sse-last-event-id` is the floor scenario and
 * this file adds legs a committed claim was never measured against (rc.59
 * precedent). Promotion waits until the three bundle hosts are measured.
 *
 * Legs, on one completed noop run:
 *   1. a future id (last + 1000) ⇒ 200, zero frames, closed by the server — a
 *      host that 400s the id fails the status, one that resumes from 0 fails
 *      the frame count;
 *   2. `Last-Event-ID: abc` ⇒ if refused, `400 validation_error` (SHOULD: a
 *      host that ignores it is recorded, not failed);
 *   3. an unknown own-tenant runId and a foreign-tenant runId answer the same
 *      status and error code with and without the header — a host that reads
 *      the cursor before authorizing answers them differently.
 *
 * @see spec/v2/core/events.md §SSE frames
 * @see RFCS/0213-three-unstated-v2-outcomes.md §A
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { subscribe, type SseEvent } from '../lib/sse.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/events.md §SSE frames';
const ID_CURSOR = 'openwop.requirement.0213.last-event-id-exclusive-cursor';
const ID_MALFORMED = 'openwop.requirement.0213.last-event-id-malformed';
const ID_AUTHZ = 'openwop.requirement.0213.last-event-id-after-authorization';
const NOOP = 'conformance-noop';
const V2 = { 'OpenWOP-Version': '2.0' };
const FOREIGN_RUN_ID = 'openwop-conformance-foreign-tenant/foreignopaque0123456789abcdef';

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);
function seqOf(f: SseEvent): number | null { if (f.id === null || f.id === '') return null; const n = Number.parseInt(f.id, 10); return Number.isFinite(n) ? n : null; }

async function createSettled(): Promise<{ runId: string } | { reason: string }> {
  const res = await http(() => driver.post('/runs', { workflowId: NOOP }));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | null)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs answered ${res.status} ${readErrorCode(res.json) ?? ''}`.trim() };
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    const s = await http(() => driver.get(`/runs/${enc(runId)}`));
    if (s?.status === 200 && ['completed', 'failed', 'cancelled'].includes(String((s.json as { status?: unknown }).status))) return { runId };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { reason: 'the noop run did not settle within 10 s' };
}

/** Status and error code of a stream request, never reading an SSE body (a 200 is reported as-is). */
async function answer(path: string, lastEventId?: string): Promise<{ status: number; code: string | null }> {
  const probe = await subscribe(path, { timeoutMs: 5_000, extraHeaders: V2, ...(lastEventId === undefined ? {} : { lastEventId }) });
  if (probe.status === 200) return { status: 200, code: null };
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (lastEventId !== undefined) headers['Last-Event-ID'] = lastEventId;
  const res = await http(() => driver.get(path, { headers }));
  return { status: probe.status, code: res === null ? null : (readErrorCode(res.json) ?? null) };
}

describe('v2 sse-last-event-id-cursor (events.md §SSE frames, RFC 0213 §A)', () => {
  it('a Last-Event-ID past the log is an exclusive cursor: a terminal run answers 200 with no frame and closes', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const c = await createSettled(); if ('reason' in c) return softSkip('blocked', c.reason);
    const path = `/runs/${enc(c.runId)}/events?streamMode=debug`;
    const full = await subscribe(path, { timeoutMs: 8_000, extraHeaders: V2 });
    if (full.status === 404) return softSkip('blocked', 'GET /runs/{runId}/events answered 404 — streamRunEvents is a core operation and is not mounted');
    const seqs = full.events.map(seqOf).filter((n): n is number => n !== null);
    if (full.status !== 200 || seqs.length === 0) return softSkip('blocked', `the full stream did not yield numbered frames (status ${full.status}, ${seqs.length} ids) — v2-sse-last-event-id owns that contract`);
    const future = String(Math.max(...seqs) + 1000);
    const past = await subscribe(path, { timeoutMs: 8_000, extraHeaders: V2, lastEventId: future });
    expect(past.status, req(ID_CURSOR, DOC, `a well-formed Last-Event-ID no event carries (${future}) MUST NOT be refused — got ${past.status}`)).toBe(200);
    expect(past.events.length, req(ID_CURSOR, DOC, `a cursor past the end of a terminal run's log MUST yield no frame — a host resuming from 0 re-sends all ${seqs.length} (got ${past.events.length})`)).toBe(0);
    expect(past.closedBy, req(ID_CURSOR, DOC, 'on a terminal run the host MUST close the empty stream itself')).toBe('server');
  }, 45_000);

  it('a Last-Event-ID that is not a non-negative integer, when refused, is 400 validation_error', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const c = await createSettled(); if ('reason' in c) return softSkip('blocked', c.reason);
    const got = await answer(`/runs/${enc(c.runId)}/events?streamMode=debug`, 'abc');
    if (got.status === 200) return softSkip('inapplicable', 'the host accepted Last-Event-ID: abc (the refusal is a SHOULD — recorded, not failed)');
    expect(got.status, req(ID_MALFORMED, DOC, `a refused malformed Last-Event-ID SHOULD be 400 — got ${got.status}`)).toBe(400);
    expect(got.code, req(ID_MALFORMED, 'spec/v2/core/errors.md', `the refusal MUST carry validation_error — got ${String(got.code)}`)).toBe('validation_error');
  }, 30_000);

  it('the cursor never changes the answer for a run the caller cannot read', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const c = await createSettled(); if ('reason' in c) return softSkip('blocked', c.reason);
    const slash = c.runId.indexOf('/');
    if (slash <= 0) return softSkip('blocked', `the created runId ${c.runId} carries no tenant segment — v2-id-grammar owns that contract`);
    const unknown = `${c.runId.slice(0, slash)}/openwopconformanceunknown${Date.now().toString(36)}`;
    for (const [label, runId] of [['unknown own-tenant run', unknown], ['foreign-tenant run', FOREIGN_RUN_ID]] as const) {
      const path = `/runs/${enc(runId)}/events?streamMode=debug`;
      const bare = await answer(path);
      const cursor = await answer(path, '0');
      expect(bare.status, req(ID_AUTHZ, 'spec/v2/core/runs.md §Identity', `a ${label} MUST NOT be streamed (got ${bare.status})`)).not.toBe(200);
      expect({ status: cursor.status, code: cursor.code }, req(ID_AUTHZ, DOC, `for a ${label} the answer with Last-Event-ID (${cursor.status} ${String(cursor.code)}) MUST equal the answer without it (${bare.status} ${String(bare.code)})`)).toEqual({ status: bare.status, code: bare.code });
    }
  }, 45_000);
});
