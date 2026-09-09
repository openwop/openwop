/**
 * `spec/v2/core/events.md` §The events channel — `streamMode` is one pattern,
 * refused with `400 unsupported_stream_mode`, validated before content
 * negotiation; `bufferMs` batches (suite 2.0.0, target major 2; unaided; one
 * run created).
 *
 * Legs:
 *   1. `?streamMode=bogus` → 400 `unsupported_stream_mode`, `details.supported`
 *      a non-empty array of individual modes; the same request with
 *      `Accept: application/json` → still 400, never 406 (validation runs
 *      before content negotiation; the only v2 406 is a version mismatch and
 *      this request names a listed major); `?streamMode=updates,values` → 400
 *      (`values` never combines); a mode absent from `supported`, if any → 400.
 *   2. control: `?streamMode=updates` → 200 `text/event-stream` with ≥1 frame
 *      (a host that answers 400 to every mode fails here; `updates` is a MUST).
 *   3. `?bufferMs=200` → at least one `event: batch` frame whose `data:` is an
 *      array of RunEventDoc, and the flattened frames equal the log in order;
 *      without `bufferMs` no frame is `batch` (the control). "Every frame is
 *      batch" is deliberately NOT asserted: a consumer MUST tolerate an
 *      unbatched frame beside a one-element batch (§SSE frames).
 *
 * @see spec/v2/core/events.md §The events channel, §SSE frames
 * @see spec/v2/errors.json unsupported_stream_mode
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { subscribe, type SseEvent } from '../lib/sse.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0171.stream-mode-refusal';
const DOC = 'spec/v2/core/events.md §The events channel';
const NOOP = 'conformance-noop';
const MODES = ['values', 'updates', 'messages', 'debug'];
const V2 = { 'OpenWOP-Version': '2.0' };

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);

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

/** The events a frame carries: a batch frame's array flattened, a plain frame's one document. */
function docsOf(frame: SseEvent): Array<Record<string, unknown>> {
  try { const p = JSON.parse(frame.data) as unknown; return (Array.isArray(p) ? p : [p]).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object'); } catch { return []; }
}

describe('v2 stream-mode-refusal (events.md §The events channel)', () => {
  it('a value outside the pattern, a forbidden combination, and an unimplemented mode are refused 400 unsupported_stream_mode with details.supported — before content negotiation', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const c = await createSettled(); if ('reason' in c) return softSkip('blocked', c.reason);
    const path = `/runs/${enc(c.runId)}/events`;
    const bogus = await http(() => driver.get(`${path}?streamMode=bogus`, { headers: { Accept: 'text/event-stream' } }));
    if (bogus === null) return softSkip('blocked', 'GET /runs/{runId}/events unreachable (fetch failed)');
    if (bogus.status === 404) return softSkip('blocked', 'GET /runs/{runId}/events answered 404 — streamRunEvents is a core operation (runs.md §Surface) and is not mounted');
    expect(bogus.status, req(ID, DOC, `a streamMode outside the pattern MUST be refused 400 — got ${bogus.status}`)).toBe(400);
    expect(readErrorCode(bogus.json), req(ID, DOC, 'the refusal MUST be unsupported_stream_mode')).toBe('unsupported_stream_mode');
    const supported = (bogus.json as { details?: { supported?: unknown } } | null)?.details?.supported;
    expect(Array.isArray(supported) && supported.length > 0 && supported.every((m) => MODES.includes(String(m))), req(ID, DOC, `details.supported MUST list each individual mode the host serves (got ${JSON.stringify(supported)})`)).toBe(true);
    expect((supported as string[]).includes('updates'), req(ID, DOC, 'a host MUST implement updates, so supported MUST list it')).toBe(true);

    const negotiated = await http(() => driver.get(`${path}?streamMode=bogus`, { headers: { Accept: 'application/json' } }));
    expect(negotiated?.status ?? null, req(ID, DOC, `validation MUST run before any content negotiation: a bogus streamMode with Accept: application/json is still 400 unsupported_stream_mode, never 406 (the only v2 406 is a version mismatch and this request names a listed major) — got ${negotiated?.status ?? 'no response'}`)).toBe(400);

    const combo = await http(() => driver.get(`${path}?streamMode=updates,values`, { headers: { Accept: 'text/event-stream' } }));
    expect(combo?.status ?? null, req(ID, DOC, `values never combines: streamMode=updates,values is outside the pattern and MUST be refused 400 — got ${combo?.status ?? 'no response'}`)).toBe(400);
    expect(readErrorCode(combo?.json), req(ID, DOC, 'the refusal MUST be unsupported_stream_mode')).toBe('unsupported_stream_mode');

    // The unimplemented-mode leg has something to request only when a mode is
    // absent from details.supported; a host serving all four has no such mode,
    // and the three refusals above are its witness.
    const missing = MODES.find((m) => !(supported as string[]).includes(m));
    if (missing !== undefined) {
      const unimpl = await http(() => driver.get(`${path}?streamMode=${missing}`, { headers: { Accept: 'text/event-stream' } }));
      expect(unimpl?.status ?? null, req(ID, DOC, `a mode the host does not implement (${missing}, absent from details.supported) MUST be refused 400 — got ${unimpl?.status ?? 'no response'}`)).toBe(400);
      expect(readErrorCode(unimpl?.json), req(ID, DOC, 'the refusal MUST be unsupported_stream_mode')).toBe('unsupported_stream_mode');
    }
  }, 30_000);

  it('updates streams 200 text/event-stream with frames; bufferMs yields at least one batch frame whose data is an array and loses nothing; without bufferMs no frame is batch', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const c = await createSettled(); if ('reason' in c) return softSkip('blocked', c.reason);
    const path = `/runs/${enc(c.runId)}/events`;
    const plain = await subscribe(`${path}?streamMode=updates`, { timeoutMs: 8_000, extraHeaders: V2 });
    if (plain.status === 404) return softSkip('blocked', 'GET /runs/{runId}/events answered 404 — not mounted');
    expect(plain.status, req(ID, DOC, `updates is a MUST: streamMode=updates MUST answer 200 — got ${plain.status} (the control for the refusals: a host answering 400 to every mode fails here)`)).toBe(200);
    expect(plain.events.length, req(ID, 'spec/v2/core/events.md §SSE frames', 'the completed run\'s log MUST stream as at least one frame before the server closes')).toBeGreaterThan(0);
    expect(plain.closedBy, req(ID, 'spec/v2/core/events.md §SSE frames', `the host MUST close after the terminal event (closed by ${plain.closedBy})`)).toBe('server');
    expect(plain.events.some((f) => f.event === 'batch'), req(ID, 'spec/v2/core/events.md §SSE frames', 'without bufferMs no frame is a batch (the control for the batch leg)')).toBe(false);
    const plainDocs = plain.events.flatMap(docsOf).map((d) => d['sequence']);

    const buffered = await subscribe(`${path}?streamMode=updates&bufferMs=200`, { timeoutMs: 8_000, extraHeaders: V2 });
    expect(buffered.status, req(ID, 'spec/v2/core/events.md §SSE frames', `streamMode=updates&bufferMs=200 MUST answer 200 — got ${buffered.status}`)).toBe(200);
    const batches = buffered.events.filter((f) => f.event === 'batch');
    expect(batches.length, req(ID, 'spec/v2/core/events.md §SSE frames', `with bufferMs the host accumulates events into event: batch frames — none seen among ${buffered.events.length} frame(s) (${[...new Set(buffered.events.map((f) => f.event))].join(', ')})`)).toBeGreaterThan(0);
    for (const b of batches) {
      let parsed: unknown; try { parsed = JSON.parse(b.data); } catch { parsed = undefined; }
      expect(Array.isArray(parsed), req(ID, 'spec/v2/core/events.md §SSE frames', 'a batch frame\'s data MUST be an array of RunEventDoc')).toBe(true);
    }
    const bufferedDocs = buffered.events.flatMap(docsOf).map((d) => d['sequence']);
    expect(bufferedDocs, req(ID, 'spec/v2/core/events.md §SSE frames', 'batching MUST NOT lose or reorder events: the flattened buffered stream equals the unbuffered log (a one-element batch and an unbatched frame are both tolerated)')).toEqual(plainDocs);
  }, 30_000);
});
