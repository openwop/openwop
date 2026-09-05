/**
 * `spec/v2/core/runs.md` §Cancel — `cancelRun` (suite 2.0.0, target major 2).
 *
 * Witness class: witnessable — the positive leg is gated on the
 * `conformance-cancellable` fixture (a run that stays `running` for `delayMs`);
 * the terminal-run leg is unaided.
 *
 * Legs:
 *   1. cancelling a run that is already terminal — `runs.md` §Cancel is SILENT
 *      on this case; the registry has `run_terminal` (409) and 200-idempotent is
 *      the other defensible answer. The leg accepts either, records which, and
 *      the ambiguity is filed for the prose (rc.48 CHANGELOG, finding 1).
 *   2. on `conformance-cancellable`: `POST /runs/{runId}/cancel` on a running
 *      run answers `200 { runId, status: cancelling | cancelled }`; `run.cancelled`
 *      is in the log within 5 s; the snapshot reads `cancelled`.
 *
 * Until rc.48 nothing at major 2 witnessed §Cancel at all — runs.md carried 61
 * MUSTs and 12 witness sites, every one under §Create.
 *
 * @see spec/v2/core/runs.md §Cancel
 * @see conformance/fixtures.md §conformance-cancellable
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0170.run-cancel';
const DOC = 'spec/v2/core/runs.md §Cancel';
const NOOP = 'conformance-noop';
const CANCELLABLE = 'conformance-cancellable';

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
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

describe('v2 run-cancel (runs.md §Cancel)', () => {
  it('cancelling a terminal run answers 409 run_terminal or 200 idempotently — the prose is silent, the leg records which', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const c = await create({ workflowId: NOOP });
    if ('reason' in c) return softSkip('blocked', c.reason);
    const s = await waitFor(c.runId, (x) => TERMINAL.has(x), 10_000);
    if (s === null || !TERMINAL.has(s)) return softSkip('blocked', `the noop run did not reach a terminal status within 10 s (last: ${s ?? 'unreadable'})`);
    const res = await http(() => driver.post(`/runs/${enc(c.runId)}/cancel`, {}));
    if (res === null) return softSkip('blocked', 'POST /runs/{runId}/cancel unreachable (fetch failed)');
    const code = readErrorCode(res.json);
    const status = (res.json as { status?: unknown } | null)?.status;
    const ok = (res.status === 409 && code === 'run_terminal') || (res.status === 200 && status === 'cancelled');
    expect(ok, req(ID, DOC, `cancel on a terminal (${s}) run MUST be 409 run_terminal or 200 { status: cancelled } — got ${res.status} ${code ?? String(status)}. §Cancel's 200 grammar is { runId, status: cancelling | cancelled }; a 200 echoing ${s} is outside it, so the only conforming refusal is 409 run_terminal (the prose does not say so in words — filed)`)).toBe(true);
  });

  it('cancelling a running run answers 200 with cancelling|cancelled, emits run.cancelled within 5 s, and the snapshot reads cancelled', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!isFixtureAdvertised(CANCELLABLE)) return softSkip('inapplicable', `${CANCELLABLE} fixture not advertised — no run stays running long enough to cancel`);
    const c = await create({ workflowId: CANCELLABLE, inputs: { delayMs: 15_000 } });
    if ('reason' in c) return softSkip('blocked', c.reason);
    const running = await waitFor(c.runId, (x) => x === 'running' || TERMINAL.has(x), 5_000);
    if (running !== 'running') return softSkip('blocked', `${CANCELLABLE} did not reach running within 5 s (last: ${running ?? 'unreadable'})`);
    const res = await http(() => driver.post(`/runs/${enc(c.runId)}/cancel`, { reason: 'conformance' }));
    if (res === null) return softSkip('blocked', 'POST /runs/{runId}/cancel unreachable (fetch failed)');
    expect(res.status, req(ID, DOC, `cancelRun on a running run MUST answer 200 — got ${res.status} ${readErrorCode(res.json) ?? ''}`.trim())).toBe(200);
    const body = res.json as { runId?: unknown; status?: unknown } | null;
    expect(body?.runId, req(ID, DOC, 'the 200 body MUST carry the run\'s runId')).toBe(c.runId);
    expect(['cancelling', 'cancelled'].includes(String(body?.status)), req(ID, DOC, `status MUST be cancelling or cancelled (got ${String(body?.status)})`)).toBe(true);
    const final = await waitFor(c.runId, (x) => x === 'cancelled', 5_000);
    expect(final, req(ID, DOC, `the snapshot MUST read cancelled within 5 s of an accepted cancel (last: ${final ?? 'unreadable'})`)).toBe('cancelled');
    const types = await eventTypes(c.runId);
    expect(types?.includes('run.cancelled') ?? false, req(ID, 'spec/v2/core/events.md §run.cancelled', `the log MUST carry run.cancelled once the cascade completes (types: ${(types ?? []).join(', ')})`)).toBe(true);
  }, 30_000);
});
