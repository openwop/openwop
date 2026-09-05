/**
 * `spec/v2/core/runs.md` §Diff and ancestry — `diffRun` is a pure function of
 * the two logs (suite 2.0.0, target major 2; unaided; two runs created, a third
 * when `conformance-failure` is advertised).
 *
 * Identical logs MUST yield `divergedAtSeq: null` and empty `eventDiffs`;
 * `eventId`, `runId`, `timestamp` and other run-scoped fields MUST be excluded
 * from the comparison — so two `conformance-noop` runs ARE identical logs.
 * `diffRun` is OPTIONAL (`404` when absent → inapplicable).
 *
 * Controls: the response MUST validate against
 * `schemas/v2/run-diff-response.schema.json` and echo both ids in `a` / `b`
 * (a host answering `{}` to any pair fails there); and, when
 * `conformance-failure` is advertised, a noop-vs-failure diff MUST diverge.
 * Without that fixture the divergence control records `inapplicable`.
 *
 * @see spec/v2/core/runs.md §Diff and ancestry
 * @see schemas/v2/run-diff-response.schema.json
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0170.run-diff-identical';
const DOC = 'spec/v2/core/runs.md §Diff and ancestry';
const NOOP = 'conformance-noop';
const FAILURE = 'conformance-failure';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);
async function createSettled(workflowId: string): Promise<{ runId: string } | { reason: string }> {
  const res = await http(() => driver.post('/runs', { workflowId }));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | null)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${workflowId}} answered ${res.status} ${readErrorCode(res.json) ?? ''}`.trim() };
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    const s = await http(() => driver.get(`/runs/${enc(runId)}`));
    if (s?.status === 200 && TERMINAL.has(String((s.json as { status?: unknown }).status))) return { runId };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { reason: `${workflowId} run ${runId} did not settle within 10 s` };
}
interface Diff { a?: unknown; b?: unknown; divergedAtSeq?: unknown; eventDiffs?: unknown }

describe('v2 run-diff-identical (runs.md §Diff and ancestry)', () => {
  it('two identical logs diff to divergedAtSeq null and empty eventDiffs, in a response that validates and echoes both ids', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const a = await createSettled(NOOP); if ('reason' in a) return softSkip('blocked', a.reason);
    const b = await createSettled(NOOP); if ('reason' in b) return softSkip('blocked', b.reason);
    const res = await http(() => driver.get(`/runs/${enc(a.runId)}:diff?against=${enc(b.runId)}`));
    if (res === null) return softSkip('blocked', 'GET /runs/{runId}:diff unreachable (fetch failed)');
    if (res.status === 404) return softSkip('inapplicable', 'diffRun is OPTIONAL and answered 404 (runs.md §Surface)');
    expect(res.status, req(ID, DOC, `diffRun MUST answer 200 — got ${res.status} ${readErrorCode(res.json) ?? ''}`.trim())).toBe(200);
    const check = v2Validator('run-diff-response')(res.json);
    expect(check.ok, req(ID, 'schemas/v2/run-diff-response.schema.json', `the response MUST validate: ${check.errors}`)).toBe(true);
    const d = res.json as Diff;
    expect([d.a, d.b], req(ID, DOC, 'the response MUST name the two runs it compared')).toEqual([a.runId, b.runId]);
    expect(d.divergedAtSeq, req(ID, DOC, `identical logs MUST yield divergedAtSeq: null (got ${String(d.divergedAtSeq)}) — eventId, runId, timestamp and other run-scoped fields MUST be excluded from the comparison`)).toBeNull();
    expect(d.eventDiffs, req(ID, DOC, 'identical logs MUST yield empty eventDiffs')).toEqual([]);
    if (!isFixtureAdvertised(FAILURE)) return softSkip('inapplicable', `${FAILURE} fixture not advertised — the divergence control (a noop-vs-failure diff MUST diverge) cannot run`);
    const f = await createSettled(FAILURE); if ('reason' in f) return softSkip('blocked', f.reason);
    const dv = await http(() => driver.get(`/runs/${enc(a.runId)}:diff?against=${enc(f.runId)}`));
    if (dv === null || dv.status !== 200) return softSkip('blocked', `the divergence control diff answered ${dv?.status ?? 'no response'}`);
    const x = dv.json as Diff;
    expect(typeof x.divergedAtSeq === 'number' && Array.isArray(x.eventDiffs) && x.eventDiffs.length > 0, req(ID, DOC, `a noop log and a failure log MUST diverge (divergedAtSeq ${String(x.divergedAtSeq)}, ${Array.isArray(x.eventDiffs) ? x.eventDiffs.length : 0} diff(s)) — the identical-logs pass above is only evidence if a different pair does not also read identical`)).toBe(true);
  }, 45_000);
});
