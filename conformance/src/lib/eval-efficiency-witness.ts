/**
 * RFC 0244 §C — the per-task `efficiency.toolCallCount` is the count of
 * `agent.tool-called` events inside the task's invocation brackets, as a mean
 * over its trials. A pure judge over an eval run's `EvalSummary` and event log,
 * for `v2-eval-trajectory-trials.test.ts`.
 *
 * The expected count is known in advance: the scripted agent replays each
 * task's `input.script` as tool calls on every trial, so a task's mean is its
 * script length, whatever the host. The judge never reads the host's own count
 * to decide what the count should be. Only `toolCallCount` is judged:
 * `modelCallCount` and the token sums depend on whether the host's scripted
 * agent calls a model, which the fixture contract leaves to the host.
 *
 * `efficiency` is optional on a summary entry, so a run whose entries carry
 * none is not evidence either way (`applicable: false`).
 *
 * @see RFCS/0244-eval-trajectories-trials-and-recorded-fixtures.md §C
 */

export interface EfficiencyFinding { readonly ok: boolean; readonly message: string }
export interface EfficiencyVerdict { readonly applicable: boolean; readonly findings: readonly EfficiencyFinding[] }
export interface ScriptedTask { readonly taskId: string; readonly scriptLength: number }

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `toolCallsInLog` is the number of `agent.tool-called` events the run's log
 * carries for the agent under test. On a run of one trial per task the
 * per-task counts sum to it; on a multi-trial run pass `undefined`, since the
 * sum of means is not an event count.
 */
export function judgeToolCallCount(summary: Rec, tasks: readonly ScriptedTask[], toolCallsInLog: number | undefined): EfficiencyVerdict {
  const entries = (Array.isArray(summary['tasks']) ? (summary['tasks'] as unknown[]) : []).filter(isRec);
  const findings: EfficiencyFinding[] = [];
  let reported = 0;
  let sum = 0;
  for (const t of tasks) {
    const entry = entries.find((e) => e['taskId'] === t.taskId);
    const eff = entry?.['efficiency'];
    if (!isRec(eff)) continue;
    reported += 1;
    const got = eff['toolCallCount'];
    findings.push({
      ok: typeof got === 'number' && got === t.scriptLength,
      message: `task ${t.taskId}: efficiency.toolCallCount MUST count the agent.tool-called events in its brackets, the ${t.scriptLength} scripted calls per trial (got ${String(got)})`,
    });
    if (typeof got === 'number') sum += got;
  }
  if (reported === 0) return { applicable: false, findings: [] };
  if (toolCallsInLog !== undefined && reported === tasks.length) {
    findings.push({
      ok: sum === toolCallsInLog,
      message: `the per-task toolCallCount values MUST sum to the run's ${toolCallsInLog} agent.tool-called events on a one-trial run (got ${sum})`,
    });
  }
  return { applicable: true, findings };
}
