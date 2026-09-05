/**
 * `spec/v2/core/runs.md` §Fork — the refusals and the copied owner (suite
 * 2.0.0, target major 2; gated on `replay`; one run created plus one fork).
 *
 * A `replay` fork with a non-empty `runOptionsOverlay` MUST be rejected 400
 * (the overlay is `branch`-only); a `fromSeq` not in the source log MUST be
 * rejected `422 fork_point_invalid`; a valid `replay` fork answers `201 {
 * runId, sourceRunId, mode, status, eventsUrl }` and the child's `owner` is
 * copied verbatim from the parent (RFC 0170 §A.4). The 201 is the control for
 * the two refusals. Determinism and side-effect suppression are replay.md's
 * and witnessed there.
 *
 * @see spec/v2/core/runs.md §Fork
 * @see RFCS/0170 §A.4
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0170.run-fork-refusals';
const DOC = 'spec/v2/core/runs.md §Fork';
const NOOP = 'conformance-noop';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);
async function snapshot(runId: string): Promise<Record<string, unknown> | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}`));
  return res?.status === 200 && res.json && typeof res.json === 'object' ? (res.json as Record<string, unknown>) : null;
}

describe('v2 run-fork-refusals (runs.md §Fork)', () => {
  it('replay+overlay → 400; a fromSeq outside the log → 422 fork_point_invalid; a valid replay fork → 201 with the parent\'s owner verbatim', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('replay'))) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay) — forkRun is gated on replay (runs.md §Surface)');
    const created = await http(() => driver.post('/runs', { workflowId: NOOP }));
    if (created === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    const runId = (created.json as { runId?: unknown } | null)?.runId;
    if (created.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs answered ${created.status} ${readErrorCode(created.json) ?? ''}`.trim());
    const t0 = Date.now(); let parent: Record<string, unknown> | null = null;
    while (Date.now() - t0 < 10_000) { parent = await snapshot(runId); if (parent && TERMINAL.has(String(parent['status']))) break; await new Promise((r) => setTimeout(r, 250)); }
    if (!parent || !TERMINAL.has(String(parent['status']))) return softSkip('blocked', 'the noop run did not settle within 10 s');

    const overlay = await http(() => driver.post(`/runs/${enc(runId)}:fork`, { mode: 'replay', runOptionsOverlay: { tags: ['conformance'] } }));
    if (overlay === null) return softSkip('blocked', 'POST /runs/{runId}:fork unreachable (fetch failed)');
    if (overlay.status === 404) return softSkip('blocked', 'POST /runs/{runId}:fork answered 404 with replay advertised — forkRun is not mounted');
    expect(overlay.status, req(ID, DOC, `a replay fork with a non-empty runOptionsOverlay MUST be rejected 400 (the overlay is branch-only) — got ${overlay.status} ${readErrorCode(overlay.json) ?? ''}`.trim())).toBe(400);

    const bad = await http(() => driver.post(`/runs/${enc(runId)}:fork`, { mode: 'branch', fromSeq: 999_999 }));
    if (bad === null) return softSkip('blocked', 'POST /runs/{runId}:fork unreachable (fetch failed)');
    expect(bad.status, req(ID, DOC, `a fromSeq not in the source log MUST be rejected 422 — got ${bad.status} ${readErrorCode(bad.json) ?? ''}`.trim())).toBe(422);
    expect(readErrorCode(bad.json), req(ID, DOC, 'the refusal MUST be fork_point_invalid')).toBe('fork_point_invalid');

    const ok = await http(() => driver.post(`/runs/${enc(runId)}:fork`, { mode: 'replay' }));
    if (ok === null) return softSkip('blocked', 'POST /runs/{runId}:fork unreachable (fetch failed)');
    expect(ok.status, req(ID, DOC, `a valid replay fork MUST answer 201 — got ${ok.status} ${readErrorCode(ok.json) ?? ''} (the control for the two refusals above)`.trim())).toBe(201);
    const body = ok.json as { runId?: unknown; sourceRunId?: unknown; mode?: unknown; eventsUrl?: unknown } | null;
    expect(body?.sourceRunId, req(ID, DOC, 'the 201 MUST name the parent as sourceRunId')).toBe(runId);
    expect(body?.mode, req(ID, DOC, 'the 201 MUST echo the mode')).toBe('replay');
    expect(typeof body?.runId === 'string' && typeof body?.eventsUrl === 'string', req(ID, DOC, 'the 201 MUST carry runId and eventsUrl')).toBe(true);
    const child = await snapshot(String(body?.runId));
    if (!child) return softSkip('blocked', 'the child snapshot could not be read');
    expect(child['owner'], req(ID, 'RFCS/0170 §A.4', 'the child\'s owner MUST be copied verbatim from the parent')).toEqual(parent['owner']);
  }, 30_000);
});
