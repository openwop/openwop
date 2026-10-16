/**
 * RFC 0246 — a trial that fails its trajectory cannot carry a task or a suite
 * to a pass. Pure judges over an eval run's `EvalSummary` and `eval.scored`
 * events, for `v2-eval-trajectory-trials.test.ts`.
 *
 * The rule, in one line: every reported score stays the RFC 0244 measurement
 * (§C), and the two pass decisions read a GATING value in which a
 * trajectory-failed trial counts 0 (§A, §B). The summary carries that value as
 * `gatedScore` on every trajectory task and `gatedAggregateScore` on any suite
 * with one (§D).
 *
 * Each judge takes what the host served and returns findings; it never reads
 * the host's own `passed` to decide what `passed` should be. The two fixtures
 * make the expected answer known in advance: the scripted agent produces the
 * golden output (score 1) on every task, and calls a `forbidden` tool on the
 * `path-wrong` task.
 *
 * @see RFCS/0246-trajectory-failure-gates-the-pass.md
 */

import { withinTolerance } from './eval-trajectory.js';

export interface GateFinding { readonly ok: boolean; readonly doc: string; readonly message: string }

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const f = (ok: boolean, doc: string, message: string): GateFinding => ({ ok, doc, message });
const close = (a: number | undefined, b: number): boolean => a !== undefined && withinTolerance(a, b);

const A = 'RFC 0246 §A';
const B = 'RFC 0246 §B';
const C = 'RFC 0246 §C';
const D = 'RFC 0246 §D';

function task(summary: Rec, taskId: string): Rec | undefined {
  const tasks = Array.isArray(summary['tasks']) ? (summary['tasks'] as unknown[]) : [];
  return tasks.filter(isRec).find((t) => t['taskId'] === taskId);
}

/**
 * `conformance-eval-trajectory-gate-mean`: one task, `passRule: "mean"`, two
 * trials, each the golden output with a forbidden call. Under RFC 0244 alone a
 * host reports `meanScore: 1` and `passed: true`; RFC 0246 requires
 * `gatedScore: 0` and `passed: false` with `meanScore` unchanged.
 */
export function judgeMeanGated(summary: Rec, scored: readonly Rec[], trialCount: number): GateFinding[] {
  const out: GateFinding[] = [];
  const rows = scored.filter((e) => e['taskId'] === 'path-wrong');
  out.push(f(rows.length === trialCount, 'RFC 0244 §B', `path-wrong MUST emit one eval.scored per trial (${trialCount}; got ${rows.length})`));
  for (const r of rows) {
    out.push(
      f(num(r['score']) === 1, C, `eval.scored.score MUST stay the output score 1 for trial ${String(r['trialIndex'])} (got ${String(r['score'])})`),
      f(r['passed'] === false, 'RFC 0244 §A', `a trial that called a forbidden tool MUST NOT pass (trial ${String(r['trialIndex'])})`),
    );
  }
  const t = task(summary, 'path-wrong');
  out.push(f(t !== undefined, D, 'the summary MUST carry task path-wrong'));
  if (t === undefined) return out;
  const trials = isRec(t['trials']) ? t['trials'] : {};
  out.push(
    f(close(num(trials['meanScore']), 1), C, `trials.meanScore MUST stay the mean output score 1 (got ${String(trials['meanScore'])})`),
    f(num(t['gatedScore']) !== undefined, D, 'a task with expected.trajectory MUST carry gatedScore'),
    f(close(num(t['gatedScore']), 0), A, `gatedScore MUST be 0 when every trial failed its trajectory (got ${String(t['gatedScore'])})`),
    f(t['passed'] === false, B, `under passRule "mean" the task MUST NOT pass on the gating score 0, whatever meanScore is (got passed ${String(t['passed'])})`),
    f(num(summary['gatedAggregateScore']) !== undefined, D, 'a suite with a trajectory task MUST carry gatedAggregateScore'),
  );
  return out;
}

/**
 * `conformance-eval-trajectory-gate`: two tasks, one trial each, both the
 * golden output (score 1); `path-matched` keeps to its trajectory and
 * `path-wrong` calls a forbidden tool. `passScore` is 0.6. Under RFC 0244 alone
 * `aggregateScore` 1 clears it and suite `passed` is true; RFC 0246 requires the
 * gating aggregate 0.5 to decide, so `passed` is false.
 */
export function judgeSuiteGated(summary: Rec, passScore: number): GateFinding[] {
  const out: GateFinding[] = [];
  const matched = task(summary, 'path-matched');
  const wrong = task(summary, 'path-wrong');
  out.push(f(matched !== undefined && wrong !== undefined, D, 'the summary MUST carry tasks path-matched and path-wrong'));
  if (matched === undefined || wrong === undefined) return out;
  const ms = num(matched['score']);
  const ws = num(wrong['score']);
  const agg = num(summary['aggregateScore']);
  const gAgg = num(summary['gatedAggregateScore']);
  const mg = num(matched['gatedScore']);
  const wg = num(wrong['gatedScore']);
  out.push(
    f(ms === 1 && ws === 1, C, `both tasks MUST keep the output score 1 (got ${String(ms)}, ${String(ws)})`),
    f(wrong['passed'] === false, 'RFC 0244 §A', 'path-wrong called a forbidden tool and MUST NOT pass'),
    f(close(agg, 1), C, `aggregateScore MUST stay the aggregate of the task scores, 1 (got ${String(agg)})`),
    f(mg !== undefined && wg !== undefined, D, 'every task with expected.trajectory MUST carry gatedScore, matched or not'),
    f(ms !== undefined && close(mg, ms), A, `path-matched MUST carry gatedScore equal to its score (got ${String(mg)})`),
    f(close(wg, 0), A, `path-wrong MUST carry gatedScore 0 (got ${String(wg)})`),
    f(gAgg !== undefined, D, 'a suite with a trajectory task MUST carry gatedAggregateScore'),
    f(close(gAgg, 0.5), A, `gatedAggregateScore MUST aggregate the gating scores [1, 0] to 0.5 (got ${String(gAgg)})`),
    f(summary['passed'] === false, B, `suite passed MUST read the gating aggregate (0.5 < passScore ${passScore}) even though aggregateScore (${String(agg)}) clears it (got passed ${String(summary['passed'])})`),
  );
  return out;
}
