/**
 * RFC 0251 — an eval run names its modes and its regression baseline — and
 * RFC 0244 §F pairing, which RFC 0251 makes causable. Pure judges over two
 * eval runs and the refusals, for `v2-eval-regression-baseline.test.ts`.
 *
 * The fixtures share one `suiteId`. The base run (1.0.0) holds `base-only`
 * (fails), `shared-a` and `shared-b` (pass); the candidate (1.1.0) holds the
 * two shared tasks, unchanged, and `candidate-only` (passes). So the
 * aggregates differ by 1/3 while every paired score is equal: a host that
 * compares aggregates, not paired tasks, would call the candidate `improved`.
 *
 * @see RFCS/0251-eval-run-mode-and-baseline-selection.md
 * @see RFCS/0244-eval-trajectories-trials-and-recorded-fixtures.md §F
 */

import { readErrorCode } from './error-envelope.js';

export interface RegressionFinding { readonly ok: boolean; readonly message: string }
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

export const SHARED_TASKS = ['shared-a', 'shared-b'] as const;

/** §D: both carriers name the requested baseline, and `scoreDelta` is the aggregate difference. */
export function judgeBaselineEchoed(baselineRunId: string, events: readonly { type: string; payload: Rec }[], candidate: Rec, base: Rec): RegressionFinding[] {
  const started = events.filter((e) => e.type === 'eval.started');
  const reg = isRec(candidate['regression']) ? candidate['regression'] : {};
  const want = typeof candidate['aggregateScore'] === 'number' && typeof base['aggregateScore'] === 'number' ? candidate['aggregateScore'] - base['aggregateScore'] : undefined;
  const delta = reg['scoreDelta'];
  return [
    { ok: started.length === 1 && started[0]!.payload['baselineRunId'] === baselineRunId, message: `eval.started MUST carry baselineRunId ${baselineRunId} (got ${JSON.stringify(started.map((e) => e.payload['baselineRunId']))})` },
    { ok: reg['baselineRunId'] === baselineRunId, message: `EvalSummary.regression.baselineRunId MUST be ${baselineRunId} (got ${JSON.stringify(reg['baselineRunId'])})` },
    { ok: want !== undefined && typeof delta === 'number' && close(delta, want), message: `regression.scoreDelta MUST be this run's aggregateScore minus the baseline's, ${String(want)} (got ${JSON.stringify(delta)})` },
  ];
}

/** RFC 0244 §F: only the tasks in both runs are paired, and the host says how many. */
export function judgePaired(candidate: Rec): RegressionFinding[] {
  const reg = isRec(candidate['regression']) ? candidate['regression'] : {};
  return [{ ok: reg['pairedTaskCount'] === SHARED_TASKS.length, message: `regression.pairedTaskCount MUST count the ${SHARED_TASKS.length} tasks present in both runs, paired by taskId (got ${JSON.stringify(reg['pairedTaskCount'])})` }];
}

/**
 * RFC 0244 §F: every paired score is equal, so no method can distinguish the
 * runs. The verdict MUST be present (the host advertises `regressionVerdict`)
 * and MUST NOT be `improved` or `regressed`.
 */
export function judgeNoFalseVerdict(candidate: Rec): RegressionFinding[] {
  const reg = isRec(candidate['regression']) ? candidate['regression'] : {};
  const v = reg['verdict'];
  return [
    { ok: typeof v === 'string', message: `a host advertising regressionVerdict MUST report regression.verdict (got ${JSON.stringify(v)})` },
    { ok: v !== 'improved' && v !== 'regressed', message: `with every paired task scoring the same, the verdict MUST NOT be improved or regressed: comparing aggregates is not pairing (got ${JSON.stringify(v)})` },
  ];
}

export interface Answer { readonly status: number; readonly json: unknown; readonly text: string }

/** §B / §C: a refused create answers `400 validation_error` and does not echo the supplied id. */
export function judgeRefused(a: Answer, suppliedId: string | undefined, what: string): RegressionFinding[] {
  const out: RegressionFinding[] = [
    { ok: a.status === 400, message: `${what} MUST be refused 400 before the run starts (got ${a.status})` },
    { ok: readErrorCode(a.json) === 'validation_error', message: `${what} MUST be refused with validation_error (got ${JSON.stringify(readErrorCode(a.json))})` },
  ];
  if (suppliedId !== undefined) out.push({ ok: !a.text.includes(suppliedId), message: `the refusal of ${what} MUST NOT echo the supplied baselineRunId` });
  return out;
}

/** §C: another tenant's real run is refused exactly as an id that never existed. */
export function judgeUniform(unknown: Answer, foreign: Answer, foreignId: string): RegressionFinding[] {
  return [
    { ok: foreign.status === unknown.status, message: `another tenant's run MUST be refused with the same status as an unknown id (${foreign.status} vs ${unknown.status})` },
    { ok: readErrorCode(foreign.json) === readErrorCode(unknown.json), message: `another tenant's run MUST be refused with the same code as an unknown id (${JSON.stringify(readErrorCode(foreign.json))} vs ${JSON.stringify(readErrorCode(unknown.json))})` },
    { ok: !foreign.text.includes(foreignId), message: "the refusal MUST NOT echo another tenant's run id" },
  ];
}
