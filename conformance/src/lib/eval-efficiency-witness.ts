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

/**
 * The `provider.usage` payloads of the agent under test, in log order.
 * `provider.usage` carries no `agentId`, so attribution is positional: a usage
 * event counts while an `agent.invocation.started` of `agentId` is open and no
 * other agent's invocation (a judge, a delegate) is open inside it. Brackets
 * are emitted only by an `agents.liveRuntime` host; `bracketed: false` means
 * the log has none, and the usage list is then every `provider.usage` of the run.
 */
export function agentUsage(events: readonly { readonly type: string; readonly payload: Rec }[], agentId: string): { bracketed: boolean; usage: Rec[] } {
  const open = new Map<string, boolean>();
  let mine = 0;
  let other = 0;
  let bracketed = false;
  const inside: Rec[] = [];
  const all: Rec[] = [];
  for (const e of events) {
    const id = e.payload['invocationId'];
    if (e.type === 'agent.invocation.started' && typeof id === 'string') {
      bracketed = true;
      const isMine = e.payload['agentId'] === agentId;
      open.set(id, isMine);
      if (isMine) mine += 1; else other += 1;
    } else if (e.type === 'agent.invocation.completed' && typeof id === 'string' && open.has(id)) {
      if (open.get(id)) mine -= 1; else other -= 1;
      open.delete(id);
    } else if (e.type === 'provider.usage') {
      all.push(e.payload);
      if (mine > 0 && other === 0) inside.push(e.payload);
    }
  }
  return bracketed ? { bracketed, usage: inside } : { bracketed, usage: all };
}

const FIELDS = [['modelCallCount', () => 1], ['inputTokens', (u: Rec) => u['inputTokens']], ['outputTokens', (u: Rec) => u['outputTokens']]] as const;
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

/**
 * §C `modelCallCount`, `inputTokens` and `outputTokens`. Each is a mean over
 * `trials` identical trials, so the per-task values times `trials` sum to the
 * agent's usage in the log. With brackets the sums MUST be equal; without them
 * the run's usage also holds any host-internal call, so the sums MUST NOT
 * exceed it. A field is judged only when every task reports it. A run with no
 * usage and zero counts witnesses nothing (`applicable: false`).
 */
export function judgeModelUsage(summary: Rec, taskIds: readonly string[], log: { bracketed: boolean; usage: readonly Rec[] }, trials: number): EfficiencyVerdict {
  const entries = (Array.isArray(summary['tasks']) ? (summary['tasks'] as unknown[]) : []).filter(isRec);
  const effs = taskIds.map((id) => entries.find((e) => e['taskId'] === id)?.['efficiency']);
  const findings: EfficiencyFinding[] = [];
  let witnessed = false;
  for (const [field, of] of FIELDS) {
    const vals = effs.map((x) => (isRec(x) ? x[field] : undefined));
    if (!vals.every((v) => typeof v === 'number')) continue;
    const reported = (vals as number[]).reduce((a, b) => a + b, 0) * trials;
    const inLog = log.usage.reduce((a, u) => a + (typeof of(u) === 'number' ? (of(u) as number) : 0), 0);
    if (reported === 0 && inLog === 0) continue;
    witnessed = true;
    findings.push(log.bracketed
      ? { ok: close(reported, inLog), message: `the per-task efficiency.${field} values times ${trials} trial(s) MUST sum to the ${inLog} the agent's provider.usage events inside its invocation brackets carry (got ${reported})` }
      : { ok: reported <= inLog + 1e-9 * Math.max(1, inLog), message: `the per-task efficiency.${field} values times ${trials} trial(s) MUST NOT exceed the ${inLog} the run's provider.usage events carry (got ${reported})` });
  }
  return witnessed ? { applicable: true, findings } : { applicable: false, findings: [] };
}

/**
 * §B "cost counts every trial": on a multi-trial run the summary's
 * `totalCostUsd` holds the `costEstimateUsd` of the agent's usage in every
 * trial, so a host that priced only one trial reads short. Only that floor is
 * judged: whether a judge's or the host's own calls are priced in is not
 * pinned, so a higher total is not a failure. Judged only
 * with brackets (otherwise the agent's usage cannot be told from the host's
 * own) and only when every attributed usage event carries a cost.
 */
export function judgeCostEveryTrial(summary: Rec, log: { bracketed: boolean; usage: readonly Rec[] }): EfficiencyVerdict {
  const total = summary['totalCostUsd'];
  if (typeof total !== 'number' || !log.bracketed || log.usage.length === 0) return { applicable: false, findings: [] };
  const costs = log.usage.map((u) => u['costEstimateUsd']);
  if (!costs.every((c) => typeof c === 'number')) return { applicable: false, findings: [] };
  const sum = (costs as number[]).reduce((a, b) => a + b, 0);
  return { applicable: true, findings: [{ ok: total >= sum || close(total, sum), message: `totalCostUsd MUST count every trial: it MUST be at least the ${sum} costEstimateUsd of the agent's ${log.usage.length} provider.usage events across all trials (got ${total})` }] };
}
