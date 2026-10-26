/**
 * RFC 0252 — an eval task takes its fixtures from a recorded run. Pure judges
 * over four sequential eval runs, for `v2-eval-recorded-fixtures.test.ts`.
 *
 * The runs go through the suite-owned counter tool `conformance.eval:counter`,
 * whose live `inc` changes persistent tenant-scoped state (contract in
 * `fixtures.md`):
 *   1. source  `conformance-eval-recorded-source` (live): read P, inc R, read R.
 *   2. replay  `conformance-eval-recorded-replay`, `fixtureRuns: {record: source}`:
 *      the same script, served the source's recorded answers.
 *   3. drift   `conformance-eval-recorded-drift`, the same source: read P,
 *      inc P, read R. The `inc P` was never recorded, so it misses.
 *   4. probe   the source suite again, live.
 * The probe's `inc R` is the source's plus one when neither the replay nor
 * the drift reached the live counter, and its `read P` equals the source's
 * when the drift's missed `inc P` never ran. Persistence not shown, or a
 * counter that moved by more than the replay could explain (a concurrent cut
 * on the tenant), is `blocked`, never a failure.
 *
 * @see RFCS/0252-eval-fixtures-from-a-recorded-run.md
 */

import type { CounterCall } from './eval-counter-witness.js';

export interface RecordedFinding { readonly ok: boolean; readonly message: string }
export type RecordedVerdict =
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'judged'; readonly findings: readonly RecordedFinding[] };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (c: CounterCall | undefined): number | undefined => {
  const o = c?.outcome;
  return isRec(o) && typeof o['count'] === 'number' && Number.isInteger(o['count']) ? o['count'] : undefined;
};

export const TASK = 'record';

/** The summary entry for task `record`. */
export function recordTask(summary: Rec): Rec | undefined {
  const tasks = summary['tasks'];
  return Array.isArray(tasks) ? tasks.find((t): t is Rec => isRec(t) && t['taskId'] === TASK) : undefined;
}

/** A source or probe run: read P, inc R, read R, all answered live with `{key, count}`. */
function liveCounts(calls: readonly CounterCall[], label: string): { P: number; R: number } | { reason: string } {
  if (calls.length !== 3) return { reason: `the ${label} run MUST log its three scripted counter calls (got ${calls.length})` };
  const [p, r] = [count(calls[0]), count(calls[1])];
  if (p === undefined || r === undefined) return { reason: `the ${label} run's counter calls did not all return {key, count} live` };
  return { P: p, R: r };
}

/** §E: `eval.started.fixtureRuns` is the accepted map verbatim. */
export function judgeEchoed(events: readonly { type: string; payload: Rec }[], sent: Rec): RecordedFinding[] {
  const started = events.filter((e) => e.type === 'eval.started');
  const got = started[0]?.payload['fixtureRuns'];
  return [{ ok: started.length === 1 && JSON.stringify(got) === JSON.stringify(sent), message: `eval.started MUST echo fixtureRuns ${JSON.stringify(sent)} (got ${JSON.stringify(got)})` }];
}

/** §D: the replay was served the source's answers, missed nothing, and the probe shows no live inc R. */
export function judgeReplayed(source: readonly CounterCall[], replay: readonly CounterCall[], replayTask: Rec | undefined, probe: readonly CounterCall[]): RecordedVerdict {
  const s = liveCounts(source, 'source');
  if ('reason' in s) return { kind: 'blocked', reason: s.reason };
  const p = liveCounts(probe, 'probe');
  if ('reason' in p) return { kind: 'blocked', reason: p.reason };
  if (p.R > s.R + 2) return { kind: 'blocked', reason: `counter R moved from ${s.R} to ${p.R} across the replay: more than this scenario can cause, so another run on the tenant is using it` };
  if (p.R <= s.R) return { kind: 'blocked', reason: `counter R did not persist across runs (source ${s.R}, probe ${p.R})` };
  const same = replay.length === source.length && replay.every((c, i) => c.returned && JSON.stringify(c.outcome) === JSON.stringify(source[i]!.outcome));
  return { kind: 'judged', findings: [
    { ok: same, message: `each replayed counter call MUST return the source run's recorded outcome (source ${JSON.stringify(source.map((c) => c.outcome))}, replay ${JSON.stringify(replay.map((c) => c.outcome))})` },
    { ok: replayTask?.['fixtureMissCount'] === 0, message: `a replay of the same script MUST miss nothing (fixtureMissCount ${JSON.stringify(replayTask?.['fixtureMissCount'])})` },
    { ok: p.R === s.R + 1, message: `the replay MUST NOT reach the live counter: the probe's inc R MUST be the source's plus one (source ${s.R}, probe ${p.R})` },
  ] };
}

/** §D: an unrecorded call misses, the task fails, and the missed inc P never ran. */
export function judgeDriftFailsClosed(source: readonly CounterCall[], driftTask: Rec | undefined, driftPassed: unknown, probe: readonly CounterCall[]): RecordedVerdict {
  const s = liveCounts(source, 'source');
  if ('reason' in s) return { kind: 'blocked', reason: s.reason };
  const p = liveCounts(probe, 'probe');
  if ('reason' in p) return { kind: 'blocked', reason: p.reason };
  if (p.R <= s.R) return { kind: 'blocked', reason: `counter R did not persist across runs (source ${s.R}, probe ${p.R}), so an unchanged P proves nothing` };
  return { kind: 'judged', findings: [
    { ok: driftTask?.['fixtureMissCount'] === 1, message: `the one unrecorded call MUST be counted as a miss (fixtureMissCount ${JSON.stringify(driftTask?.['fixtureMissCount'])})` },
    { ok: driftPassed === false, message: `a task with a miss under the derived onMiss "fail" MUST NOT pass (passed ${JSON.stringify(driftPassed)})` },
    { ok: p.P === s.P, message: `the missed inc P MUST NOT reach the live counter: the probe MUST read P as the source did (source ${s.P}, probe ${p.P})` },
  ] };
}
