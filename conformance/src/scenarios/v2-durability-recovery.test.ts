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
 * ── 2.32.0: the observation runs to the DECLARED bound ───────────────────────
 * Until 2.32.0 both kill rows read the log ONCE, the instant discovery answered
 * again — mandating resumption within ~0 ms of the listener returning, i.e. a
 * fast bound, which the RFC rejects. Found by the openwop-app host reading this
 * file against its own sweeper BEFORE building the seam; a first witness on a
 * host that re-enters runs at boot would have passed the single read and hidden
 * it. `kill-during-execution` also asserted only the first clause of item 11
 * and so passed on a host that never resumed. See the RFC's 2026-09-20 note.
 * `duplicate-delivery` counted rows per identity on an identity-keyed ledger,
 * which cannot show a double-fire; the effect is now counted at a receiver the
 * suite owns. All four were found by hosts reading this file, not by a run.
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

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip } from '../lib/soft-skip.js';
import { pollUntilTerminal, scaledTimeoutMs } from '../lib/polling.js';
import { req } from '../lib/requirement-ids.js';
import { receiverBinding, resolveRegistrationUrl } from '../lib/webhook-receiver.js';

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

/**
 * §B.4's resumption observation, read off the canonical event log.
 *
 * RFC 0158 §E item 11 names "a second `run.started`, or any equivalent
 * progress-past-the-pre-kill-point signal". The registry already has two events
 * whose whole meaning is that signal — `workflow.restored` ("an in-flight run is
 * recovered from the event log on a fresh engine boot") and
 * `run.restored-from-snapshot` — so a host that reports recovery with the event
 * minted for it is not failed for declining to re-emit `run.started`.
 */
const RESTORED_TYPES = new Set(['workflow.restored', 'run.restored-from-snapshot']);
interface Observation { readable: boolean; runStarted: number; nodeStarted: number; restored: number }
async function observe(runId: string): Promise<Observation> {
  const r = await driver.get(`/runs/${encodeURIComponent(runId)}/events`);
  if (r.status !== 200) return { readable: false, runStarted: 0, nodeStarted: 0, restored: 0 };
  const events = (r.json as { events?: Array<{ type?: string }> } | null)?.events ?? [];
  const n = (pred: (t: string) => boolean): number => events.filter((e) => typeof e.type === 'string' && pred(e.type)).length;
  return { readable: true, runStarted: n((t) => t === 'run.started'), nodeStarted: n((t) => t === 'node.started'), restored: n((t) => RESTORED_TYPES.has(t)) };
}

/**
 * The longest this suite will wait for a resumption. 240 s by DEFAULT, and
 * operator-raisable, because a fixed ceiling is the single read's defect moved
 * from 0 s to 240 s: a host whose leased-class bound is 12.5 min (a 12 min
 * dispatch lease + a 30 s orphan sweep) is conformant under §B.6, would observe
 * nothing in 240 s, record `blocked`, and — `blocked` denying certification
 * (RFC 0168 §E.1) — could never certify the rung without shortening a lease,
 * the outcome §"Alternatives considered" rejects. An operator with a long bound
 * sets `OPENWOP_DURABILITY_OBSERVATION_CEILING_MS` and waits it out; a
 * 13-minute row in a certification cut is affordable, an uncertifiable
 * conformant host is not. The `it` timeouts below scale from it.
 */
const DEFAULT_OBSERVATION_CEILING_MS = 240_000;
const OBSERVATION_CEILING_MS = ((): number => {
  const raw = Number(process.env['OPENWOP_DURABILITY_OBSERVATION_CEILING_MS']);
  return Number.isFinite(raw) && raw >= DEFAULT_OBSERVATION_CEILING_MS ? raw : DEFAULT_OBSERVATION_CEILING_MS;
})();
/** RESUME_WINDOW + the observation + slack for the reads themselves. */
const KILL_ROW_TIMEOUT_MS = OBSERVATION_CEILING_MS + 120_000;
/** Used only when the host serves no bound to read; named in the row's detail. */
const UNDECLARED_BOUND_FALLBACK_MS = 60_000;

/**
 * How long to keep observing: the host's OWN declared recovery bound.
 *
 * §E item 11: resumption "MUST be observed on a subsequent observation within
 * the declared recovery bound", and §B.6 makes a long bound conformant. Until
 * 2.32.0 both kill rows read the log ONCE, the instant discovery answered
 * again — which demanded resumption within ~0 ms of the listener coming up, a
 * fast bound the RFC's §"Alternatives considered" explicitly rejects. A host
 * whose sweeper first ticks 5 s after boot against a 65 s derived bound read
 * `0 run.started` and failed, then resumed correctly ten seconds later. The
 * bound is used as a CEILING FOR WAITING only; it is never asserted as a
 * scalar here (`bound-is-derived` owns the arithmetic).
 */
async function declaredBoundMs(fired: unknown): Promise<{ ms: number; declared: boolean }> {
  // A host whose bound is PER CLASS (Unresolved Question 1: unleased work waits
  // out an outbox lease, leased work a dispatch lease — 65 s against 750 s on
  // one measured host) names the figure that governs THIS work on the seam's
  // own response. The bare read below returns one class and would report the
  // interval against a bound that does not govern the staged run.
  const governing = (fired as { recoveryBoundMs?: unknown } | null)?.recoveryBoundMs;
  if (typeof governing === 'number' && Number.isFinite(governing) && governing > 0) return { ms: governing, declared: true };
  const r = await driver.get('/host/durability/bound');
  const bound = (r.json as { bound?: unknown } | null)?.bound;
  return r.status === 200 && typeof bound === 'number' && Number.isFinite(bound) && bound > 0
    ? { ms: bound, declared: true }
    : { ms: UNDECLARED_BOUND_FALLBACK_MS, declared: false };
}

interface Watch { resumedAfterMs: number | null; last: Observation; completedUnresumed: boolean; waitedMs: number }
/**
 * Observe `runId` from the moment the service answers again until `resumed`
 * holds or `budgetMs` elapses. `completedUnresumed` latches if ANY observation
 * shows the run `completed` while `resumed` is still false — the item-11 defect
 * is a state a later observation can paper over, so it is checked at every read.
 */
async function watchForResumption(runId: string, budgetMs: number, resumed: (o: Observation) => boolean): Promise<Watch> {
  const t0 = Date.now();
  let last: Observation = { readable: false, runStarted: 0, nodeStarted: 0, restored: 0 };
  let completedUnresumed = false;
  for (;;) {
    last = await observe(runId);
    const waitedMs = Date.now() - t0;
    if (last.readable && resumed(last)) return { resumedAfterMs: waitedMs, last, completedUnresumed, waitedMs };
    const snap = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    if ((snap.json as { status?: unknown } | null)?.status === 'completed' && !(last.readable && resumed(last))) completedUnresumed = true;
    if (waitedMs >= budgetMs) return { resumedAfterMs: null, last, completedUnresumed, waitedMs };
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * The suite's own destination for the one staged effect. Every request that
 * reaches it is an INVOCATION — the thing §C says to count. Honours
 * OPENWOP_WEBHOOK_RECEIVER_PORT so a tunnelled cut forwards here (the
 * certification setting is already `--max-workers 1`, so the pinned port is
 * not contended by the webhook files).
 */
async function startEffectReceiver(): Promise<{ server: Server; url: string; arrivals: Array<{ method: string; at: number }> }> {
  const arrivals: Array<{ method: string; at: number }> = [];
  const server = createServer((request: IncomingMessage, res: ServerResponse) => {
    request.on('data', () => { /* drain */ });
    request.on('end', () => { arrivals.push({ method: request.method ?? '', at: Date.now() }); res.writeHead(204); res.end(); });
  });
  const pinned = Number(process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] ?? '');
  const bindPort = Number.isInteger(pinned) && pinned > 0 && pinned < 65536 ? pinned : 0;
  const binding = receiverBinding();
  await new Promise<void>((resolve) => server.listen(bindPort, binding.bind, () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, url: `http://${binding.advertise}:${port}/effect`, arrivals };
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

    // Accepted-but-undispatched work has, by definition, not executed: any
    // dispatch evidence after the death is the resumption. Observed until the
    // host's OWN declared bound elapses, never once at the instant of return.
    const bound = await declaredBoundMs(fired.json);
    const budget = Math.min(bound.ms, OBSERVATION_CEILING_MS);
    const w = await watchForResumption(runId, budget, (o) => o.runStarted >= 1 || o.nodeStarted >= 1 || o.restored >= 1);
    if (w.resumedAfterMs === null && bound.ms > OBSERVATION_CEILING_MS) {
      return softSkip('blocked', `no dispatch observed in ${w.waitedMs}ms, but the host declares a ${bound.ms}ms recovery bound and this run observes for at most ${OBSERVATION_CEILING_MS}ms — a bound longer than the observation ceiling is conformant (§B.6) and is neither witnessed nor refuted here; the operator precondition for this row is OPENWOP_DURABILITY_OBSERVATION_CEILING_MS >= the declared bound`);
    }
    expect(
      w.resumedAfterMs !== null,
      req('openwop.requirement.0158.kill-after-accept', 'RFC 0158 §B.4', `work accepted before a real process death MUST dispatch on resume within the declared recovery bound — service answered again after ${backIn}ms, then observed for ${w.waitedMs}ms against a ${bound.declared ? `declared ${bound.ms}ms bound` : `${bound.ms}ms fallback (the host serves no /host/durability/bound)`}: ${w.last.runStarted} run.started, ${w.last.nodeStarted} node.started, ${w.last.restored} restored${w.resumedAfterMs !== null ? `; dispatch first observed ${backIn + w.resumedAfterMs}ms after the kill` : ''}`),
    ).toBe(true);
  }, KILL_ROW_TIMEOUT_MS);

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

    // §E item 11 is TWO clauses and until 2.32.0 only the first was asserted:
    // `status !== 'completed' || starts > 1` holds forever for a run that is
    // simply never resumed, so the row passed on a host that lost the work —
    // weaker than its own RFC table row ("resumed within the declared bound").
    // (1) work executing at the death MUST NOT be observable as completed
    //     without having been re-executed — latched across EVERY observation;
    // (2) resumption MUST be observed within the declared recovery bound.
    // Work that was executing already has one `run.started`; resumption is a
    // further one, or the registry's own recovery event.
    const bound = await declaredBoundMs(fired.json);
    const budget = Math.min(bound.ms, OBSERVATION_CEILING_MS);
    const w = await watchForResumption(runId, budget, (o) => o.runStarted > 1 || o.restored >= 1);
    expect(
      w.completedUnresumed,
      req('openwop.requirement.0158.kill-during-execution', 'RFC 0158 §B.4 / §E item 11', `work executing at a real process death MUST NOT be observable as completed without having been re-executed — an observation after the kill read status completed with ${w.last.runStarted} run.started and ${w.last.restored} restored (service answered again after ${backIn}ms)`),
    ).toBe(false);
    if (w.resumedAfterMs === null && bound.ms > OBSERVATION_CEILING_MS) {
      return softSkip('blocked', `no resumption observed in ${w.waitedMs}ms, but the host declares a ${bound.ms}ms recovery bound and this run observes for at most ${OBSERVATION_CEILING_MS}ms — a bound longer than the observation ceiling is conformant (§B.6) and is neither witnessed nor refuted here; the operator precondition for this row is OPENWOP_DURABILITY_OBSERVATION_CEILING_MS >= the declared bound`);
    }
    expect(
      w.resumedAfterMs !== null,
      req('openwop.requirement.0158.kill-during-execution', 'RFC 0158 §B.4 / §E item 11', `work executing at a real process death MUST resume within the declared recovery bound; §B.4 measures kill → RESUMPTION, never kill → terminal — service answered again after ${backIn}ms, then observed for ${w.waitedMs}ms against a ${bound.declared ? `declared ${bound.ms}ms bound` : `${bound.ms}ms fallback (the host serves no /host/durability/bound)`}: ${w.last.runStarted} run.started, ${w.last.restored} restored${w.resumedAfterMs !== null ? `; resumption first observed ${backIn + w.resumedAfterMs}ms after the kill` : ''}`),
    ).toBe(true);
  }, KILL_ROW_TIMEOUT_MS);

  it('the same accepted work delivered twice fires each effect exactly once', async () => {
    const doc = await v2Discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const seam = await probeSeam();
    if (seam.kind === 'absent') return softSkip('inapplicable', seam.why);

    // THE EFFECT IS COUNTED WHERE IT LANDS, not where the host says it landed.
    // Until 2.32.0 this row counted rows per identity on GET /runs/{id}/effects.
    // A ledger keyed on effect identity admits AT MOST ONE ROW per identity by
    // construction — a second fire at the same identity writes the same key —
    // so `no identity appears twice` held whatever the effect did. Measured by
    // the openwop-app host before it built to this row: with its dedup claim
    // forced to always win, and then with the effect emitted twice per fire (an
    // unambiguous double-fire), the per-identity count stayed 1 and the row
    // stayed green. §C asks for INVOCATION counts; the projection exposes
    // IDENTITIES. The only black-box oracle for "fired once" is a receiver the
    // suite owns, so the seam aims the staged work's effect at `effectUrl`.
    //
    // NO `workflowId` is sent: no canonical fixture is guaranteed effectful
    // (`conformance-noop` records none). The seam is host test infrastructure
    // (§E) and chooses the work; it MUST stage work that performs EXACTLY ONE
    // outbound effect, addressed to `effectUrl`, and deliver it twice.
    const rx = await startEffectReceiver();
    try {
      const target = resolveRegistrationUrl(rx.url);
      const fired = await driver.post(KILL_SEAM, { mode: 'duplicate-delivery', effectUrl: target.url });
      if (fired.status >= 400) {
        return softSkip('blocked', `the durability seam answered ${fired.status} for mode=duplicate-delivery with effectUrl ${target.tunnelled ? '(tunnelled)' : rx.url} — the host exposes the route but could not stage a double delivery; if its egress guard refused the receiver, the operator precondition is the webhook rows' own: a publicly-resolvable https front (OPENWOP_WEBHOOK_RECEIVER_URL) or a host run with its private-egress relaxation recorded`);
      }
      const runId = (fired.json as { runId?: unknown } | null)?.runId;
      if (typeof runId !== 'string') {
        return softSkip('blocked', 'the seam staged a duplicate delivery but named no runId');
      }

      await pollUntilTerminal(runId, { timeoutMs: scaledTimeoutMs(60_000) });
      // A LONGER wait is a STRONGER claim: this is a wait for a second arrival
      // that must not happen, and the second delivery may trail the first.
      await new Promise((r) => setTimeout(r, scaledTimeoutMs(QUIET_WINDOW_MS)));

      const arrivals = rx.arrivals.length;
      if (arrivals === 0 && !target.tunnelled) {
        return softSkip('blocked', `the staged work's effect never reached the suite's receiver at ${rx.url} — for mode=duplicate-delivery the seam MUST aim exactly one outbound effect at the given effectUrl; with nothing landed there is no invocation to count, and the ledger alone cannot witness a double-fire`);
      }
      // With a tunnel declared, zero arrivals is a hard failure, never a skip
      // (webhook-receiver.ts): a mis-wired tunnel must not read as a pass.
      expect(
        arrivals,
        req('openwop.requirement.0158.duplicate-delivery', 'RFC 0158 §C', `the same accepted work delivered twice MUST fire each effect exactly once, counted at the effect's destination — the suite's receiver observed ${arrivals} arrival(s) of the one staged effect for run ${runId}`),
      ).toBe(1);

      // Secondary, and labelled for what it is: the host's own account agrees
      // with what landed. On an identity-keyed ledger this can never exceed one
      // row per identity, so it witnesses that the PROJECTION IS CONSISTENT, not
      // that no double-fire happened — the arrival count above owns that.
      const eff = await driver.get(`/runs/${encodeURIComponent(runId)}/effects`);
      if (eff.status === 200) {
        const effects = (eff.json as { effects?: Array<Record<string, unknown>> } | null)?.effects ?? [];
        const byIdentity = new Map<string, number>();
        for (const e of effects) {
          const id = String(e['effectId'] ?? e['keying'] ?? '');
          if (id === '') continue;
          byIdentity.set(id, (byIdentity.get(id) ?? 0) + 1);
        }
        const doubled = [...byIdentity.entries()].filter(([, n]) => n > 1);
        expect(
          doubled.length === 0,
          req('openwop.requirement.0158.duplicate-delivery', 'RFC 0158 §C', `the effect ledger MUST agree with the destination: no effect identity recorded more than once — ${byIdentity.size} identity/identities, ${doubled.length} recorded more than once${doubled.length ? ` (${doubled.map(([k, n]) => `${k}×${n}`).join(', ')})` : ''}`),
        ).toBe(true);
      }
    } finally {
      await new Promise<void>((r) => rx.server.close(() => r()));
    }
  }, 180_000);

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
