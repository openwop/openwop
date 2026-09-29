/**
 * RFC 0223 — a rejected approval gate fails closed, and the failure is
 * routable (`spec/v2/core/interrupt.md` §Rejection; suite 2.43.0, target
 * major 2; gated on the `interrupt` family).
 *
 * Legs:
 *   1. `conformance-approval` (one gate, no edges) resolved `reject` ⇒ the run
 *      terminates `failed`, and both the snapshot `error.code` and
 *      `run.failed.error.code` are `approval_rejected`;
 *   2. the same run's `interrupt.resolved` records `action: "reject"` and
 *      `decision: "rejected"` (the `action` half is interrupt.md §Events, RFC
 *      0183; RFC 0223 names both for a reject);
 *   3. the gate's `node.failed` carries `approval_rejected` with
 *      `retryable: false`, and `run.failed.failedNodeId` names the gate;
 *   4. `conformance-interrupt-quorum` (requiredApprovals 3, `majority`): one
 *      reject leaves the run `waiting-approval`; a second decides the gate and
 *      the run terminates `failed` with `approval_rejected`;
 *   5. `conformance-approval-reject-routed` (gap G1, suite 2.43.1): rejected, the
 *      gate fails with `approval_rejected` / `retryable: false`, its
 *      `any_failed` target runs, its `all_success` target never runs, and the
 *      run completes;
 *   6. `conformance-approval-timeout` (gap G2, suite 2.43.1): left unresolved
 *      past its 1500 ms `timeoutMs` with no `onTimeout`, the host resolves the
 *      gate itself (`action: timeout`, `decision: rejected`, `reason: timeout`),
 *      the gate fails with `approval_rejected` and `run.failed` names it;
 *   7. `conformance-approval-timeout-approve` (openwop#1696, suite 2.43.1): the
 *      same gate with `onTimeout: "approve"` still resolves rejected — a
 *      timeout never grants — and the run fails, never completes;
 *   8. `conformance-approval-reject-loopback` (openwop#1697, suite 2.43.1): a
 *      rejected gate routed back to itself through `revise` is asked again —
 *      a second `interrupt.requested` with a different `key`, the run back in
 *      `waiting-approval`, and no second `interrupt.resolved` (the first
 *      rejection is not replayed). `inapplicable` on a host that does not
 *      advertise the fixture, i.e. one that does not run cycles.
 *
 *   9. `openwop.requirement.0223.replay-derives-rejection` (openwop#1756, suite
 *      2.44.4; gated on `replay` advertising mode `replay` and on each leg's
 *      fixture): a `replay` fork taken at the gate's recorded `interrupt.resolved` (the
 *      prefix holds its request and suspension) derives
 *      the rejection from the recorded `interrupt.resolved` and never
 *      re-decides it. The fork raises no new `interrupt.requested` for the
 *      gate (the discriminator: a re-deciding host re-raises and waits), records
 *      an `interrupt.resolved` whose `decision` / `action` / `reason` equal the
 *      source's, fails the same way (`approval_rejected`, `failedNodeId`, a
 *      non-retryable `node.failed`), and answers a resolve with `409
 *      interrupt_already_resolved`. Leg A replays a decided reject
 *      (`conformance-approval`); leg B replays a timeout
 *      (`conformance-approval-timeout-approve`), whose `resolvedBy` must match the source's (a host subject or absent).
 *      `interruptId` equality is not asserted: a host may re-mint ids.
 *
 * The legs are separate rows so a host that misses one field fails that row
 * only. Legs 5 and 6 each need their own fixture, because `conformance-approval`
 * has no edges and no timer and widening a fixture every host serves would force
 * a re-registration (fixtures.md §conformance-approval-refine); a host that
 * does not advertise one records `inapplicable`. Leg 5 does not require
 * `node.skipped`: interrupt.md says the `all_success` edge is not satisfied, not
 * how a host records that, so the leg asserts only that the target never ran.
 *
 * The quorum leg presents distinct votes on one bearer through the resume
 * value's `voter` member, as `interrupt-quorum-resolution` does at major 1. A
 * host that counts both votes as one principal cannot be driven to a majority
 * this way; that records `blocked`, not a failure.
 *
 * @see spec/v2/core/interrupt.md §Rejection
 * @see spec/v2/errors.json approval_rejected
 * @see RFCS/0223-approval-reject-disposition.md
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { gateFamily } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { scaledTimeoutMs } from '../lib/polling.js';

const DOC = 'spec/v2/core/interrupt.md §Rejection (RFC 0223)';
const R = (slug: string): string => `openwop.requirement.0223.${slug}`;
const FIXTURE = 'conformance-approval';
const QUORUM = 'conformance-interrupt-quorum';
const ROUTED = 'conformance-approval-reject-routed';
const TIMEOUT = 'conformance-approval-timeout';
const TIMEOUT_APPROVE = 'conformance-approval-timeout-approve';
const LOOPBACK = 'conformance-approval-reject-loopback';
const NODE_ID = 'gate';
const CODE = 'approval_rejected';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface Ev { type?: string; nodeId?: string; payload?: Record<string, unknown> }

const enc = (id: string): string => encodeURIComponent(id);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }

async function snapshot(runId: string): Promise<Record<string, unknown> | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}`));
  return res?.status === 200 && res.json && typeof res.json === 'object' ? (res.json as Record<string, unknown>) : null;
}
async function waitStatus(runId: string, wanted: ReadonlySet<string>, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await snapshot(runId);
    if (s !== null && wanted.has(String(s['status']))) return s;
    if (Date.now() > deadline) return s;
    await new Promise((r) => setTimeout(r, 250));
  }
}
async function events(runId: string): Promise<Ev[]> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  return ((res?.json as { events?: Ev[] } | null)?.events ?? []);
}
const errorCode = (o: unknown): string | undefined => (o as { code?: unknown } | null | undefined)?.code as string | undefined;
const resolve = (runId: string, resumeValue: unknown): Promise<OpenWOPResponse | null> => http(() => driver.post(`/runs/${enc(runId)}/interrupts/${enc(NODE_ID)}`, { resumeValue }));

/** Create a run of `fixture` and wait for it to suspend on its gate. */
async function suspended(fixture: string, extra: Record<string, unknown> = {}): Promise<{ runId: string } | { reason: string }> {
  const res = await http(() => driver.post('/runs', { workflowId: fixture, ...extra }));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | null)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs (${fixture}) answered ${res.status} ${readErrorCode(res.json) ?? ''}`.trim() };
  const s = await waitStatus(runId, new Set(['waiting-approval', ...TERMINAL]), 10_000);
  if (s?.['status'] !== 'waiting-approval') return { reason: `the ${fixture} run did not suspend on its approval gate (status ${String(s?.['status'])})` };
  return { runId };
}

/** One rejected `conformance-approval` run per file: legs 1–3 read the same run. */
let rejected: Promise<{ runId: string; terminal: Record<string, unknown> | null; evs: Ev[] } | { reason: string }> | undefined;
function rejectedRun(): Promise<{ runId: string; terminal: Record<string, unknown> | null; evs: Ev[] } | { reason: string }> {
  rejected ??= (async () => {
    const s = await suspended(FIXTURE);
    if ('reason' in s) return s;
    const res = await resolve(s.runId, { action: 'reject' });
    if (res === null || res.status < 200 || res.status >= 300) return { reason: `the reject resolve answered ${res?.status ?? 'nothing'} ${readErrorCode(res?.json) ?? ''} — interrupt resolution owns that contract` };
    const terminal = await waitStatus(s.runId, TERMINAL, 10_000);
    return { runId: s.runId, terminal, evs: await events(s.runId) };
  })();
  return rejected;
}

describe('RFC 0223 — v2-approval-reject-disposition (gated on interrupt + conformance-approval)', () => {
  it('a rejected gate with no routing edge fails the run with approval_rejected', async () => {
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    const r = await rejectedRun();
    if ('reason' in r) return softSkip('blocked', r.reason);
    const id = R('reject-fails-run');
    expect(r.terminal?.['status'], req(id, DOC, `with no edge admitting a failed source the run MUST terminate failed (got ${String(r.terminal?.['status'])})`)).toBe('failed');
    expect(errorCode(r.terminal?.['error']), req(id, `${DOC}; runs.md §Snapshot`, 'the terminal snapshot error.code MUST be approval_rejected')).toBe(CODE);
    const failed = r.evs.find((e) => e.type === 'run.failed');
    expect(errorCode(failed?.payload?.['error']), req(id, DOC, 'run.failed.error.code MUST be approval_rejected')).toBe(CODE);
  }, 45_000);

  it('interrupt.resolved records action reject and decision rejected', async () => {
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    const r = await rejectedRun();
    if ('reason' in r) return softSkip('blocked', r.reason);
    const id = R('reject-recorded');
    const resolved = r.evs.find((e) => e.type === 'interrupt.resolved');
    expect(resolved, req(id, `${DOC}; interrupt.md §Events`, 'the reject MUST be recorded as interrupt.resolved')).toBeDefined();
    expect(
      { action: resolved?.payload?.['action'], decision: resolved?.payload?.['decision'] },
      req(id, `${DOC}; interrupt.md §Events (RFC 0183)`, 'interrupt.resolved MUST carry action "reject" and decision "rejected"'),
    ).toEqual({ action: 'reject', decision: 'rejected' });
  }, 45_000);

  it('the gate node fails with approval_rejected, not retryable, and run.failed names it', async () => {
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    const r = await rejectedRun();
    if ('reason' in r) return softSkip('blocked', r.reason);
    const id = R('reject-fails-node');
    const nodeFailed = r.evs.find((e) => e.type === 'node.failed' && (e.payload?.['nodeId'] ?? e.nodeId) === NODE_ID);
    expect(nodeFailed, req(id, DOC, 'the gate that does not turn the rejection into an output MUST emit node.failed')).toBeDefined();
    const err = nodeFailed?.payload?.['error'] as { code?: unknown; retryable?: unknown } | undefined;
    expect({ code: err?.code, retryable: err?.retryable }, req(id, DOC, 'node.failed.error MUST carry code approval_rejected and retryable false')).toEqual({ code: CODE, retryable: false });
    const runFailed = r.evs.find((e) => e.type === 'run.failed');
    expect(runFailed?.payload?.['failedNodeId'], req(id, DOC, 'run.failed.failedNodeId MUST name the gate')).toBe(NODE_ID);
  }, 45_000);

  it('a majority reject decides the quorum gate on the deciding vote and fails the run with approval_rejected', async () => {
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    if (!isFixtureAdvertised(QUORUM)) return softSkip('inapplicable', `fixture ${QUORUM} is not advertised — the host does not claim the quorum fixture`);
    const s = await suspended(QUORUM);
    if ('reason' in s) return softSkip('blocked', s.reason);
    const id = R('quorum-reject-fails-run');
    const first = await resolve(s.runId, { action: 'reject', voter: 'approver-1' });
    if (first === null || first.status < 200 || first.status >= 300) return softSkip('blocked', `the first reject vote answered ${first?.status ?? 'nothing'} ${readErrorCode(first?.json) ?? ''}`);
    const between = (await snapshot(s.runId))?.['status'];
    const resolvedEarly = (await events(s.runId)).some((e) => e.type === 'interrupt.resolved');
    const second = await resolve(s.runId, { action: 'reject', voter: 'approver-2' });
    if (second === null || second.status < 200 || second.status >= 300) return softSkip('blocked', `the second reject vote answered ${second?.status ?? 'nothing'} ${readErrorCode(second?.json) ?? ''}`);
    const terminal = await waitStatus(s.runId, TERMINAL, 10_000);
    if (between === 'waiting-approval' && terminal?.['status'] === 'waiting-approval') {
      await http(() => driver.post(`/runs/${enc(s.runId)}/cancel`, {}));
      return softSkip('blocked', 'the host counted both votes as one approver (one bearer; the resume value\'s voter was not honoured), so a majority could not be caused');
    }
    expect(between, req(id, DOC, 'one reject of three under majority does not decide the gate: the run MUST stay waiting-approval')).toBe('waiting-approval');
    expect(resolvedEarly, req(id, DOC, 'a vote that does not decide the gate MUST NOT emit interrupt.resolved')).toBe(false);
    expect(terminal?.['status'], req(id, DOC, `two rejects of three under majority MUST resolve the gate rejected and fail the run (got ${String(terminal?.['status'])})`)).toBe('failed');
    expect(errorCode(terminal?.['error']), req(id, DOC, 'the terminal snapshot error.code MUST be approval_rejected')).toBe(CODE);
  }, 60_000);

  it('a rejected gate routed over an any_failed edge fails as a node, its all_success sibling never runs, and the run completes', async () => {
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    if (!isFixtureAdvertised(ROUTED)) return softSkip('inapplicable', `fixture ${ROUTED} is not advertised — the host does not claim the routed-reject fixture`);
    const s = await suspended(ROUTED);
    if ('reason' in s) return softSkip('blocked', s.reason);
    const res = await resolve(s.runId, { action: 'reject' });
    if (res === null || res.status < 200 || res.status >= 300) return softSkip('blocked', `the reject resolve answered ${res?.status ?? 'nothing'} ${readErrorCode(res?.json) ?? ''} — interrupt resolution owns that contract`);
    const id = R('reject-routed');
    const terminal = await waitStatus(s.runId, TERMINAL, 10_000);
    const evs = await events(s.runId);
    const ran = (nodeId: string, type: string): boolean => evs.some((e) => e.type === type && (e.payload?.['nodeId'] ?? e.nodeId) === nodeId);
    const gateFailed = evs.find((e) => e.type === 'node.failed' && (e.payload?.['nodeId'] ?? e.nodeId) === NODE_ID);
    const err = gateFailed?.payload?.['error'] as { code?: unknown; retryable?: unknown } | undefined;
    expect({ code: err?.code, retryable: err?.retryable }, req(id, DOC, 'the routed gate still fails as a node: node.failed.error MUST carry approval_rejected and retryable false')).toEqual({ code: CODE, retryable: false });
    expect(ran('on-reject', 'node.completed'), req(id, DOC, 'the any_failed edge admits the failed gate: on-reject MUST run to node.completed')).toBe(true);
    expect(ran('on-accept', 'node.started') || ran('on-accept', 'node.completed'), req(id, DOC, 'a rejected gate MUST NOT satisfy an all_success edge: on-accept MUST NOT run')).toBe(false);
    expect(terminal?.['status'], req(id, DOC, `a routed rejection does not fail the run: it MUST complete (got ${String(terminal?.['status'])})`)).toBe('completed');
  }, 45_000);

  it('an unresolved gate past its timeoutMs with no onTimeout is resolved rejected by the host and fails the run naming the gate', async () => {
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    if (!isFixtureAdvertised(TIMEOUT)) return softSkip('inapplicable', `fixture ${TIMEOUT} is not advertised — the host does not claim the timeout fixture`);
    const s = await suspended(TIMEOUT);
    if ('reason' in s) return softSkip('blocked', s.reason);
    const id = R('timeout-rejects');
    const terminal = await waitStatus(s.runId, TERMINAL, scaledTimeoutMs(20_000));
    const evs = await events(s.runId);
    const resolved = evs.find((e) => e.type === 'interrupt.resolved');
    expect(
      { action: resolved?.payload?.['action'], decision: resolved?.payload?.['decision'], reason: resolved?.payload?.['reason'] },
      req(id, DOC, 'the host MUST resolve the timed-out gate itself, recording action "timeout", decision "rejected" and reason "timeout"'),
    ).toEqual({ action: 'timeout', decision: 'rejected', reason: 'timeout' });
    const gateFailed = evs.find((e) => e.type === 'node.failed' && (e.payload?.['nodeId'] ?? e.nodeId) === NODE_ID);
    expect(errorCode(gateFailed?.payload?.['error']), req(id, DOC, 'the timed-out gate MUST fail with approval_rejected')).toBe(CODE);
    const runFailed = evs.find((e) => e.type === 'run.failed');
    expect({ status: terminal?.['status'], code: errorCode(runFailed?.payload?.['error']), failedNodeId: runFailed?.payload?.['failedNodeId'] }, req(id, DOC, 'with no routing edge the run MUST terminate failed, run.failed carrying approval_rejected and failedNodeId naming the gate')).toEqual({ status: 'failed', code: CODE, failedNodeId: NODE_ID });
  }, 60_000);

  it('a gate whose onTimeout is approve still resolves rejected on timeout and fails the run: a timeout never grants', async () => {
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    if (!isFixtureAdvertised(TIMEOUT_APPROVE)) return softSkip('inapplicable', `fixture ${TIMEOUT_APPROVE} is not advertised — the host does not claim the timeout-approve fixture`);
    const s = await suspended(TIMEOUT_APPROVE);
    if ('reason' in s) return softSkip('blocked', s.reason);
    const id = R('timeout-never-grants');
    const terminal = await waitStatus(s.runId, TERMINAL, scaledTimeoutMs(20_000));
    const evs = await events(s.runId);
    const resolved = evs.find((e) => e.type === 'interrupt.resolved');
    expect(
      { action: resolved?.payload?.['action'], decision: resolved?.payload?.['decision'] },
      req(id, DOC, 'whatever onTimeout holds, the host MUST resolve the timed-out gate rejected (action "timeout", decision "rejected") — onTimeout "approve" is treated as reject'),
    ).toEqual({ action: 'timeout', decision: 'rejected' });
    const gateFailed = evs.find((e) => e.type === 'node.failed' && (e.payload?.['nodeId'] ?? e.nodeId) === NODE_ID);
    expect(errorCode(gateFailed?.payload?.['error']), req(id, DOC, 'the timed-out gate MUST fail with approval_rejected')).toBe(CODE);
    expect(terminal?.['status'], req(id, DOC, `a timeout MUST NOT grant a gate: with no routing edge the run MUST terminate failed, never completed (got ${String(terminal?.['status'])})`)).toBe('failed');
  }, 60_000);

  it('a rejected gate looped back to itself is asked again under a new key, and the first rejection is not replayed', async () => {
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    if (!isFixtureAdvertised(LOOPBACK)) return softSkip('inapplicable', `fixture ${LOOPBACK} is not advertised — the host does not run cycles`);
    // The loop is bounded by the scenario (one reject), not by the host; recursionLimit is a runaway guard (openwop#1748).
    const s = await suspended(LOOPBACK, { configurable: { version: 1, run: { recursionLimit: 20 } } });
    if ('reason' in s) return softSkip('blocked', s.reason);
    const res = await resolve(s.runId, { action: 'reject' });
    if (res === null || res.status < 200 || res.status >= 300) return softSkip('blocked', `the reject resolve answered ${res?.status ?? 'nothing'} ${readErrorCode(res?.json) ?? ''} — interrupt resolution owns that contract`);
    const id = R('reject-loopback-reasks');
    const gateRequests = (evs: Ev[]): Ev[] => evs.filter((e) => e.type === 'interrupt.requested' && (e.nodeId ?? e.payload?.['nodeId']) === NODE_ID);
    const deadline = Date.now() + scaledTimeoutMs(10_000);
    let evs = await events(s.runId);
    while (gateRequests(evs).length < 2 && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 250)); evs = await events(s.runId); }
    const snap = await snapshot(s.runId);
    const [first, second] = gateRequests(evs);
    expect(second, req(id, 'spec/v2/core/interrupt.md §Re-entry and resume values', 'the second visit of the gate MUST raise a new interrupt.requested')).toBeDefined();
    expect(second?.payload?.['key'] !== undefined && second?.payload?.['key'] !== first?.payload?.['key'], req(id, 'spec/v2/core/interrupt.md §Re-entry and resume values', `a later execution of the node MUST derive a different key (got ${String(first?.payload?.['key'])} then ${String(second?.payload?.['key'])})`)).toBe(true);
    expect(snap?.['status'], req(id, 'spec/v2/core/interrupt.md §Re-entry and resume values', 'the second visit MUST wait for a new decision: the run is waiting-approval again')).toBe('waiting-approval');
    expect(evs.filter((e) => e.type === 'interrupt.resolved').length, req(id, 'spec/v2/core/interrupt.md §Re-entry and resume values', 'an earlier visit\'s resumeValue MUST NOT be returned: only the one caller resolve is recorded')).toBe(1);
    await http(() => driver.post(`/runs/${enc(s.runId)}/cancel`, {}));
  }, 45_000);

  // ── openwop#1756: replay derives the rejection, never re-decides it ──────────
  const REPLAY_ID = R('replay-derives-rejection');
  const REPLAY_DOC = `${DOC}, last bullet; spec/v2/core/replay.md §Determinism caveats rule 2 (short-circuit, raising no new interrupt.requested)`;
  interface SeqEv extends Ev { readonly sequence?: number }
  async function debugLog(runId: string): Promise<SeqEv[]> {
    const res = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1&streamMode=debug`));
    const evs = ((res?.json as { events?: SeqEv[] } | null)?.events ?? []).filter((e) => typeof e.sequence === 'number');
    return evs.sort((a, b) => (a.sequence as number) - (b.sequence as number));
  }
  const onGate = (e: SeqEv): boolean => (e.payload?.['nodeId'] ?? e.nodeId) === NODE_ID;
  async function replayGate(): Promise<string | null> {
    const fam = await gateFamily('replay');
    if (!fam) return 'replay family not advertised (gate recorded under openwop.family.replay)';
    const modes = Array.isArray(fam['modes']) ? (fam['modes'] as unknown[]) : [];
    return modes.includes('replay') ? null : `replay.modes ${JSON.stringify(modes)} does not include replay`;
  }
  /**
   * Run → the source's own disposition → a `replay` fork at the gate's recorded
   * `interrupt.resolved`: the prefix holds the gate's request and suspension, and the
   * fork must supply the resolution. A deriving host takes the recorded one (replay.md
   * §Determinism 2); a re-deciding host raises a NEW `interrupt.requested` and waits.
   * Forking at the gate's `node.started` instead would let a host re-emit the recorded
   * request as history, which cannot be told apart from a new one.
   */
  async function replayedRejection(fixture: string, decide: ((runId: string) => Promise<string | null>) | null, settleMs: number): Promise<{ source: SeqEv[]; fromSeq: number; forkId: string; forkStatus: string | null; fork: SeqEv[] } | { reason: string }> {
    const s = await suspended(fixture);
    if ('reason' in s) return s;
    if (decide !== null) { const why = await decide(s.runId); if (why !== null) return { reason: why }; }
    const terminal = await waitStatus(s.runId, TERMINAL, settleMs);
    if (terminal?.['status'] !== 'failed') return { reason: `the source run did not end failed (status ${String(terminal?.['status'])}) — the reject rows own that contract` };
    const source = await debugLog(s.runId);
    const at = source.find((e) => e.type === 'interrupt.resolved' && onGate(e));
    if (at?.sequence === undefined) return { reason: 'the source log has no interrupt.resolved for the gate to fork at' };
    const fork = await http(() => driver.post(`/runs/${enc(s.runId)}:fork`, { mode: 'replay', fromSeq: at.sequence }));
    const forkId = (fork?.json as { runId?: unknown } | null)?.runId;
    if (fork === null || fork.status !== 201 || typeof forkId !== 'string') return { reason: `POST /runs/{runId}:fork answered ${fork?.status ?? 'nothing'} ${readErrorCode(fork?.json) ?? ''} — forkRun owns that contract`.trim() };
    const settled = await waitStatus(forkId, new Set([...TERMINAL, 'waiting-approval']), scaledTimeoutMs(20_000));
    return { source, fromSeq: at.sequence, forkId, forkStatus: settled === null ? null : String(settled['status']), fork: await debugLog(forkId) };
  }
  function assertDerived(r: { source: SeqEv[]; fromSeq: number; forkId: string; forkStatus: string | null; fork: SeqEv[] }, leg: string): void {
    const reRaised = r.fork.filter((e) => (e.sequence as number) >= r.fromSeq && (e.type === 'interrupt.requested' || e.type === 'approval.requested') && onGate(e));
    expect(reRaised.length, req(REPLAY_ID, REPLAY_DOC, `${leg}: the replay fork MUST NOT raise a new interrupt for the gate — the rejection is derived from the recorded interrupt.resolved, never re-decided (status ${String(r.forkStatus)})`)).toBe(0);
    const pick = (e: SeqEv | undefined): Record<string, unknown> => ({ decision: e?.payload?.['decision'], action: e?.payload?.['action'], reason: e?.payload?.['reason'] });
    const srcResolved = r.source.find((e) => e.type === 'interrupt.resolved' && onGate(e));
    const forkResolved = r.fork.find((e) => e.type === 'interrupt.resolved' && onGate(e));
    expect(pick(forkResolved), req(REPLAY_ID, REPLAY_DOC, `${leg}: the fork's interrupt.resolved for the gate MUST carry the source's decision, action and reason`)).toEqual(pick(srcResolved));
    const runFailed = r.fork.find((e) => e.type === 'run.failed');
    const nodeFailed = r.fork.find((e) => e.type === 'node.failed' && onGate(e));
    expect(
      { status: r.forkStatus, code: errorCode(runFailed?.payload?.['error']), failedNodeId: runFailed?.payload?.['failedNodeId'], retryable: (nodeFailed?.payload?.['error'] as { retryable?: unknown } | undefined)?.retryable },
      req(REPLAY_ID, REPLAY_DOC, `${leg}: the fork MUST fail as the source did — failed, run.failed approval_rejected naming the gate, and a non-retryable node.failed`),
    ).toEqual({ status: 'failed', code: CODE, failedNodeId: NODE_ID, retryable: false });
  }

  it('a replay fork of a decided reject derives the rejection from the log and never re-decides it (leg A)', async () => {
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    const noReplay = await replayGate();
    if (noReplay !== null) return softSkip('inapplicable', noReplay);
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', `fixture ${FIXTURE} is not advertised`);
    const r = await replayedRejection(FIXTURE, async (runId) => {
      const res = await resolve(runId, { action: 'reject' });
      return res === null || res.status < 200 || res.status >= 300 ? `the reject resolve answered ${res?.status ?? 'nothing'} ${readErrorCode(res?.json) ?? ''}` : null;
    }, 10_000);
    if ('reason' in r) return softSkip('blocked', r.reason);
    const again = await resolve(r.forkId, { action: 'accept' });
    assertDerived(r, 'leg A (decided reject)');
    expect({ status: again?.status, code: readErrorCode(again?.json) }, req(REPLAY_ID, 'spec/v2/core/errors.md §One code per state', 'a resolve against the replayed gate MUST answer 409 interrupt_already_resolved — the fork holds no open decision')).toEqual({ status: 409, code: 'interrupt_already_resolved' });
  }, 90_000);

  it('a replay fork of a timed-out gate derives the timeout rejection from the log and never re-arms it (leg B)', async () => {
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    const noReplay = await replayGate();
    if (noReplay !== null) return softSkip('inapplicable', noReplay);
    if (!isFixtureAdvertised(TIMEOUT_APPROVE)) return softSkip('inapplicable', `fixture ${TIMEOUT_APPROVE} is not advertised`);
    const r = await replayedRejection(TIMEOUT_APPROVE, null, scaledTimeoutMs(20_000));
    if ('reason' in r) return softSkip('blocked', r.reason);
    assertDerived(r, 'leg B (timeout)');
    // resolvedBy on a timeout row is the host's subject or absent (RFC 0183 §Unresolved 1), so
    // the leg asserts the fork carries the SOURCE's value, not that it is absent.
    const forkResolved = r.fork.find((e) => e.type === 'interrupt.resolved' && onGate(e));
    const srcResolved = r.source.find((e) => e.type === 'interrupt.resolved' && onGate(e));
    expect(
      { action: forkResolved?.payload?.['action'], reason: forkResolved?.payload?.['reason'], resolvedBy: JSON.stringify(forkResolved?.payload?.['resolvedBy'] ?? null) },
      req(REPLAY_ID, REPLAY_DOC, 'leg B: the derived resolution is the recorded timeout — action timeout, reason timeout, and the source\'s resolvedBy (a host subject or absent), never a caller'),
    ).toEqual({ action: 'timeout', reason: 'timeout', resolvedBy: JSON.stringify(srcResolved?.payload?.['resolvedBy'] ?? null) });
  }, 120_000);
});
