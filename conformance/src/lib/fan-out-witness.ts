/**
 * RFC 0243 G2: the `agents.fanOut` breadth and per-item witnesses, fixture
 * runs through `POST /runs`, `events/poll` and `GET /runs/{runId}`. No seam:
 * each fixture's supervisor carries a `mockDispatchPlan`, so the decision is
 * the fixture's, not a model's.
 *
 * Waves (`spec/v2/facets/agents.schema.json` §fanOut `maxFanOut`: "the
 * effective concurrency is `min(config.maxConcurrency ?? ∞, maxFanOut ?? ∞)`,
 * children beyond it are dispatched in waves and none is dropped"), on
 * `conformance-dispatch-fanout-waves` (three `conformance-delay` children,
 * `maxConcurrency: 2`):
 *   the parallel path records one `dispatch.fanned-out` (`childCount` 3, any
 *   `maxConcurrency` within the effective ceiling) and one `dispatch.joined`
 *   (3 completed, none failed, `mergeOrder` of 3); three child runs complete;
 *   and no more than the ceiling of them are in flight at once, judged from
 *   each child's `startedAt`..`completedAt`.
 *
 * Per-item input (the facet's `perItemInput`; `orchestrator-decision.schema.json`
 * `nextWorkerInputs`), on `conformance-dispatch-per-item` (one child workflow
 * twice, items `item-a` and `item-b`):
 *   honored      at `perItemInput: true`, two children are dispatched and
 *                their `inputs.childGreeting` are the two items;
 *   fail closed  otherwise, the dispatch node fails `validation_error` and no
 *                child is dispatched.
 * Length mismatch (`nextWorkerInputs`: "`nextWorkerInputs.length` MUST equal
 * `nextWorkerIds.length`"), on `conformance-dispatch-per-item-mismatch`: on
 * every dispatch host, the dispatch node fails `validation_error` and no child
 * is dispatched.
 *
 * Fail closed is also read as satisfied by a `400 validation_error` at
 * `createRun` with no run: either way no child exists, which is the hazard.
 *
 * The drivers observe and assert nothing; the judges are pure, proven in
 * `fan-out-witness.test.ts`.
 */

import { isFixtureAdvertised } from './fixtures.js';
import type { MajorProfile } from './major-profile.js';
import {
  finding, isRecord, observed, observeRun, readRun, runCompleted, skip,
  type Ev, type Finding, type ObservedRun, type ObserveOpts, type Outcome, type RunRead, type Skip,
} from './fixture-run-observer.js';

export const WAVES_FIXTURE = 'conformance-dispatch-fanout-waves';
export const WAVES_CHILD = 'conformance-delay';
export const PER_ITEM_FIXTURE = 'conformance-dispatch-per-item';
export const PER_ITEM_MISMATCH_FIXTURE = 'conformance-dispatch-per-item-mismatch';
export const PER_ITEM_CHILD = 'conformance-dispatch-input-mapping-child';
export const PER_ITEM_VALUES = ['item-a', 'item-b'] as const;
export const DISPATCH_NODE = 'dispatch';
/** The fixture's `maxConcurrency`. */
export const WAVES_MAX_CONCURRENCY = 2;
export const WAVES_CHILDREN = 3;
/**
 * Two child windows that touch within this many milliseconds are not counted as
 * overlapping: a host stamps a child's `completedAt` and the next child's
 * `startedAt` from separate clocks reads. A real breach overlaps by a whole
 * `conformance-delay` (1000 ms by default).
 */
export const OVERLAP_TOLERANCE_MS = 100;

const DOC_FANOUT = 'agents.schema.json §fanOut';
const DOC_ITEMS = 'orchestrator-decision.schema.json nextWorkerInputs';

export interface FanOutObservation {
  readonly run: ObservedRun;
  /** Child run ids in dispatch order, from `node.dispatched` (else the join's `mergeOrder`). */
  readonly childRunIds: readonly string[];
  readonly children: readonly RunRead[];
  /** `fannedType` / `joinedType` / `dispatchedType`: this major's event names. */
  readonly types: { readonly fanned: string; readonly joined: string; readonly dispatched: string };
}

export interface WavesObservation extends FanOutObservation {
  /** `min(maxConcurrency, maxFanOut ?? ∞)`. */
  readonly ceiling: number;
}

export interface PerItemObservation extends FanOutObservation {
  /** The host advertises `agents.fanOut.perItemInput: true`. */
  readonly perItemInput: boolean;
  /** The `createRun` body, for a refusal there. */
  readonly createBody: unknown;
}

function eventTypes(profile: MajorProfile): Skip | FanOutObservation['types'] {
  const fanned = profile.eventType('core.dispatch.fanOut');
  const joined = profile.eventType('core.dispatch.join');
  if (fanned === undefined || joined === undefined) return skip('blocked', 'the event codemap is not on disk in this layout — the suite will not guess an event name');
  return { fanned, joined, dispatched: profile.eventType('node.dispatched') ?? 'node.dispatched' };
}

/** `agents.dispatch: true`, and the fixtures. */
function dispatchGate(profile: MajorProfile, doc: unknown, fixtures: readonly string[]): Skip | { readonly agents: Record<string, unknown> } {
  const agents = profile.family(doc, 'agents');
  if (agents === null || agents['dispatch'] !== true) return skip('inapplicable', 'the host does not advertise agents.dispatch: true, so core.dispatch does not bind it');
  for (const id of fixtures) if (!isFixtureAdvertised(id)) return skip('inapplicable', `fixture ${id} is not advertised — the fixture is the opt-in`);
  return { agents };
}

/** `agents.fanOut` admitting a `wait-all` join with `collect`, and the fixtures. */
export function wavesGate(profile: MajorProfile, doc: unknown): Skip | { ceiling: number } {
  const g = dispatchGate(profile, doc, [WAVES_FIXTURE, WAVES_CHILD]);
  if ('kind' in g) return g;
  const f = g.agents['fanOut'];
  if (!isRecord(f)) return skip('inapplicable', 'the host does not advertise agents.fanOut, so it runs no parallel fan-out (the race fixture witnesses its refusal)');
  const has = (k: string, v: string): boolean => Array.isArray(f[k]) && (f[k] as unknown[]).includes(v);
  if (!has('joinModes', 'wait-all') || !has('onChildFailureModes', 'collect')) return skip('inapplicable', 'agents.fanOut does not admit a wait-all join with collect, which this fixture pins');
  const max = typeof f['maxFanOut'] === 'number' && f['maxFanOut'] >= 1 ? f['maxFanOut'] : Infinity;
  return { ceiling: Math.min(WAVES_MAX_CONCURRENCY, max) };
}

/** `agents.dispatch: true` and the per-item fixture (or the mismatch fixture) plus its child. */
export function perItemGate(profile: MajorProfile, doc: unknown, fixture: string): Skip | { perItemInput: boolean } {
  const g = dispatchGate(profile, doc, [fixture, PER_ITEM_CHILD]);
  if ('kind' in g) return g;
  const f = g.agents['fanOut'];
  return { perItemInput: isRecord(f) && f['perItemInput'] === true };
}

/** The dispatched children of one workflow, in log order: `node.dispatched`, else the join's `mergeOrder`. */
export function locateChildren(events: readonly Ev[], types: FanOutObservation['types'], childWorkflowId: string): string[] {
  const ids = events
    .filter((e) => e.type === types.dispatched && e.payload['childWorkflowId'] === childWorkflowId && typeof e.payload['childRunId'] === 'string')
    .map((e) => e.payload['childRunId'] as string);
  if (ids.length > 0) return [...new Set(ids)];
  const join = events.find((e) => e.type === types.joined);
  const mo = join?.payload['mergeOrder'];
  return Array.isArray(mo) ? [...new Set(mo.filter((x): x is string => typeof x === 'string'))] : [];
}

async function follow(profile: MajorProfile, workflowId: string, child: string, types: FanOutObservation['types'], opts: ObserveOpts): Promise<FanOutObservation & { createBody: unknown }> {
  const run = await observeRun(profile, workflowId, { timeoutMs: 45_000, ...opts });
  const childRunIds = locateChildren(run.events, types, child);
  const children = await Promise.all(childRunIds.map((id) => readRun(profile, id)));
  return { run, childRunIds, children, types, createBody: run.createBody };
}

/** Run the waves fixture and read its children. Asserts nothing. */
export async function driveWaves(profile: MajorProfile, doc: unknown, opts: ObserveOpts = {}): Promise<Skip | WavesObservation> {
  const g = wavesGate(profile, doc);
  if ('kind' in g) return g;
  const types = eventTypes(profile);
  if ('kind' in types) return types;
  return { ...(await follow(profile, WAVES_FIXTURE, WAVES_CHILD, types, opts)), ceiling: g.ceiling };
}

/** Run a per-item fixture and read its children. Asserts nothing. */
export async function drivePerItem(profile: MajorProfile, doc: unknown, fixture: string, opts: ObserveOpts = {}): Promise<Skip | PerItemObservation> {
  const g = perItemGate(profile, doc, fixture);
  if ('kind' in g) return g;
  const types = eventTypes(profile);
  if ('kind' in types) return types;
  return { ...(await follow(profile, fixture, PER_ITEM_CHILD, types, opts)), perItemInput: g.perItemInput };
}

const ofType = (o: FanOutObservation, t: string): Ev[] => o.run.events.filter((e) => e.type === t && (e.nodeId === undefined || e.nodeId === DISPATCH_NODE));
const time = (v: unknown): number | undefined => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : undefined);

/** The largest number of `[start, end]` windows in flight at once, ignoring touches within `tolerance`. Pure. */
export function maxInFlight(windows: ReadonlyArray<readonly [number, number]>, tolerance = OVERLAP_TOLERANCE_MS): number {
  if (windows.length === 0) return 0;
  // A window counts from `tolerance` after its start; one shorter than that cannot overlap anything.
  const points = windows.filter(([s, e]) => s + tolerance < e).flatMap(([s, e]) => [[s + tolerance, 1], [e, -1]] as const);
  // At the same instant an end closes before a start opens, so touching windows never overlap.
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let best = 1;
  for (const [, d] of points) { cur += d; best = Math.max(best, cur); }
  return best;
}

/** Leg: waves within the ceiling, none dropped. Pure. */
export function judgeWaves(o: WavesObservation): Outcome {
  const fanned = ofType(o, o.types.fanned);
  const joined = ofType(o, o.types.joined);
  const f = fanned[0]?.payload ?? {};
  const j = joined[0]?.payload ?? {};
  const mc = f['maxConcurrency'];
  const windows = o.children.map((c) => [time(c.snapshot['startedAt']), time(c.snapshot['completedAt'])] as const);
  const timed = windows.every(([s, e]) => s !== undefined && e !== undefined);
  const findings: Finding[] = [
    ...runCompleted(o.run),
    finding(fanned.length === 1, `${DOC_FANOUT} (run-event-payloads dispatchFanOut)`, `a parallel dispatch MUST record one ${o.types.fanned} (got ${fanned.length})`),
    finding(f['childCount'] === WAVES_CHILDREN, `${DOC_FANOUT} (none is dropped)`, `${o.types.fanned}.childCount MUST be ${WAVES_CHILDREN}, every child the decision named (got ${JSON.stringify(f['childCount'])})`),
    finding(mc === undefined || (typeof mc === 'number' && mc <= o.ceiling), `${DOC_FANOUT} (effective concurrency is min(maxConcurrency, maxFanOut))`, `${o.types.fanned}.maxConcurrency MUST NOT exceed ${o.ceiling} (got ${JSON.stringify(mc)})`),
    finding(joined.length === 1, `${DOC_FANOUT} (run-event-payloads dispatchJoin)`, `the wait-all join MUST record one ${o.types.joined} (got ${joined.length})`),
    finding(j['completedCount'] === WAVES_CHILDREN && j['failedCount'] === 0, `${DOC_FANOUT} (none is dropped)`, `${o.types.joined} MUST count ${WAVES_CHILDREN} completed and 0 failed (got ${JSON.stringify({ completedCount: j['completedCount'], failedCount: j['failedCount'] })})`),
    finding(Array.isArray(j['mergeOrder']) && j['mergeOrder'].length === WAVES_CHILDREN, `${DOC_FANOUT} (run-event-payloads dispatchJoin.mergeOrder)`, `${o.types.joined}.mergeOrder MUST list all ${WAVES_CHILDREN} children (got ${JSON.stringify(j['mergeOrder'])})`),
    finding(o.childRunIds.length === WAVES_CHILDREN, `${DOC_FANOUT} (none is dropped)`, `${WAVES_CHILDREN} distinct ${WAVES_CHILD} child runs MUST be dispatched (found ${o.childRunIds.length})`),
    ...o.children.map((c, i) => finding(c.status === 200 && c.snapshot['status'] === 'completed', `fixtures.md ${WAVES_CHILD}`, `child run ${o.childRunIds[i]} MUST be readable and end completed (GET ${c.status}, status ${JSON.stringify(c.snapshot['status'])})`)),
  ];
  if (timed && o.children.length > 0) {
    const n = maxInFlight(windows as ReadonlyArray<readonly [number, number]>);
    findings.push(finding(n <= o.ceiling, `${DOC_FANOUT} (children beyond the ceiling are dispatched in waves)`, `no more than ${o.ceiling} children may be in flight at once (${n} overlapped by more than ${OVERLAP_TOLERANCE_MS} ms)`));
  }
  return observed(findings);
}

/** The dispatch node failed `validation_error` and no child exists — at run time, or by a `400` at `createRun`. Pure. */
export function judgeFailClosed(o: FanOutObservation & { createBody: unknown }, doc: string, why: string): Outcome {
  const r = o.run;
  if (r.createStatus === 400) {
    const err = isRecord(o.createBody) ? o.createBody['error'] : undefined;
    return observed([finding(err === 'validation_error', doc, `${why}: a refusal at createRun MUST be 400 validation_error (got ${JSON.stringify(err)})`)]);
  }
  const failed = r.events.filter((e) => e.type === 'node.failed' && e.nodeId === DISPATCH_NODE);
  const code = isRecord(failed[0]?.payload['error']) ? failed[0]!.payload['error']['code'] : undefined;
  return observed([
    finding(r.createStatus === 201 || r.createStatus === 202, 'runs.md createRun', `createRun of ${r.workflowId} MUST be accepted or refused 400 validation_error (got ${r.createStatus})`),
    finding(code === 'validation_error', doc, `${why}: the dispatch node MUST fail with validation_error (node.failed ${failed.length === 0 ? 'absent' : `code ${JSON.stringify(code)}`})`),
    finding(o.childRunIds.length === 0 && ofType(o, o.types.dispatched).length === 0, doc, `${why}: no child may be dispatched (found ${o.childRunIds.length})`),
    finding(r.terminalStatus === 'failed', doc, `the run MUST end failed (got ${String(r.terminalStatus)})`),
  ]);
}

/** Leg: at `perItemInput: true` each child receives its own item; otherwise fail closed. Pure. */
export function judgePerItem(o: PerItemObservation): Outcome {
  if (!o.perItemInput) return judgeFailClosed(o, `${DOC_FANOUT} perItemInput; ${DOC_ITEMS}`, 'a host without agents.fanOut.perItemInput: true receiving non-empty nextWorkerInputs');
  const got = o.children.map((c) => (isRecord(c.snapshot['inputs']) ? c.snapshot['inputs']['childGreeting'] : undefined));
  const sorted = [...got].map(String).sort();
  return observed([
    ...runCompleted(o.run),
    finding(o.childRunIds.length === PER_ITEM_VALUES.length, `${DOC_ITEMS} (index-aligned with nextWorkerIds)`, `${PER_ITEM_VALUES.length} ${PER_ITEM_CHILD} child runs MUST be dispatched (found ${o.childRunIds.length})`),
    ...o.children.map((c, i) => finding(c.status === 200, 'runs.md getRun', `child run ${o.childRunIds[i]} MUST be readable (GET ${c.status})`)),
    finding(JSON.stringify(sorted) === JSON.stringify([...PER_ITEM_VALUES]), `${DOC_FANOUT} perItemInput; ${DOC_ITEMS}`, `each child MUST receive its own nextWorkerInputs[i]: inputs.childGreeting MUST be ${JSON.stringify(PER_ITEM_VALUES)} across the children (got ${JSON.stringify(got)})`),
  ]);
}

/** Leg: a length mismatch fails the dispatch node and dispatches no child. Pure. */
export function judgeLengthMismatch(o: PerItemObservation): Outcome {
  return judgeFailClosed(o, DOC_ITEMS, 'nextWorkerInputs.length differs from nextWorkerIds.length');
}
