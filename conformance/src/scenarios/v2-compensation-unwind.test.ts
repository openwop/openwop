/**
 * v2 — compensation behavior, witnessed through a failing fixture (RFC 0265;
 * the rules are `spec/v2/core/security-defaults.md` §Compensation, the
 * `compensation.*` events in `api/v2/asyncapi.yaml` and
 * `schemas/v2/compensation-projection.schema.json`).
 *
 * `v2-compensation-read-projection` reads the projection on a run with nothing
 * to unwind. This scenario makes a host unwind. The `conformance-compensate-unwind`
 * fixture runs three compensable effects (`e1 → e2 → e3`, the conformance-RESERVED
 * `core.conformance.compensable-effect`) and then a node that fails, under a
 * `reverse-completion` policy triggered on `node-failure`. The suite causes that
 * condition unaided and reads the result through normative paths only — the
 * run's event log, `GET /runs/{runId}/compensation` and `GET /runs/{runId}/effects`.
 * No seam is involved: the v1 legs (`compensation-behavior`, `compensation-recovery`)
 * asked a host seam how many effects re-fired, and a host that never compensates
 * can answer 0.
 *
 * One run is shared by every leg (a module-level lazy promise); judges are in
 * `lib/compensation-unwind.ts`.
 *   1. `0265.plan-before-inverse` — `compensation.requested` precedes the first
 *      `compensation.started` in the log (asyncapi: "MUST follow").
 *   2. `0265.reverse-completion`  — the projection's `attempts[]` names `e3, e2, e1`,
 *      the reverse of the forward `node.completed` order.
 *   3. `0265.inverse-once`        — the effect ledger holds exactly three inverse
 *      records, one per forward effect, each performed once.
 *   4. `0265.projection-agrees`   — the projection's `status` is `completed` exactly
 *      when the log holds `compensation.completed`, and `plan[]` names the three
 *      effect nodes.
 *   5. `0265.replay-no-refire`    — a `mode: "replay"` fork adds no newly performed
 *      effect to the fork's ledger (invariant `compensation-replay-no-refire`).
 *
 * Dispositions: `compensation` not advertised, or the fixture not listed ⇒
 * `inapplicable` (every leg). Legs 3 and 5 also need the effect ledger, which
 * idempotency.md §Witness owes only under `idempotency`; leg 5 needs
 * `replay.modes ∋ replay` — absent ⇒ `inapplicable`. A run that cannot be
 * created or finished, a fixture whose effects did not all complete or whose
 * run did not fail, an unreadable projection or ledger, or a ledger with no
 * forward record for an effect node (RFC 0265 R1: the host did not map the
 * reserved node to a ledgered effect) ⇒ `blocked`.
 *
 * @see RFCS/0265-compensation-unwind-witness.md
 * @see spec/v2/core/security-defaults.md §Compensation
 * @see spec/v2/core/replay.md §Suppression
 * @see conformance/fixtures.md `conformance-compensate-unwind`
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, gateFamily, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { projectBoundId } from '../lib/bound-id.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { scaledTimeoutMs } from '../lib/polling.js';
import {
  EFFECT_NODES, COMPENSATION_TERMINAL,
  forwardCompletionOrder, judgePlanBeforeInverse, judgeReverseCompletion, splitLedger,
  judgeInverseOnce, judgeProjectionAgrees, refiredOnFork,
  type Attempt, type Ev, type Finding, type LedgerRow, type Projection,
} from '../lib/compensation-unwind.js';

const FIXTURE = 'conformance-compensate-unwind';
const DOC = 'security-defaults.md §Compensation; asyncapi compensation.*; compensation-projection.schema.json (RFC 0265)';
const ID_PLAN = 'openwop.requirement.0265.plan-before-inverse';
const ID_ORDER = 'openwop.requirement.0265.reverse-completion';
const ID_ONCE = 'openwop.requirement.0265.inverse-once';
const ID_AGREES = 'openwop.requirement.0265.projection-agrees';
const ID_REPLAY = 'openwop.requirement.0265.replay-no-refire';
const RUN_TERMINAL = /^run\.(completed|failed|cancelled)$/;

type Skip = readonly ['inapplicable' | 'blocked', string];
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const assertAll = (id: string, fs: readonly Finding[]): void => { for (const x of fs) expect(x.ok, req(id, DOC, x.message)).toBe(true); };
const seqOf = (e: Ev): number => (typeof e.sequence === 'number' ? e.sequence : Number.NaN);

async function logOf(runId: string): Promise<Ev[]> {
  const res = await http(() => driver.get(`/runs/${projectBoundId(runId)}/events/poll?timeout=1`));
  const body = res?.json;
  const events = isRec(body) ? body['events'] : undefined;
  return Array.isArray(events) ? (events as Ev[]).filter((e) => Number.isFinite(seqOf(e))).sort((a, b) => seqOf(a) - seqOf(b)) : [];
}

/**
 * Poll until the run has a terminal run event and, if an unwind began (or, for
 * the source run, is owed), a compensation terminal event. The compensation
 * tail MAY follow the run's terminal event (replay.md §Refusals), so the run
 * event alone is not the end. On the deadline the log is returned as it stands:
 * an unwind that never finishes is for the legs to judge, not a reason to skip.
 */
async function settle(runId: string, unwindOwed: boolean): Promise<{ log: Ev[] } | { reason: string }> {
  const deadline = Date.now() + scaledTimeoutMs(30_000);
  for (;;) {
    const log = await logOf(runId);
    const ended = log.some((e) => typeof e.type === 'string' && RUN_TERMINAL.test(e.type));
    const begun = unwindOwed || log.some((e) => e.type === 'compensation.requested' || e.type === 'compensation.started');
    const unwound = log.some((e) => typeof e.type === 'string' && COMPENSATION_TERMINAL.has(e.type));
    if (ended && (!begun || unwound)) return { log };
    if (Date.now() > deadline) return ended ? { log } : { reason: `run ${runId} logged no terminal run event within the bound (${log.length} event(s))` };
    await new Promise((r) => setTimeout(r, 250));
  }
}

let disc: Promise<Rec | null> | undefined;
const discovery = (): Promise<Rec | null> => (disc ??= v2Discovery().catch(() => null));

/** The two gates every leg shares: the `compensation` record and the fixture. */
async function gate(): Promise<Skip | null> {
  if (!(await discovery())) return ['blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0'];
  if (!(await gateFamily('compensation'))) return ['inapplicable', 'compensation family not advertised — no obligation (gate recorded under openwop.family.compensation)'];
  if (!isFixtureAdvertised(FIXTURE)) return ['inapplicable', `the host does not advertise fixture ${FIXTURE} (serving it is OPTIONAL, RFC 0265 §A)`];
  return null;
}
async function ledgerGate(): Promise<Skip | null> {
  if (!(await familyAdvertised('idempotency'))) return ['inapplicable', 'the host does not advertise idempotency, so it owes no effect ledger (idempotency.md §Witness) and the inverse records cannot be read'];
  return null;
}

interface Unwind { readonly runId: string; readonly log: Ev[]; readonly projection: OpenWOPResponse | null }

/** The shared source run: start the fixture, wait out the run and its unwind, read the projection. Asserts nothing. */
async function drive(): Promise<{ skip: Skip } | { u: Unwind }> {
  const created = await http(() => driver.post('/runs', { workflowId: FIXTURE }));
  const createdBody = created?.json;
  const runId = isRec(createdBody) ? createdBody['runId'] : undefined;
  if (created === null || created.status !== 201 || typeof runId !== 'string') return { skip: ['blocked', `POST /runs {workflowId: ${FIXTURE}} answered ${created?.status ?? 'nothing'} ${readErrorCode(created?.json) ?? ''}`.trim()] };
  const s = await settle(runId, true);
  if ('reason' in s) return { skip: ['blocked', s.reason] };
  if (!s.log.some((e) => e.type === 'run.failed')) {
    return { skip: ['blocked', `the ${FIXTURE} run did not end run.failed (its terminal node is core.fail), so the condition an unwind exists for was not caused — the host does not serve the fixture as fixtures.md specifies`] };
  }
  const projection = await http(() => driver.get(`/runs/${projectBoundId(runId)}/compensation`));
  return { u: { runId, log: s.log, projection } };
}
let source: Promise<{ skip: Skip } | { u: Unwind }> | undefined;
const once = (): Promise<{ skip: Skip } | { u: Unwind }> => (source ??= drive());

/** The shared source run's effect ledger, read once after the unwind. */
let ledger: Promise<{ skip: Skip } | { rows: LedgerRow[] }> | undefined;
const sourceLedger = (runId: string): Promise<{ skip: Skip } | { rows: LedgerRow[] }> => (ledger ??= (async () => {
  const res = await http(() => driver.get(`/runs/${projectBoundId(runId)}/effects`));
  const body = res?.json;
  const effects = isRec(body) ? body['effects'] : undefined;
  if (res === null || res.status !== 200 || !Array.isArray(effects)) {
    return { skip: ['blocked', `GET /runs/{runId}/effects answered ${res?.status ?? 'nothing'} ${readErrorCode(res?.json) ?? ''} — idempotency.md §Witness owns that contract`.trim()] as const };
  }
  return { rows: effects as LedgerRow[] };
})());

function projectionOf(u: Unwind): { body: Projection } | { skip: Skip } {
  const p = u.projection;
  const body = p?.json;
  if (p === null || p.status !== 200 || !isRec(body)) {
    return { skip: ['blocked', `GET /runs/{runId}/compensation answered ${p?.status ?? 'nothing'} ${readErrorCode(body) ?? ''} on the unwound run — v2-compensation-read-projection owns that obligation`.trim()] };
  }
  return { body };
}

describe('v2 RFC 0265 — compensation unwind through a failing fixture (host)', () => {
  it('compensation.requested precedes the first compensation.started', async () => {
    const g = await gate();
    if (g) return softSkip(...g);
    const s = await once();
    if ('skip' in s) return softSkip(...s.skip);
    assertAll(ID_PLAN, judgePlanBeforeInverse(s.u.log));
  }, 120_000);

  it('the projection attempts the effect nodes in the reverse of their forward completion order', async () => {
    const g = await gate();
    if (g) return softSkip(...g);
    const s = await once();
    if ('skip' in s) return softSkip(...s.skip);
    const forward = forwardCompletionOrder(s.u.log);
    if (forward.length !== EFFECT_NODES.length) {
      return softSkip('blocked', `the log holds a forward node.completed for ${forward.join(', ') || 'none'} of ${EFFECT_NODES.join(', ')}, so there is no forward completion order to reverse`);
    }
    const p = projectionOf(s.u);
    if ('skip' in p) return softSkip(...p.skip);
    const attempts = Array.isArray(p.body.attempts) ? (p.body.attempts as Attempt[]) : [];
    assertAll(ID_ORDER, judgeReverseCompletion(forward, attempts));
  }, 120_000);

  it('the effect ledger holds exactly one inverse record per forward effect', async () => {
    const g = (await gate()) ?? (await ledgerGate());
    if (g) return softSkip(...g);
    const s = await once();
    if ('skip' in s) return softSkip(...s.skip);
    const l = await sourceLedger(s.u.runId);
    if ('skip' in l) return softSkip(...l.skip);
    const split = splitLedger(l.rows);
    if (split.missingForward.length > 0) {
      return softSkip('blocked', `the effect ledger has no record for ${split.missingForward.join(', ')}: the forward effects are absent too, so the host did not map core.conformance.compensable-effect to a ledgered effect (RFC 0265 §A, risk R1) and the inverse count cannot be measured`);
    }
    assertAll(ID_ONCE, judgeInverseOnce(split));
  }, 120_000);

  it('the projection status and plan agree with the event log', async () => {
    const g = await gate();
    if (g) return softSkip(...g);
    const s = await once();
    if ('skip' in s) return softSkip(...s.skip);
    const p = projectionOf(s.u);
    if ('skip' in p) return softSkip(...p.skip);
    assertAll(ID_AGREES, judgeProjectionAgrees(p.body, s.u.log));
  }, 120_000);

  it('a replay fork of the unwound run performs no inverse again', async () => {
    const g = (await gate()) ?? (await ledgerGate());
    if (g) return softSkip(...g);
    const replay = await familyAdvertised('replay');
    if (!replay || !(Array.isArray(replay['modes']) && replay['modes'].includes('replay'))) return softSkip('inapplicable', 'replay.modes does not list replay, so no replay fork can be requested');
    const s = await once();
    if ('skip' in s) return softSkip(...s.skip);
    const l = await sourceLedger(s.u.runId);
    if ('skip' in l) return softSkip(...l.skip);
    const split = splitLedger(l.rows);
    if (split.missingForward.length > 0 || split.inverse.length === 0) {
      return softSkip('blocked', `the source run's ledger records ${split.missingForward.length > 0 ? `no forward effect for ${split.missingForward.join(', ')}` : 'no inverse effect'}, so a fork that also records none would compare nothing against nothing (RFC 0265 R1)`);
    }
    const first = s.u.log[0];
    if (first === undefined) return softSkip('blocked', 'the source run logged no event to fork from');
    const forked = await http(() => driver.post(`/runs/${projectBoundId(s.u.runId)}:fork`, { mode: 'replay', fromSeq: first.sequence }));
    const forkedBody = forked?.json;
    const forkId = isRec(forkedBody) ? forkedBody['runId'] : undefined;
    if (forked === null || forked.status !== 201 || typeof forkId !== 'string') {
      return softSkip('blocked', `POST /runs/{runId}:fork {mode: replay} answered ${forked?.status ?? 'nothing'} ${readErrorCode(forked?.json) ?? ''} on the unwound run`.trim());
    }
    const settled = await settle(forkId, false);
    if ('reason' in settled) return softSkip('blocked', settled.reason);
    const forkLedger = await http(() => driver.get(`/runs/${projectBoundId(forkId)}/effects`));
    const forkLedgerBody = forkLedger?.json;
    const forkRows = isRec(forkLedgerBody) ? forkLedgerBody['effects'] : undefined;
    if (forkLedger === null || forkLedger.status !== 200 || !Array.isArray(forkRows)) {
      return softSkip('blocked', `GET /runs/{runId}/effects answered ${forkLedger?.status ?? 'nothing'} on the replay fork`);
    }
    const refired = refiredOnFork(l.rows, forkRows as LedgerRow[]);
    expect(
      refired.length,
      req(ID_REPLAY, 'replay.md §Suppression; invariant compensation-replay-no-refire (RFC 0265 §B.5)', `a mode: "replay" fork MUST NOT perform an inverse action again — the fork's effect ledger records ${refired.length} effect(s) the source run never made: ${JSON.stringify(refired).slice(0, 300)}`),
    ).toBe(0);
  }, 180_000);
});
