/**
 * The run execution-bounds witness (`runs.md` §`run` section; RFC 0058), shared
 * by every major that gives a run a wire surface for `runTimeoutMs`.
 *
 * Three legs:
 *   shape       advertised `limits.maxRunDurationMs` is an integer ≥ 1000 and
 *               `limits.maxLoopIterations` an integer ≥ 1, when present;
 *   refused     an out-of-range `runTimeoutMs` (0, below the schema minimum of 1)
 *               is refused `400 validation_error` at create — unaided;
 *   breach      a run of the `conformance-run-duration-breach` fixture with a
 *               1 s `runTimeoutMs` ends `failed` with `run_timeout` and emits
 *               `cap.breached { kind: 'run-duration' }` with `observed > limit`.
 *
 * Two halves: the drivers observe and assert nothing; {@link judgeBreach} is pure,
 * proven in `run-bounds-witness.test.ts`.
 */

import { driver } from './driver.js';
import { readErrorCode } from './error-envelope.js';
import { isFixtureAdvertised } from './fixtures.js';
import type { MajorProfile } from './major-profile.js';

export const TIMEOUT_FIXTURE = 'conformance-run-duration-breach';
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface BoundsFinding { readonly ok: boolean; readonly doc: string; readonly message: string }
export type BoundsOutcome =
  | { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
  | { readonly kind: 'observed'; readonly findings: readonly BoundsFinding[] };

const DOC = 'runs.md §run section';
const f = (ok: boolean, message: string): BoundsFinding => ({ ok, doc: DOC, message });

/** The `run` section fragment that carries a `runTimeoutMs` at this major. */
function runTimeout(profile: MajorProfile, ms: number): Record<string, unknown> {
  return profile.major >= 2 ? { configurable: { version: 1, run: { runTimeoutMs: ms } } } : { configurable: { runTimeoutMs: ms } };
}

/** Leg 1, shape: judged from the discovery record alone. */
export function shapeLeg(profile: MajorProfile, discovery: unknown): BoundsOutcome {
  const limits = profile.family(discovery, 'limits');
  if (limits === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise limits' };
  const findings: BoundsFinding[] = [];
  const dur = limits['maxRunDurationMs'];
  const loops = limits['maxLoopIterations'];
  if (dur !== undefined) findings.push(f(Number.isInteger(dur) && (dur as number) >= 1000, `limits.maxRunDurationMs MUST be an integer >= 1000 when present (got ${JSON.stringify(dur)})`));
  if (loops !== undefined) findings.push(f(Number.isInteger(loops) && (loops as number) >= 1, `limits.maxLoopIterations MUST be an integer >= 1 when present (got ${JSON.stringify(loops)})`));
  if (findings.length === 0) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host advertises neither limits.maxRunDurationMs nor limits.maxLoopIterations' };
  return { kind: 'observed', findings };
}

/** Leg 2, refused: an out-of-range runTimeoutMs is refused at create. Unaided: any advertised fixture names a valid workflow. */
export async function refusedLeg(profile: MajorProfile, workflowId: string | undefined): Promise<BoundsOutcome> {
  if (workflowId === undefined) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host advertises no fixture workflow to name in a create, so a refusal cannot be told from an unknown workflow' };
  const res = await driver.post(profile.runsPath, { workflowId, ...runTimeout(profile, 0) });
  if (res.status === 201 || res.status === 202) {
    const runId = isRecord(res.json) ? res.json['runId'] : undefined;
    if (typeof runId === 'string') await driver.post(`${profile.runsPath}/${profile.idSegment(runId)}/cancel`, {}).catch(() => undefined);
  }
  return { kind: 'observed', findings: [
    f(res.status === 400, `runTimeoutMs: 0 (below the minimum of 1) MUST be refused 400 at create (got ${res.status})`),
    f(readErrorCode(res.json) === 'validation_error', `the refusal MUST carry validation_error (got ${String(readErrorCode(res.json))})`),
  ] };
}

export interface BreachObservation {
  readonly createStatus: number;
  readonly terminalStatus: string | undefined;
  readonly errorCode: string | undefined;
  readonly breach: Record<string, unknown> | undefined;
}

/** Leg 3, breach, observed: a fixture run with a 1 s runTimeoutMs. Asserts nothing. */
export async function driveBreach(profile: MajorProfile, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<Extract<BoundsOutcome, { kind: 'skip' }> | BreachObservation> {
  if (!isFixtureAdvertised(TIMEOUT_FIXTURE)) return { kind: 'skip', disposition: 'inapplicable', reason: `fixture ${TIMEOUT_FIXTURE} is not advertised — the host does not claim a run long enough to breach a 1 s timeout` };
  const created = await driver.post(profile.runsPath, { workflowId: TIMEOUT_FIXTURE, ...runTimeout(profile, 1000) });
  const runId = isRecord(created.json) ? created.json['runId'] : undefined;
  if ((created.status !== 201 && created.status !== 202) || typeof runId !== 'string') {
    return { createStatus: created.status, terminalStatus: undefined, errorCode: readErrorCode(created.json), breach: undefined };
  }
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  let snap: Record<string, unknown> = {};
  for (;;) {
    const r = await driver.get(`${profile.runsPath}/${profile.idSegment(runId)}`);
    snap = isRecord(r.json) ? r.json : {};
    if (['completed', 'failed', 'cancelled'].includes(String(snap['status'])) || Date.now() > deadline) break;
    await new Promise((res) => setTimeout(res, opts.pollMs ?? 500));
  }
  const poll = await driver.get(`${profile.runsPath}/${profile.idSegment(runId)}/events/poll`);
  const events = ((poll.json as { events?: unknown } | undefined)?.events as Array<Record<string, unknown>> | undefined) ?? [];
  const capType = profile.eventType('cap.breached') ?? 'cap.breached';
  const breach = events.find((e) => e['type'] === capType);
  const err = isRecord(snap['error']) ? snap['error'] : undefined;
  return { createStatus: created.status, terminalStatus: typeof snap['status'] === 'string' ? (snap['status'] as string) : undefined, errorCode: typeof err?.['code'] === 'string' ? (err['code'] as string) : undefined, breach: isRecord(breach?.['payload']) ? (breach!['payload'] as Record<string, unknown>) : undefined };
}

/** Leg 3, breach, judged. Pure. */
export function judgeBreach(o: BreachObservation): BoundsFinding[] {
  const out = [f(o.createStatus === 201 || o.createStatus === 202, `a create with runTimeoutMs: 1000 MUST be accepted (got ${o.createStatus})`)];
  if (!out[0]!.ok) return out;
  const observed = o.breach?.['observed'];
  const limit = o.breach?.['limit'];
  out.push(
    f(o.terminalStatus === 'failed', `a run exceeding runTimeoutMs MUST end failed (got ${String(o.terminalStatus)})`),
    f(o.errorCode === 'run_timeout', `the run's error.code MUST be run_timeout (got ${String(o.errorCode)})`),
    f(o.breach !== undefined, 'a cap.breached event MUST be emitted on the breach'),
    f(o.breach?.['kind'] === 'run-duration', `cap.breached.kind MUST be run-duration (got ${String(o.breach?.['kind'])})`),
    f(typeof observed === 'number' && typeof limit === 'number' && observed > limit, `cap.breached.observed MUST exceed limit (got observed=${String(observed)}, limit=${String(limit)})`),
  );
  return out;
}
