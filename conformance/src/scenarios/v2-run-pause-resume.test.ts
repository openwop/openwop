/**
 * `spec/v2/core/runs.md` §Pause and resume (suite 2.0.0, target major 2).
 *
 * Legs:
 *   1. unaided: `:pause` and `:resume` on a terminal run MUST answer 409 with an
 *      error envelope. The prose names no code; only `run_terminal` is
 *      registered (finding 2). The leg asserts 409 + a code and names none. On
 *      its own this leg is one-sided — a host that answers 409 to everything
 *      passes it — so its recorded reason says so when leg 2 cannot run.
 *   2. on `conformance-delay`: pause → `202 { runId, status: paused }`; pause
 *      again → 409; resume → `202 { runId, status: running }`; the log carries
 *      `run.paused` then `run.resumed`. The run is cancelled at the end so
 *      nothing is left running.
 *
 * @see spec/v2/core/runs.md §Pause and resume
 * @see conformance/fixtures.md §conformance-delay
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0170.run-pause-resume';
const DOC = 'spec/v2/core/runs.md §Pause and resume';
const NOOP = 'conformance-noop';
const DELAY = 'conformance-delay';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);
async function create(body: Record<string, unknown>): Promise<{ runId: string } | { reason: string }> {
  const res = await http(() => driver.post('/runs', body));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | null)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs answered ${res.status} ${readErrorCode(res.json) ?? ''} — create refused`.trim() };
  return { runId };
}
async function statusOf(runId: string): Promise<string | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}`));
  return res?.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : null;
}
async function waitFor(runId: string, pred: (s: string) => boolean, ms: number): Promise<string | null> {
  const t0 = Date.now(); let last: string | null = null;
  while (Date.now() - t0 < ms) { last = await statusOf(runId); if (last !== null && pred(last)) return last; await new Promise((r) => setTimeout(r, 250)); }
  return last;
}
async function eventTypes(runId: string): Promise<string[] | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  const events = (res?.json as { events?: unknown } | null)?.events;
  return res?.status === 200 && Array.isArray(events) ? events.map((e) => String((e as { type?: unknown }).type)) : null;
}

describe('v2 run-pause-resume (runs.md §Pause and resume)', () => {
  it('pause and resume on a terminal run answer 409 with an error envelope', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const c = await create({ workflowId: NOOP });
    if ('reason' in c) return softSkip('blocked', c.reason);
    const s = await waitFor(c.runId, (x) => TERMINAL.has(x), 10_000);
    if (s === null || !TERMINAL.has(s)) return softSkip('blocked', `the noop run did not reach a terminal status within 10 s (last: ${s ?? 'unreadable'})`);
    const pause = await http(() => driver.post(`/runs/${enc(c.runId)}:pause`, {}));
    if (pause === null) return softSkip('blocked', 'POST /runs/{runId}:pause unreachable (fetch failed)');
    if (pause.status === 404) return softSkip('blocked', 'POST /runs/{runId}:pause answered 404 — pauseRun is a core operation (runs.md §Surface) and is not mounted');
    expect(pause.status, req(ID, DOC, `pause on a terminal (${s}) run MUST answer 409 — got ${pause.status} ${readErrorCode(pause.json) ?? ''}`.trim())).toBe(409);
    expect(readErrorCode(pause.json), req(ID, DOC, `a pause refused because the run is terminal MUST carry run_terminal (got ${String(readErrorCode(pause.json))})`)).toBe('run_terminal');
    const resume = await http(() => driver.post(`/runs/${enc(c.runId)}:resume`, {}));
    if (resume === null) return softSkip('blocked', 'POST /runs/{runId}:resume unreachable (fetch failed)');
    expect(resume.status, req(ID, DOC, `resume on a run that is not paused MUST answer 409 — got ${resume.status} ${readErrorCode(resume.json) ?? ''}`.trim())).toBe(409);
    expect(readErrorCode(resume.json), req(ID, DOC, `a resume refused because the run is terminal MUST carry run_terminal (got ${String(readErrorCode(resume.json))})`)).toBe('run_terminal');
    if (!isFixtureAdvertised(DELAY)) return softSkip('inapplicable', `${DELAY} fixture not advertised — the positive pause/resume leg cannot run, so the two 409s above are witnessed without their control (a host answering 409 to everything would pass them)`);
  });

  it('a running run pauses (202 paused), refuses a second pause (409), resumes (202 running), and the log carries run.paused then run.resumed', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!isFixtureAdvertised(DELAY)) return softSkip('inapplicable', `${DELAY} fixture not advertised — no run stays running long enough to pause`);
    const c = await create({ workflowId: DELAY, inputs: { delayMs: 15_000 } });
    if ('reason' in c) return softSkip('blocked', c.reason);
    const running = await waitFor(c.runId, (x) => x === 'running' || TERMINAL.has(x), 5_000);
    if (running !== 'running') return softSkip('blocked', `${DELAY} did not reach running within 5 s (last: ${running ?? 'unreadable'})`);
    try {
      const pause = await http(() => driver.post(`/runs/${enc(c.runId)}:pause`, { reason: 'conformance', drainPolicy: 'immediate' }));
      if (pause === null) return softSkip('blocked', 'POST /runs/{runId}:pause unreachable (fetch failed)');
      if (pause.status === 404) return softSkip('blocked', 'POST /runs/{runId}:pause answered 404 — not mounted');
      expect(pause.status, req(ID, DOC, `pauseRun on a running run MUST answer 202 — got ${pause.status} ${readErrorCode(pause.json) ?? ''}`.trim())).toBe(202);
      const pb = pause.json as { runId?: unknown; status?: unknown } | null;
      expect(pb?.runId, req(ID, DOC, 'the 202 MUST carry the runId')).toBe(c.runId);
      expect(pb?.status, req(ID, DOC, `the 202 MUST carry status paused (got ${String(pb?.status)})`)).toBe('paused');
      const again = await http(() => driver.post(`/runs/${enc(c.runId)}:pause`, {}));
      expect(again?.status ?? null, req(ID, DOC, `a second pause on a paused run MUST answer 409 — got ${again?.status ?? 'no response'}`)).toBe(409);
      expect(readErrorCode(again?.json), req(ID, DOC, `a pause refused on a non-terminal run MUST carry run_state_conflict (got ${String(readErrorCode(again?.json))})`)).toBe('run_state_conflict');
      const runStatus = (again?.json as { error?: { details?: { runStatus?: unknown } } } | null)?.error?.details?.runStatus;
      expect(runStatus, req(ID, DOC, `run_state_conflict MUST carry details.runStatus naming the status that refused it (got ${String(runStatus)})`)).toBe('paused');
      const resume = await http(() => driver.post(`/runs/${enc(c.runId)}:resume`, { reason: 'conformance' }));
      expect(resume?.status ?? null, req(ID, DOC, `resumeRun on a paused run MUST answer 202 — got ${resume?.status ?? 'no response'} ${readErrorCode(resume?.json) ?? ''}`.trim())).toBe(202);
      const rb = resume?.json as { runId?: unknown; status?: unknown } | null;
      expect(rb?.status, req(ID, DOC, `the 202 MUST carry status running (got ${String(rb?.status)})`)).toBe('running');
      const types = await eventTypes(c.runId);
      const p = types?.indexOf('run.paused') ?? -1; const r = types?.indexOf('run.resumed') ?? -1;
      expect(p >= 0 && r > p, req(ID, 'spec/v2/core/events.md §run.paused', `the log MUST carry run.paused then run.resumed (types: ${(types ?? []).join(', ')})`)).toBe(true);
    } finally {
      await http(() => driver.post(`/runs/${enc(c.runId)}/cancel`, { reason: 'conformance cleanup' }));
    }
  }, 30_000);
});
