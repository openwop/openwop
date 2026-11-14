/**
 * RFC 0265 — pure judges for `v2-compensation-unwind.test.ts`. The scenario runs
 * the `conformance-compensate-unwind` fixture (three compensable effects, then a
 * node that fails) and records the run's event log, its compensation projection
 * and its effect ledger; these functions decide each leg from those reads, so
 * the self-tests can fail every wrong host answer without a host.
 *
 * Attribution of effect-ledger rows. The ledger projection carries no
 * forward/inverse marker (`schemas/v2/effect-ledger-projection.schema.json`:
 * `effectId, nodeId, attempt, keying, state, at`), and a host may record an
 * inverse under the forward node's id or under one of its own. So a row is
 * attributed by elimination, using only what the fixture fixes:
 *   - the FORWARD record of each effect node is that node's earliest row by `at`
 *     (the forward runs once, deterministically, before the failure);
 *   - rows for the failing node are neither (it performs no effect);
 *   - every other row is an INVERSE record — the fixture has nothing else that
 *     could put a row on the ledger.
 * A ledger with no row for some effect node never recorded its forward effect,
 * so the inverse count is not measurable there (RFC 0265 risk R1: the host did
 * not map the reserved node to a ledgered effect). That is `blocked`, never a
 * failure.
 *
 * @see RFCS/0265-compensation-unwind-witness.md
 * @see spec/v2/core/security-defaults.md §Compensation
 */

import { refiredAttempts, type EffectRow } from './effect-refire.js';

export interface Finding { readonly ok: boolean; readonly message: string }
export interface Ev { readonly type?: unknown; readonly nodeId?: unknown; readonly sequence?: unknown; readonly payload?: unknown }
export interface LedgerRow extends EffectRow { readonly effectId?: unknown; readonly state?: unknown }
export interface Attempt { readonly nodeId?: unknown; readonly attempt?: unknown; readonly outcome?: unknown; readonly at?: unknown }
export interface Projection { readonly status?: unknown; readonly plan?: unknown; readonly attempts?: unknown }

/** The fixture's three compensable effect nodes, in forward order, and its failing node. */
export const EFFECT_NODES: readonly string[] = ['e1', 'e2', 'e3'];
export const FAIL_NODE = 'fail';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const f = (ok: boolean, message: string): Finding => ({ ok, message });
const seqOf = (e: Ev): number => (typeof e.sequence === 'number' ? e.sequence : Number.NaN);
const nodeOf = (e: Ev): unknown => e.nodeId ?? (isRec(e.payload) ? e.payload['nodeId'] : undefined);
const atOf = (r: LedgerRow): number => (typeof r.at === 'string' ? Date.parse(r.at) : Number.NaN);
const bySeq = (log: readonly Ev[]): Ev[] => log.filter((e) => Number.isFinite(seqOf(e))).sort((a, b) => seqOf(a) - seqOf(b));

/** Compensation events that end an unwind (asyncapi `compensation.*`). */
export const COMPENSATION_TERMINAL = new Set(['compensation.completed', 'compensation.failed', 'compensation.manual-intervention-required']);
/** Projection statuses an unwind can rest in (compensation-projection.schema.json). */
export const PROJECTION_SETTLED = new Set(['completed', 'partial', 'failed', 'manual-intervention']);

/**
 * The order the effect nodes FORWARD-completed: the first `node.completed` per
 * node, by log sequence. An inverse executed under the same node id may emit a
 * later `node.completed`; the first one is the forward.
 */
export function forwardCompletionOrder(log: readonly Ev[], nodes: readonly string[] = EFFECT_NODES): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of bySeq(log)) {
    const n = nodeOf(e);
    if (e.type === 'node.completed' && typeof n === 'string' && nodes.includes(n) && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

/** Leg 1 — `compensation.requested` precedes the first `compensation.started`, and both are present. */
export function judgePlanBeforeInverse(log: readonly Ev[]): Finding[] {
  const ordered = bySeq(log);
  const requested = ordered.find((e) => e.type === 'compensation.requested');
  const started = ordered.find((e) => e.type === 'compensation.started');
  return [
    f(started !== undefined, 'the fixture commits three effects and then fails on a `node-failure` trigger, so an unwind is owed: the log MUST hold `compensation.started` — it holds none, so no inverse action ever began'),
    f(requested !== undefined, 'the log MUST hold `compensation.requested` (the plan is durable) before any inverse action executes — it holds none'),
    f(requested !== undefined && started !== undefined && seqOf(requested) < seqOf(started),
      `\`compensation.started\` MUST follow \`compensation.requested\` (asyncapi): requested at sequence ${requested === undefined ? 'none' : seqOf(requested)}, first started at ${started === undefined ? 'none' : seqOf(started)}`),
  ];
}

/**
 * Leg 2 — the projection's `attempts[]` names the effect nodes in the reverse of
 * their forward completion order. Judged on the array order of each node's
 * first attempt; a retried inverse (a second attempt for the same node) does
 * not reorder the plan.
 */
export function judgeReverseCompletion(forwardOrder: readonly string[], attempts: readonly Attempt[], nodes: readonly string[] = EFFECT_NODES): Finding[] {
  const expected = [...forwardOrder].reverse();
  const actual: string[] = [];
  for (const a of attempts) {
    if (typeof a.nodeId === 'string' && nodes.includes(a.nodeId) && !actual.includes(a.nodeId)) actual.push(a.nodeId);
  }
  return [
    f(actual.length === nodes.length, `attempts[] MUST name every compensable node (${nodes.join(', ')}) — it names ${actual.length === 0 ? 'none' : actual.join(', ')}`),
    f(JSON.stringify(actual) === JSON.stringify(expected), `orderingModel reverse-completion: attempts[] MUST run in the reverse of forward completion — forward completed ${forwardOrder.join(' → ')}, so attempts MUST read ${expected.join(', ')}; they read ${actual.join(', ') || '(none)'}`),
  ];
}

export interface LedgerSplit {
  /** Effect nodes with no ledger row at all (forward effect not recorded). */
  readonly missingForward: readonly string[];
  readonly forward: ReadonlyMap<string, LedgerRow>;
  readonly inverse: readonly LedgerRow[];
}

/** Attribute ledger rows to forward and inverse records (see the module comment). */
export function splitLedger(rows: readonly LedgerRow[], nodes: readonly string[] = EFFECT_NODES, failNode: string = FAIL_NODE): LedgerSplit {
  const forward = new Map<string, LedgerRow>();
  for (const n of nodes) {
    const mine = rows.filter((r) => r.nodeId === n).sort((a, b) => atOf(a) - atOf(b));
    const first = mine[0];
    if (first !== undefined) forward.set(n, first);
  }
  const forwardRows = new Set<LedgerRow>(forward.values());
  return {
    missingForward: nodes.filter((n) => !forward.has(n)),
    forward,
    inverse: rows.filter((r) => !forwardRows.has(r) && r.nodeId !== failNode),
  };
}

/**
 * Leg 3 — exactly one inverse record per forward effect, each performed once.
 * Call only when `split.missingForward` is empty (otherwise the leg is blocked).
 * A second record for one inverse (an unstable identity, or a re-execution)
 * shows as a fourth row or a repeated effect; both fail.
 */
export function judgeInverseOnce(split: LedgerSplit, nodes: readonly string[] = EFFECT_NODES): Finding[] {
  const inv = split.inverse;
  const ids = new Set(inv.map((r) => String(r.effectId)));
  const out: Finding[] = [
    f(inv.length === nodes.length, `the effect ledger MUST hold exactly ${nodes.length} inverse records, one per forward effect — it holds ${inv.length} beyond the forward records: ${JSON.stringify(inv).slice(0, 300)}`),
    f(ids.size === inv.length, `each inverse effect MUST be performed once — ${inv.length} inverse record(s) carry ${ids.size} distinct effectId(s), so an inverse was recorded more than once`),
  ];
  // Where the host records inverses under the forward node's id, the per-node
  // distribution is observable too; under its own ids it is not, and the count
  // above is the whole witness.
  const attributable = inv.filter((r) => typeof r.nodeId === 'string' && nodes.includes(r.nodeId));
  if (attributable.length === inv.length && inv.length > 0) {
    for (const n of nodes) {
      const c = attributable.filter((r) => r.nodeId === n).length;
      out.push(f(c === 1, `node ${n}'s forward effect MUST have exactly one inverse record — it has ${c}`));
    }
  }
  return out;
}

/** Leg 4 — the projection agrees with the log: `completed` iff `compensation.completed`; `plan[]` names the effect nodes. */
export function judgeProjectionAgrees(projection: Projection, log: readonly Ev[], nodes: readonly string[] = EFFECT_NODES): Finding[] {
  const logged = log.some((e) => e.type === 'compensation.completed');
  const status = projection.status;
  const plan = Array.isArray(projection.plan) ? (projection.plan as unknown[]) : [];
  const planned = [...new Set(plan.map((p) => (isRec(p) ? p['nodeId'] : undefined)).filter((n): n is string => typeof n === 'string'))].sort();
  const want = [...nodes].sort();
  return [
    f((status === 'completed') === logged, `the projection's status MUST be "completed" exactly when the log holds compensation.completed — status is ${JSON.stringify(status)}, the log ${logged ? 'holds' : 'does not hold'} compensation.completed`),
    f(JSON.stringify(planned) === JSON.stringify(want), `plan[] MUST name the three compensable nodes (${want.join(', ')}) — it names ${planned.length === 0 ? 'none' : planned.join(', ')}`),
  ];
}

/**
 * Leg 5 — the records a replay fork's ledger holds that the parent's never did.
 * Every such row is newly performed work, and on a replay fork of this fixture
 * that can only be a re-fired forward or a re-fired inverse. The two are not
 * separable on the wire: a fork ledger keyed per run, re-firing only the
 * inverses under the forward nodes' ids, looks exactly like one that re-fired
 * the forwards. So the judge counts every fresh row; a re-fired forward breaks
 * the same suppression rule (replay.md §Suppression rule 1) and is not a pass
 * either. `refiredAttempts` treats a fork row that repeats a parent attempt's
 * `(nodeId, attempt, at)` as inherited history.
 */
export function refiredOnFork(parent: readonly LedgerRow[], fork: readonly LedgerRow[]): LedgerRow[] {
  return refiredAttempts(parent, fork);
}
