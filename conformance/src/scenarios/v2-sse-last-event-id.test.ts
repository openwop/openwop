/**
 * `spec/v2/core/events.md` §SSE frames — `Last-Event-ID` resumes every mode
 * (suite 2.0.0, target major 2; unaided; one run created).
 *
 * The host MUST look up the event with that sequence, MUST begin at the next
 * sequence, and MUST NOT re-emit the resumption point; in `values` mode the
 * resumption MUST emit a `state.snapshot` first. Frames carry `id:` = the
 * sequence (0-based: the first frame's id is `0`, so ids are tested for
 * presence and parsed, never for truthiness).
 *
 * Legs and controls, all on one completed noop run:
 *   1. the full stream: ≥1 frame, numeric ids, closed by the server;
 *   2. resume at the first id: the first resumed id is greater, the resumption
 *      id is absent, and the resumed set equals the full set minus every id at
 *      or below it — one assertion catches loss and duplication;
 *   3. resume at the last id: zero frames, closed by server (a host that ignores
 *      the header re-sends all N against an expected 0; a host that closes
 *      every stream empty fails leg 1);
 *   4. if `values` is served: a `values` resume's first frame is
 *      `event: state.snapshot` (a frame name, not a type — §SSE frames).
 *
 * @see spec/v2/core/events.md §SSE frames
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { subscribe, type SseEvent } from '../lib/sse.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0171.sse-last-event-id';
const DOC = 'spec/v2/core/events.md §SSE frames';
const NOOP = 'conformance-noop';
const V2 = { 'OpenWOP-Version': '2.0' };

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);
/** The frame's sequence, or null when the frame carries no id — `0` is a valid id. */
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

describe('v2 sse-last-event-id (events.md §SSE frames)', () => {
  it('Last-Event-ID resumes at the next sequence, never re-emits the resumption point, loses nothing, and at the last id yields nothing', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const c = await createSettled(); if ('reason' in c) return softSkip('blocked', c.reason);
    const path = `/runs/${enc(c.runId)}/events?streamMode=debug`;
    const full = await subscribe(path, { timeoutMs: 8_000, extraHeaders: V2 });
    if (full.status === 404) return softSkip('blocked', 'GET /runs/{runId}/events answered 404 — streamRunEvents is a core operation and is not mounted');
    expect(full.status, req(ID, DOC, `the stream MUST answer 200 — got ${full.status}`)).toBe(200);
    expect(full.events.length, req(ID, DOC, 'the completed log MUST stream as at least one frame')).toBeGreaterThan(0);
    expect(full.closedBy, req(ID, DOC, `the host MUST close after the terminal event (closed by ${full.closedBy})`)).toBe('server');
    const ids = full.events.map(seqOf);
    expect(ids.every((n) => n !== null), req(ID, DOC, `every frame MUST carry id: = its sequence (frames without a parseable id: ${ids.filter((n) => n === null).length} of ${ids.length})`)).toBe(true);
    const seqs = ids as number[];
    expect([...seqs].sort((a, b) => a - b), req(ID, DOC, 'frames MUST arrive in log order')).toEqual(seqs);
    const first = seqs[0]!; const last = seqs[seqs.length - 1]!;

    const resumed = await subscribe(path, { timeoutMs: 8_000, extraHeaders: V2, lastEventId: String(first) });
    expect(resumed.status, req(ID, DOC, `a resume with Last-Event-ID MUST answer 200 — got ${resumed.status}`)).toBe(200);
    const rseqs = resumed.events.map(seqOf).filter((n): n is number => n !== null);
    expect(rseqs.includes(first), req(ID, DOC, `the host MUST NOT re-emit the resumption point (Last-Event-ID ${first} re-emitted)`)).toBe(false);
    expect(rseqs, req(ID, DOC, `the host MUST begin at the next sequence and lose nothing: resumed ids (${rseqs.join(',')}) MUST equal the full set minus every id ≤ ${first} (${seqs.filter((n) => n > first).join(',')})`)).toEqual(seqs.filter((n) => n > first));

    const atEnd = await subscribe(path, { timeoutMs: 8_000, extraHeaders: V2, lastEventId: String(last) });
    expect(atEnd.status, req(ID, DOC, `a resume at the terminal sequence MUST answer 200 — got ${atEnd.status}`)).toBe(200);
    expect(atEnd.events.length, req(ID, DOC, `a resume at the last sequence (${last}) MUST emit nothing and close — a host ignoring the header re-sends all ${seqs.length} (got ${atEnd.events.length})`)).toBe(0);
    expect(atEnd.closedBy, req(ID, DOC, 'the host MUST close the empty resume itself')).toBe('server');

    // values: resumption MUST emit a state.snapshot first — only where the host serves values.
    const probe = await http(() => driver.get(`/runs/${enc(c.runId)}/events?streamMode=bogus`, { headers: { Accept: 'text/event-stream' } }));
    const supported = (probe?.json as { details?: { supported?: unknown } } | null)?.details?.supported;
    if (!Array.isArray(supported) || !supported.includes('values')) return softSkip('inapplicable', `values mode not served (details.supported: ${JSON.stringify(supported)}) — the state.snapshot-first resumption leg does not apply`);
    const values = await subscribe(`/runs/${enc(c.runId)}/events?streamMode=values`, { timeoutMs: 8_000, extraHeaders: V2, lastEventId: String(first) });
    expect(values.status, req(ID, DOC, `a values resume MUST answer 200 — got ${values.status}`)).toBe(200);
    expect(values.events[0]?.event ?? null, req(ID, DOC, `in values mode a resumption MUST emit a state.snapshot first (first frame: ${values.events[0]?.event ?? 'none'})`)).toBe('state.snapshot');
  }, 45_000);
});
