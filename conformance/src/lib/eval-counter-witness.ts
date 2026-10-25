/**
 * RFC 0244 §D, G2 — the suite-owned counter tool `conformance.eval:counter`
 * makes "a miss under onMiss: \"fail\" never reaches a live tool" and "the
 * first unconsumed entry is served" observable from outside. Pure judges over
 * three sequential eval runs, for `v2-eval-trajectory-trials.test.ts`.
 *
 * The counter's live effect is persistent, tenant-scoped state: `inc` adds one
 * to `(owner, key)` and returns `{key, count}`; `read` returns it unchanged
 * (contract in `fixtures.md` §Eval-suite fixtures). The runs are:
 *   A. `conformance-eval-counter-live` (`onMiss: "live"`): inc L, inc L, read F, read S.
 *   B. `conformance-eval-counter-miss` (`onMiss: "fail"`): inc S three times
 *      against two exact entries serving `{served: 1}` then `{served: 2}`, then inc F.
 *   C. `conformance-eval-counter-live` again.
 * C's first L is A's second L plus one, which proves the state persisted
 * between runs; only then do unchanged F and S counts prove B's two misses
 * never ran the live tool. A host that leaked a miss reads one higher. When
 * persistence is not shown (a concurrent cut on the tenant, or no durable
 * state) the verdict is `blocked`, never a failure.
 *
 * @see RFCS/0244-eval-trajectories-trials-and-recorded-fixtures.md §D
 */

export const COUNTER_TOOL = 'conformance.eval:counter';

export interface CounterFinding { readonly ok: boolean; readonly message: string }
export type CounterVerdict =
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'judged'; readonly findings: readonly CounterFinding[] };

type Rec = Record<string, unknown>;
export interface CounterEvent { readonly type: string; readonly payload: Rec }
export interface CounterCall { readonly key: unknown; readonly op: unknown; readonly outcome: unknown; readonly error: unknown; readonly returned: boolean }

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (c: CounterCall | undefined): number | undefined => {
  const o = c?.outcome;
  return isRec(o) && typeof o['count'] === 'number' && Number.isInteger(o['count']) ? o['count'] : undefined;
};

/** The counter calls of one run, in log order, each paired with its return by `callId`. */
export function counterCalls(events: readonly CounterEvent[], agentId: string): CounterCall[] {
  const returns = new Map<string, Rec>();
  for (const e of events) {
    if (e.type === 'agent.tool-returned' && e.payload['toolName'] === COUNTER_TOOL && typeof e.payload['callId'] === 'string') returns.set(e.payload['callId'], e.payload);
  }
  const out: CounterCall[] = [];
  for (const e of events) {
    if (e.type !== 'agent.tool-called' || e.payload['toolName'] !== COUNTER_TOOL || e.payload['agentId'] !== agentId) continue;
    const inputs = isRec(e.payload['inputs']) ? e.payload['inputs'] : {};
    const r = typeof e.payload['callId'] === 'string' ? returns.get(e.payload['callId']) : undefined;
    out.push({ key: inputs['key'], op: inputs['op'], outcome: r?.['outcome'], error: r?.['error'], returned: r !== undefined });
  }
  return out;
}

/** Run A or C: inc L, inc L, read F, read S, every one answered live with `{key, count}`. */
function liveCounts(calls: readonly CounterCall[], label: string): { counts: { L1: number; L2: number; F: number; S: number } } | { reason: string } {
  if (calls.length !== 4) return { reason: `run ${label} MUST log the four scripted counter calls (got ${calls.length})` };
  const [l1, l2, f, s] = calls.map(count);
  if (l1 === undefined || l2 === undefined || f === undefined || s === undefined) {
    return { reason: `run ${label}: every live counter call MUST record outcome {key, count} on agent.tool-returned (fixtures.md counter contract)` };
  }
  return { counts: { L1: l1, L2: l2, F: f, S: s } };
}

/** §D `onMiss: "live"` on run A: the misses reached the live tool, and the summary reports them. */
export function judgeLiveMiss(a: readonly CounterCall[], fixtureMissCount: unknown): CounterVerdict {
  const live = liveCounts(a, 'A');
  if ('reason' in live) return { kind: 'blocked', reason: live.reason };
  return {
    kind: 'judged',
    findings: [
      { ok: typeof fixtureMissCount === 'number' && fixtureMissCount > 0, message: `a task whose misses ran live under onMiss "live" MUST report fixtureMissCount > 0 (got ${String(fixtureMissCount)})` },
      { ok: live.counts.L2 === live.counts.L1 + 1, message: `two live inc calls MUST advance the counter by one each (got ${live.counts.L1} then ${live.counts.L2})` },
    ],
  };
}

/** §D selection on run B: the two exact entries are served in order, once each, and the third call is a miss. */
export function judgeFirstUnconsumed(b: readonly CounterCall[]): CounterVerdict {
  const s = b.filter((c) => c.key === 'S');
  if (s.length !== 3 || !s.every((c) => c.returned)) return { kind: 'blocked', reason: `run B MUST log three paired counter calls for key S (got ${s.length})` };
  const served = (c: CounterCall): unknown => (isRec(c.outcome) ? c.outcome['served'] : undefined);
  return {
    kind: 'judged',
    findings: [
      { ok: served(s[0]!) === 1 && s[0]!.error === undefined, message: `the first call MUST be served the first unconsumed entry {served: 1} (got ${JSON.stringify(s[0]!.outcome ?? s[0]!.error)})` },
      { ok: served(s[1]!) === 2 && s[1]!.error === undefined, message: `the second call MUST be served the next unconsumed entry {served: 2}, each entry consumed once (got ${JSON.stringify(s[1]!.outcome ?? s[1]!.error)})` },
      { ok: s[2]!.error !== undefined && count(s[2]) === undefined && served(s[2]!) === undefined, message: `the third call matches no unconsumed entry, so under onMiss "fail" it MUST return a tool error (got ${JSON.stringify(s[2]!.outcome ?? s[2]!.error)})` },
    ],
  };
}

/** §D `onMiss: "fail"` across A → B → C: neither miss in B ran the live tool. */
export function judgeMissNoLiveCall(a: readonly CounterCall[], b: readonly CounterCall[], c: readonly CounterCall[]): CounterVerdict {
  const ra = liveCounts(a, 'A');
  if ('reason' in ra) return { kind: 'blocked', reason: ra.reason };
  const rc = liveCounts(c, 'C');
  if ('reason' in rc) return { kind: 'blocked', reason: rc.reason };
  if (rc.counts.L1 !== ra.counts.L2 + 1) {
    return { kind: 'blocked', reason: `the counter state did not persist from run A to run C on its own (L went ${ra.counts.L2} → ${rc.counts.L1}, want ${ra.counts.L2 + 1}): another run on the tenant, or no durable state, so unchanged counts prove nothing` };
  }
  const f = b.filter((x) => x.key === 'F');
  return {
    kind: 'judged',
    findings: [
      { ok: f.length === 1 && f[0]!.error !== undefined && count(f[0]) === undefined, message: `run B's unmatched inc F MUST return a tool error, not a live count (got ${JSON.stringify(f[0]?.outcome ?? f[0]?.error)})` },
      { ok: rc.counts.F === ra.counts.F, message: `a miss under onMiss "fail" MUST NOT reach the live tool: counter F MUST read the same after run B (${ra.counts.F} → ${rc.counts.F})` },
      { ok: rc.counts.S === ra.counts.S, message: `fixture-served calls and the unmatched third inc S MUST NOT reach the live tool: counter S MUST read the same after run B (${ra.counts.S} → ${rc.counts.S})` },
    ],
  };
}
