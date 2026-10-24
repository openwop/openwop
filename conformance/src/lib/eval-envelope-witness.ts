/**
 * RFC 0081 §C — the `eval.*` envelope of an eval run, and the summary it
 * serves. A pure judge over one eval run, for
 * `v2-eval-trajectory-trials.test.ts`.
 *
 * The rules are the `run-event-payloads` descriptions, which the `agents`
 * family lists as normative text:
 *   - `evalStarted` — emitted ONCE, at the start of the run;
 *   - `evalScored` — once per task (per trial under RFC 0244 §B);
 *   - `evalCompleted` — emitted ONCE, after all tasks and before
 *     `run.completed`; its aggregates describe the same run the summary does.
 * The served `EvalSummary` validates against `eval-summary.schema.json`.
 *
 * Until 2.46.20 no v2 leg read `eval.completed`; the frozen v1
 * `agent-eval-run.test.ts` did (RFC 0081 correction note, 2026-10-24).
 *
 * @see RFCS/0081-agent-evaluation-and-scorecards.md
 */

export interface EnvelopeFinding { readonly ok: boolean; readonly doc: string; readonly message: string }

type Rec = Record<string, unknown>;
interface Event { readonly type: string; readonly sequence: number; readonly payload: Rec }

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const f = (ok: boolean, doc: string, message: string): EnvelopeFinding => ({ ok, doc, message });

const C = 'run-event-payloads evalStarted / evalScored / evalCompleted (RFC 0081 §C)';

export interface EnvelopeOptions {
  /** Validates an `eval.completed` payload against `run-event-payloads#/$defs/evalCompleted`. */
  readonly completedValid: (payload: unknown) => { ok: boolean; errors: string };
}

export function judgeEvalEnvelope(events: readonly Event[], summary: Rec, opts: EnvelopeOptions): EnvelopeFinding[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const at = (type: string): number[] => ordered.flatMap((e, i) => (e.type === type ? [i] : []));
  const started = at('eval.started');
  const scored = at('eval.scored');
  const completed = at('eval.completed');
  const runCompleted = at('run.completed');
  const out: EnvelopeFinding[] = [];

  out.push(f(started.length === 1, C, `eval.started MUST be emitted once (got ${started.length})`));
  out.push(f(completed.length === 1, C, `eval.completed MUST be emitted once (got ${completed.length})`));
  out.push(f(scored.length > 0, C, 'the run MUST emit eval.scored for its tasks'));
  if (started.length === 1 && scored.length > 0) {
    out.push(f(started[0]! < scored[0]!, C, 'eval.started MUST precede every eval.scored'));
  }
  if (completed.length !== 1) return out;
  const c = completed[0]!;
  if (scored.length > 0) out.push(f(c > scored[scored.length - 1]!, C, 'eval.completed MUST follow every eval.scored ("after all tasks")'));
  if (runCompleted.length > 0) out.push(f(c < runCompleted[0]!, C, 'eval.completed MUST precede run.completed'));

  const payload = ordered[c]!.payload;
  const v = opts.completedValid(payload);
  out.push(f(v.ok, C, `eval.completed MUST validate: ${v.errors}`));
  for (const k of ['taskCount', 'passedCount', 'passed'] as const) {
    if (k in summary) out.push(f(payload[k] === summary[k], C, `eval.completed.${k} MUST equal the served summary's (event ${JSON.stringify(payload[k])}, summary ${JSON.stringify(summary[k])})`));
  }
  return out;
}

/** The served summary validates, and its per-task rows agree with its own counts. */
export function judgeSummaryServed(summary: Rec, valid: (s: unknown) => { ok: boolean; errors: string }): EnvelopeFinding[] {
  const out: EnvelopeFinding[] = [];
  const v = valid(summary);
  out.push(f(v.ok, 'eval-summary.schema.json (RFC 0081 §C)', `the served EvalSummary MUST validate: ${v.errors}`));
  const tasks = Array.isArray(summary['tasks']) ? (summary['tasks'] as unknown[]).filter(isRec) : [];
  out.push(f(summary['taskCount'] === tasks.length, 'eval-summary.schema.json (RFC 0081 §C)', `taskCount MUST equal the number of tasks (got ${JSON.stringify(summary['taskCount'])}, ${tasks.length} tasks)`));
  const passed = tasks.filter((t) => t['passed'] === true).length;
  out.push(f(summary['passedCount'] === passed, 'eval-summary.schema.json (RFC 0081 §C)', `passedCount MUST count the passed tasks (got ${JSON.stringify(summary['passedCount'])}, ${passed} passed)`));
  return out;
}
