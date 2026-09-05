/**
 * `spec/v2/core/events.md` §SSE frames + `identity.md` §5 — every `data:` frame
 * on the major-2 run stream names the run by its tenant-bound id (suite 2.0.0,
 * target major 2; unaided).
 *
 * This scenario exists because both production hosts shipped the same defect
 * and the suite could not see it. Each built one projection seam for the
 * tenant-bound `runId` and each found an emitter outside it on the stream
 * path: one host's SSE route had three `res.write` sites and no per-frame
 * projector at all; the other's per-frame path projected while its `batch`
 * flush wrote the raw array. Sixteen green mount tests on one host all used
 * `res.json` handlers. Of the 56 `v2-*` files, none read a stream frame —
 * `grep -E '^v2-.*(sse|stream)'` was empty — so both defects were invisible to
 * the suite by construction and were found by a live witness and by a peer's
 * report. A tier-1 host asked for this file by name.
 *
 * The assertion is one line: every frame's `runId` is the bound id the create
 * returned. It is asserted per frame rather than on the first, because the
 * batch-flush variant projects the first frame and not the rest.
 *
 * @see spec/v2/core/events.md §SSE frames
 * @see spec/v2/core/identity.md §5
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { streamEvents } from '../lib/era2-seed.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0171.stream-sse-projection';
const DOC = 'spec/v2/core/events.md §SSE frames';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const RUN_ID = /^[A-Za-z0-9._~-]{1,128}\/[A-Za-z0-9._~-]{16,128}$/;

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

async function createRun(): Promise<{ runId: string } | { reason: string }> {
  try { if (!(await v2Discovery())) return { reason: 'v2 discovery unreachable' }; } catch { return { reason: 'v2 discovery unreachable' }; }
  const res = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | undefined)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${res.status} ${readErrorCode(res.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim() };
  return { runId };
}

describe('v2 stream-sse-projection (events.md §SSE frames)', () => {
  it('every data: frame on the major-2 stream carries the tenant-bound runId of the run it belongs to', async () => {
    const c = await createRun();
    if ('reason' in c) return softSkip('blocked', c.reason);
    expect(RUN_ID.test(c.runId), req(ID, 'spec/v2/core/identity.md §5', `the created runId MUST be tenant-bound before the stream can be held to it (got ${c.runId})`)).toBe(true);

    const s = await streamEvents(c.runId);
    if (s === null) return softSkip('blocked', 'GET /runs/{runId}/events (SSE, OpenWOP-Version: 2.0) unreachable (fetch failed)');
    if (s.status !== 200) return softSkip('blocked', `GET /runs/{runId}/events (SSE) answered ${s.status} for the run just created`);
    if (s.events.length === 0) return softSkip('blocked', 'the stream delivered no data: frames within the window — nothing to hold to the grammar');

    const validate = v2Validator('run-event');
    let i = 0;
    for (const ev of s.events) {
      i += 1;
      const rid = (ev as { runId?: unknown }).runId;
      expect(
        typeof rid === 'string' && RUN_ID.test(rid),
        req(ID, DOC, `frame ${i} (${String((ev as { type?: unknown }).type)}): data.runId MUST be tenant-bound <tenantId>/<opaque> (identity.md §5) — a stream frame is a rendering of the run event and every rendering of a v2 runId uses the same grammar; a bare storage id here is the projection seam missing the stream path (got ${JSON.stringify(rid)})`),
      ).toBe(true);
      expect(
        rid,
        req(ID, DOC, `frame ${i}: data.runId MUST be the run's own bound id — asserted on EVERY frame, not the first, because a batch flush that skips the per-frame projector projects frame 1 and not the rest`),
      ).toBe(c.runId);
      const r = validate(ev);
      expect(r.ok, req(ID, DOC, `frame ${i}: data MUST be a valid RunEventDoc (run-event.schema.json) — ${r.errors}`)).toBe(true);
    }
  });
});
