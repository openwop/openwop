/**
 * RFC 0158 — the `durable-single-instance` recovery rows.
 *
 * All five `durable-single-instance` rows the RFC names, four of which no
 * scenario had ever existed for.
 *
 * `durability/poison-exhaustion` DID exist
 * (`durability-poison-exhaustion.test.ts`) but was registered at MAJOR 1 ONLY
 * and read a hard-coded `/v1/host/sample/test/runs/{runId}/events` seam, so no
 * v2 bundle could carry a durability row of any kind and the rung was
 * unwitnessable at major 2 even with the other four passing. The port is the
 * fifth `it` below, and it needs NO SEAM: at major 2 the canonical
 * `GET /runs/{runId}/events` answers the same question the v1 sample seam was
 * invented to answer, so the row can never be `blocked` for want of a seam a
 * host did not wire. The v1 scenario stays where it is, unchanged.
 *
 * ── The disposition ruling, which is the load-bearing design decision ────────
 * §E says an unmet OPERATOR PRECONDITION is `blocked` with the precondition
 * named, never a silent skip or a pass. §E also says the seam is "a
 * non-normative host-extension route … it advertises nothing … a host that
 * never runs the durability exercises exposes no such route. It is test
 * infrastructure, not protocol surface."
 *
 * Those two sentences describe DIFFERENT states, and collapsing them would
 * strip certification from the entire fleet the day these rows enter the
 * major-2 lane, because a `blocked` row denies certification (RFC 0168 §E.1):
 *
 *   - NO SEAM ROUTE AT ALL  → `inapplicable`. The host exposes no durability
 *     seam, which under §E.10 (no capability field is minted) is exactly how a
 *     host says it claims no durable-execution rung. Blocking a host for a
 *     claim it never made is the false-refusal half of the same error as a
 *     vacuous pass.
 *   - SEAM PRESENT, PRECONDITION UNMET → `blocked`, precondition NAMED. The
 *     host offered the exercise and could not complete it. That is §E's case.
 *
 * ── Why a real kill, and why the interval is kill → RESUMPTION ───────────────
 * §D.9 rejects "claim semantics asserted without a process death", and §B.4
 * bounds the interval until another instance becomes eligible to RESUME the
 * work — not until the work finishes. Timing kill → terminal adds the work's
 * own execution time and makes a conformant host report a figure over its own
 * derived bound: a §B.5 violation that did not happen. Both measured failures
 * are recorded in the RFC.
 *
 * ── What this file deliberately does not do ─────────────────────────────────
 * `durability/peer-resume` is the `durable-multi-instance` discriminator and is
 * NOT required for the rung these rows witness. §E makes it bundle-witnessed
 * via an opaque per-boot incarnation token, not black-box observable, so a
 * scenario here could only ever record `blocked` on the ≥2-instances
 * precondition. It is omitted rather than written as a row that can never pass
 * — the defect this session found in `0188.dead-letter-content-free`.
 *
 * @see RFCS/0158-durable-execution-and-disaster-recovery-qualification.md §B.4 §D.9 §E
 */

import { describe, expect, it } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip } from '../lib/soft-skip.js';
import { pollUntilTerminal, scaledTimeoutMs } from '../lib/polling.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-noop';
const FAILURE_FIXTURE = 'conformance-failure';

/** A `node.started` is attempt 1; each `node.retried` is one more. Counting BOTH
 *  catches a host that re-dispatches without emitting `node.retried`. */
const ATTEMPT_TYPES = new Set(['node.started', 'node.retried']);

/** Watch window after terminal. A LONGER wait is a STRONGER claim here, because
 *  it is a wait for something that must not happen. */
const QUIET_WINDOW_MS = 4_000;

/** The canonical major-2 run-event read. Null when it does not answer. */
async function runEvents(runId: string): Promise<Array<{ type: string }> | null> {
  const r = await driver.get(`/runs/${encodeURIComponent(runId)}/events`);
  if (r.status !== 200) return null;
  const events = (r.json as { events?: Array<{ type?: unknown }> } | null)?.events;
  if (!Array.isArray(events)) return null;
  return events.filter((e): e is { type: string } => typeof e.type === 'string');
}

/** The host-extension seam these rows drive. Non-normative; advertises nothing. */
const KILL_SEAM = '/host/durability/kill';

/** How long to wait for the service to answer again after a real termination. */
const RESUME_WINDOW_MS = 30_000;

type SeamState =
  | { kind: 'absent'; why: string }
  | { kind: 'present' };

/**
 * Probe the seam WITHOUT firing it. A `404`/`405` means the route is not
 * mounted; anything else means the host offered it and the exercise is on.
 * A GET is used on purpose: firing the kill to discover whether it exists
 * would terminate a host that never claimed the rung.
 */
async function probeSeam(): Promise<SeamState> {
  const r = await driver.get(KILL_SEAM);
  if (r.status === 404 || r.status === 405) {
    return { kind: 'absent', why: `no RFC 0158 durability seam at ${KILL_SEAM} (HTTP ${r.status}) — §E: the seam advertises nothing and a host that never runs the durability exercises exposes no such route, so this host claims no durable-execution rung` };
  }
  return { kind: 'present' };
}

/** Wait for the service to answer discovery again; null when it never does. */
async function waitBack(deadlineMs: number): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const r = await driver.get('/.well-known/openwop');
      if (r.status === 200) return Date.now() - started;
    } catch { /* the process is down; that is the point */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/** Count the run-lifecycle re-starts on a run: §B.4's resumption observation. */
async function runStartedCount(runId: string): Promise<number> {
  const r = await driver.get(`/runs/${encodeURIComponent(runId)}/events`);
  if (r.status !== 200) return -1;
  const events = (r.json as { events?: Array<{ type?: string }> } | null)?.events ?? [];
  return events.filter((e) => e.type === 'run.started').length;
}

describe('v2-durability-recovery (RFC 0158 §B.4, §D.9, §E — the durable-single-instance rows)', () => {
  it('accepted work survives a kill before dispatch and dispatches on resume', async () => {
    const doc = await v2Discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no work to accept`);
    const seam = await probeSeam();
    if (seam.kind === 'absent') return softSkip('inapplicable', seam.why);

    // §E item 11: kill-after-accept is a HOLD-DISPATCH row, not a
    // termination-timing row. On a host where acceptance and dispatch are
    // microseconds apart, racing a kill into that window cannot reliably hit
    // it — so the seam holds dispatch, the kill lands during the hold, and the
    // accepted-but-undispatched work dispatches on resume.
    const fired = await driver.post(KILL_SEAM, { mode: 'after-accept', workflowId: FIXTURE });
    if (fired.status >= 400) {
      return softSkip('blocked', `the durability seam answered ${fired.status} for mode=after-accept — the host exposes the route but could not stage the exercise`);
    }
    const runId = (fired.json as { runId?: unknown } | null)?.runId;
    if (typeof runId !== 'string') {
      return softSkip('blocked', 'the seam staged a kill but named no runId, so there is no accepted work to follow across the death');
    }

    const backIn = await waitBack(scaledTimeoutMs(RESUME_WINDOW_MS));
    if (backIn === null) {
      // §E: kill rows need a RESTART SUPERVISOR — a black-box suite cannot
      // restart a killed single instance. Name the precondition rather than
      // reporting a host defect that is really a harness gap.
      return softSkip('blocked', 'the service never answered again within the window — the operator precondition for this row is a restart supervisor (something must restart the killed instance; the suite cannot)');
    }

    const starts = await runStartedCount(runId);
    expect(
      starts >= 1,
      req('openwop.requirement.0158.kill-after-accept', 'RFC 0158 §B.4', `work accepted before a real process death MUST dispatch on resume — the run's log MUST show it being executed after the kill, observed ${starts} run.started (service answered again after ${backIn}ms)`),
    ).toBe(true);
  }, 120_000);

  it('work executing at a real process death is never reported complete, and resumes', async () => {
    const doc = await v2Discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no work to execute`);
    const seam = await probeSeam();
    if (seam.kind === 'absent') return softSkip('inapplicable', seam.why);

    const fired = await driver.post(KILL_SEAM, { mode: 'during-execution', workflowId: FIXTURE });
    if (fired.status >= 400) {
      return softSkip('blocked', `the durability seam answered ${fired.status} for mode=during-execution — the host exposes the route but could not stage the exercise`);
    }
    const runId = (fired.json as { runId?: unknown } | null)?.runId;
    if (typeof runId !== 'string') {
      return softSkip('blocked', 'the seam staged a kill but named no runId, so the in-flight work cannot be followed across the death');
    }

    const backIn = await waitBack(scaledTimeoutMs(RESUME_WINDOW_MS));
    if (backIn === null) {
      return softSkip('blocked', 'the service never answered again within the window — the operator precondition for this row is a restart supervisor (something must restart the killed instance; the suite cannot)');
    }

    // §E item 11's first clause, and the one a host is most likely to get
    // wrong: work that was executing when the process died MUST NOT be
    // observable as completed. A host that marks it complete on restart has
    // reported success for work it never finished.
    const snap = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    const status = (snap.json as { status?: unknown } | null)?.status;
    const starts = await runStartedCount(runId);
    expect(
      status !== 'completed' || starts > 1,
      req('openwop.requirement.0158.kill-during-execution', 'RFC 0158 §B.4 / §E item 11', `work executing at a real process death MUST NOT be observable as completed without having been re-executed — read status ${String(status)} with ${starts} run.started (service answered again after ${backIn}ms); §B.4 measures kill → RESUMPTION, never kill → terminal`),
    ).toBe(true);
  }, 120_000);

  it('the same accepted work delivered twice fires each effect exactly once', async () => {
    const doc = await v2Discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const seam = await probeSeam();
    if (seam.kind === 'absent') return softSkip('inapplicable', seam.why);

    const fired = await driver.post(KILL_SEAM, { mode: 'duplicate-delivery', workflowId: FIXTURE });
    if (fired.status >= 400) {
      return softSkip('blocked', `the durability seam answered ${fired.status} for mode=duplicate-delivery — the host exposes the route but could not stage a double delivery`);
    }
    const runId = (fired.json as { runId?: unknown } | null)?.runId;
    if (typeof runId !== 'string') {
      return softSkip('blocked', 'the seam staged a duplicate delivery but named no runId');
    }

    const eff = await driver.get(`/runs/${encodeURIComponent(runId)}/effects`);
    if (eff.status !== 200) {
      return softSkip('blocked', `GET /runs/{runId}/effects answered ${eff.status} — per-identity invocation counts are unobservable, so the assertion would be vacuous`);
    }
    const effects = (eff.json as { effects?: Array<Record<string, unknown>> } | null)?.effects ?? [];
    if (effects.length === 0) {
      return softSkip('blocked', 'the staged run recorded no effects — there is no identity to count invocations against, and an end-state assertion is exactly what §C rules out');
    }
    // §C: assert INVOCATION COUNTS PER IDENTITY, not final state. A legal end
    // state is precisely what a double-fire produces, so an end-state
    // assertion passes on the defect it exists to catch.
    const byIdentity = new Map<string, number>();
    for (const e of effects) {
      const id = String(e['effectId'] ?? e['keying'] ?? '');
      if (id === '') continue;
      byIdentity.set(id, (byIdentity.get(id) ?? 0) + 1);
    }
    const doubled = [...byIdentity.entries()].filter(([, n]) => n > 1);
    expect(
      doubled.length === 0,
      req('openwop.requirement.0158.duplicate-delivery', 'RFC 0158 §C', `the same accepted work delivered twice MUST fire each effect exactly once, asserted per effect identity — ${byIdentity.size} identity/identities recorded, ${doubled.length} fired more than once${doubled.length ? ` (${doubled.map(([k, n]) => `${k}×${n}`).join(', ')})` : ''}`),
    ).toBe(true);
  }, 120_000);

  it('the declared recovery bound is derived from the mechanism that enforces it', async () => {
    const doc = await v2Discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const seam = await probeSeam();
    if (seam.kind === 'absent') return softSkip('inapplicable', seam.why);

    const terms = await driver.get('/host/durability/bound');
    if (terms.status === 404 || terms.status === 405) {
      return softSkip('blocked', 'the host exposes the durability seam but serves no recovery-bound terms — §E puts the per-class arithmetic in the RFC 0148 evidence bundle where a reader can recompute it, and there is nothing here to recompute');
    }
    const body = (terms.json as { bound?: unknown; terms?: unknown } | null) ?? {};
    const bound = typeof body.bound === 'number' ? body.bound : null;
    const parts = Array.isArray(body.terms) ? (body.terms as unknown[]) : null;
    if (bound === null || parts === null || parts.length === 0) {
      return softSkip('blocked', 'the recovery-bound response names no { bound, terms[] } — §E asks for the per-class arithmetic, not a single total (Unresolved Question 1), and a total alone cannot be recomputed');
    }
    const summed = parts.reduce<number>((acc, t) => acc + (typeof (t as { ms?: unknown }).ms === 'number' ? (t as { ms: number }).ms : Number.NaN), 0);
    // THIS ROW IS A PAPER CHECK BY CONSTRUCTION AND THE RFC SAYS SO. It checks
    // that the declared number follows from the stated mechanism. It cannot
    // check that the mechanism RUNS: a host whose sweeper wedges has a
    // derivation that stays perfectly correct while the bound is not produced
    // at all — a run sat unclaimed for 16 minutes against a derived bound of
    // 12.5 with every isolated check of the mechanism passing. Only the kill
    // rows above witness liveness, and this row MUST NOT be cited for it.
    expect(
      Number.isFinite(summed) && Math.abs(summed - bound) <= 1,
      req('openwop.requirement.0158.bound-is-derived', 'RFC 0158 §B.5', `the declared recovery bound MUST follow from the per-class terms that produce it — declared ${bound}, terms sum to ${summed}. A host that states a bound it cannot produce fails; a host whose sweeper wedges still passes, which is why this row MUST NOT be read as evidence that the mechanism runs`),
    ).toBe(true);
  }, 120_000);

  it('deterministically failing work reaches a terminal state and stops being retried', async () => {
    // NO SEAM GATE. The v1 twin reads `/v1/host/sample/test/runs/{runId}/events`
    // and records `blocked` when a host has not wired it — "unobservable, not
    // unmet". At major 2 the canonical run-event read answers the same
    // question, so this row is black-box and cannot be blocked for want of
    // infrastructure. That is the whole reason the port was worth doing rather
    // than dual-majoring the original.
    const doc = await v2Discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!isFixtureAdvertised(FAILURE_FIXTURE)) {
      return softSkip('inapplicable', `${FAILURE_FIXTURE} fixture not advertised — there is no deterministically failing work to bound`);
    }

    const create = await driver.post('/runs', { workflowId: FAILURE_FIXTURE });
    if (create.status !== 201) return softSkip('blocked', `POST /runs answered ${create.status} for the failing fixture`);
    const runId = (create.json as { runId: string }).runId;

    // First clause: a terminal, operator-visible state.
    const terminal = await pollUntilTerminal(runId, { timeoutMs: scaledTimeoutMs(30_000) });
    expect(
      terminal.status,
      req('openwop.requirement.0158.poison-exhaustion', 'RFC 0158 §C.8', `deterministically failing work MUST reach a terminal, operator-visible state — read ${terminal.status}`),
    ).toBe('failed');

    const before = await runEvents(runId);
    if (before === null) return softSkip('blocked', 'GET /runs/{runId}/events did not answer — attempts are unobservable, so boundedness would be a vacuous claim');
    // Non-vacuity: the failure must actually be ON the log. Without this a host
    // returning an empty array sails through every count comparison below,
    // because 0 === 0 after any wait.
    if (!before.some((e) => e.type === 'node.failed')) {
      return softSkip('blocked', 'the run log records no node.failed — an empty or unprojected log makes every attempt count vacuous');
    }
    const attemptsBefore = before.filter((e) => ATTEMPT_TYPES.has(e.type)).length;
    expect(
      attemptsBefore > 0,
      req('openwop.requirement.0158.poison-exhaustion', 'RFC 0158 §C.8', 'at least one attempt MUST be recorded — zero attempts means nothing was ever delivered, and the bound below would hold vacuously'),
    ).toBe(true);

    // The load-bearing clause: NOT redelivered indefinitely. "The run reached
    // failed" says nothing about it — a host that redelivers forever ALSO
    // reports a terminal status at some point. Count, wait, count again.
    await new Promise((r) => setTimeout(r, scaledTimeoutMs(QUIET_WINDOW_MS)));
    const after = await runEvents(runId);
    if (after === null) return softSkip('blocked', 'the second GET /runs/{runId}/events did not answer, so the stability comparison has one side');
    const attemptsAfter = after.filter((e) => ATTEMPT_TYPES.has(e.type)).length;
    expect(
      attemptsAfter,
      req('openwop.requirement.0158.poison-exhaustion', 'RFC 0158 §C.8', `attempts MUST NOT continue after the run reports terminal — a host still redelivering records more (${attemptsBefore} before the quiet window, ${attemptsAfter} after)`),
    ).toBe(attemptsBefore);
  }, 120_000);
});
