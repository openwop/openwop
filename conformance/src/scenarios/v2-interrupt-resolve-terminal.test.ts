/**
 * `spec/v2/core/errors.md` §"One code per state" — a resolve after the run
 * ended (RFC 0213 §C; suite 2.37.0, target major 2; unaided; two runs created).
 *
 * A run-scoped resolve against an interrupt whose run is cancelled or completed
 * MUST return `409 interrupt_already_resolved`; `interrupt_cancelled` is
 * registered but names no state of the core resolve surfaces, and a host MUST
 * NOT emit it. A resolve on an unknown run is `404 not_found`.
 *
 * Legs:
 *   1. suspend (`conformance-approval`) → cancel → resolve ⇒ 409
 *      interrupt_already_resolved (a 410 `interrupt_cancelled`, a vendor
 *      "gone" code, or a 200 that "resumes" a cancelled run all fail);
 *   2. suspend → resolve (accept) → completed → resolve again ⇒ the same 409;
 *   3. a resolve on an unknown own-tenant runId ⇒ 404 not_found.
 *
 * The signed-token surface is a SHOULD and needs a token the suite cannot mint;
 * its terminal outcome is the same row of `interrupt.md` and is not re-tested
 * here.
 *
 * @see spec/v2/core/errors.md §One code per state
 * @see spec/v2/core/interrupt.md §Resolve
 * @see RFCS/0213-three-unstated-v2-outcomes.md §C
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/errors.md §One code per state';
const ID_CANCELLED = 'openwop.requirement.0213.resolve-after-cancel';
const ID_COMPLETED = 'openwop.requirement.0213.resolve-after-complete';
const ID_UNKNOWN = 'openwop.requirement.0213.resolve-unknown-run';
const FIXTURE = 'conformance-approval';
const NODE_ID = 'gate';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);

async function statusOf(runId: string): Promise<string | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}`));
  return res?.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : null;
}
async function waitStatus(runId: string, wanted: ReadonlySet<string>, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await statusOf(runId);
    if (s !== null && wanted.has(s)) return s;
    if (Date.now() > deadline) return s;
    await new Promise((r) => setTimeout(r, 250));
  }
}
async function suspended(): Promise<{ runId: string } | { reason: string }> {
  const res = await http(() => driver.post('/runs', { workflowId: FIXTURE }));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | null)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs (${FIXTURE}) answered ${res.status} ${readErrorCode(res.json) ?? ''}`.trim() };
  const s = await waitStatus(runId, new Set(['waiting-approval', ...TERMINAL]), 10_000);
  if (s !== 'waiting-approval') return { reason: `the ${FIXTURE} run did not suspend on its approval gate (status ${String(s)})` };
  return { runId };
}
const resolve = (runId: string): Promise<OpenWOPResponse | null> => http(() => driver.post(`/runs/${enc(runId)}/interrupts/${enc(NODE_ID)}`, { resumeValue: { action: 'accept' } }));

describe('v2 interrupt-resolve-terminal (errors.md §One code per state, RFC 0213 §C)', () => {
  it('a run-scoped resolve after the run was cancelled is 409 interrupt_already_resolved', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const s = await suspended(); if ('reason' in s) return softSkip('blocked', s.reason);
    const cancel = await http(() => driver.post(`/runs/${enc(s.runId)}/cancel`, {}));
    if (cancel === null || cancel.status !== 200) return softSkip('blocked', `POST /runs/{runId}/cancel answered ${cancel?.status ?? 'nothing'} — cancelRun owns that contract`);
    const settled = await waitStatus(s.runId, new Set(['cancelled']), 10_000);
    if (settled !== 'cancelled') return softSkip('blocked', `the cancelled run did not reach cancelled within 10 s (status ${String(settled)})`);
    const res = await resolve(s.runId);
    if (res === null) return softSkip('blocked', 'the resolve was unreachable (fetch failed)');
    const code = readErrorCode(res.json);
    expect({ status: res.status, code }, req(ID_CANCELLED, DOC, `a resolve against a cancelled run MUST return 409 interrupt_already_resolved — never 410 interrupt_cancelled, a vendor code, or a 200 (got ${res.status} ${String(code)})`)).toEqual({ status: 409, code: 'interrupt_already_resolved' });
  }, 45_000);

  it('a second run-scoped resolve after the run completed is 409 interrupt_already_resolved', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const s = await suspended(); if ('reason' in s) return softSkip('blocked', s.reason);
    const first = await resolve(s.runId);
    if (first === null || first.status < 200 || first.status >= 300) return softSkip('blocked', `the first resolve answered ${first?.status ?? 'nothing'} ${readErrorCode(first?.json) ?? ''} — interrupt resolution owns that contract`);
    const settled = await waitStatus(s.runId, TERMINAL, 10_000);
    if (settled !== 'completed') return softSkip('blocked', `the accepted run did not complete within 10 s (status ${String(settled)})`);
    const res = await resolve(s.runId);
    if (res === null) return softSkip('blocked', 'the second resolve was unreachable (fetch failed)');
    const code = readErrorCode(res.json);
    expect({ status: res.status, code }, req(ID_COMPLETED, DOC, `a resolve against a completed run MUST return 409 interrupt_already_resolved (got ${res.status} ${String(code)})`)).toEqual({ status: 409, code: 'interrupt_already_resolved' });
  }, 45_000);

  it('a run-scoped resolve on an unknown run is 404 not_found', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const s = await suspended(); if ('reason' in s) return softSkip('blocked', s.reason);
    await http(() => driver.post(`/runs/${enc(s.runId)}/cancel`, {}));
    const slash = s.runId.indexOf('/');
    if (slash <= 0) return softSkip('blocked', `the created runId ${s.runId} carries no tenant segment — v2-id-grammar owns that contract`);
    const res = await resolve(`${s.runId.slice(0, slash)}/openwopconformanceunknown${Date.now().toString(36)}`);
    if (res === null) return softSkip('blocked', 'the resolve was unreachable (fetch failed)');
    const code = readErrorCode(res.json);
    expect({ status: res.status, code }, req(ID_UNKNOWN, 'spec/v2/core/interrupt.md §Resolve', `a resolve on an unknown run MUST be 404 not_found (got ${res.status} ${String(code)})`)).toEqual({ status: 404, code: 'not_found' });
  }, 45_000);
});
