/**
 * RFC 0257 — pure judges for `v2-all-terminals-skipped.test.ts`. The scenario
 * runs advertised fixtures and records each run's event log; these functions
 * decide each leg from those logs, so the self-tests can fail every wrong host
 * answer without a host.
 *
 * The rules are `$defs/runCompleted.skippedTerminals` in
 * `schemas/v2/run-event-payloads.schema.json` and `spec/v2/core/execution.md`
 * §`subWorkflow` (Output).
 *
 * @see RFCS/0257-run-status-when-every-terminal-is-skipped.md
 */

export interface SkipFinding { readonly ok: boolean; readonly message: string }

type Rec = Record<string, unknown>;
export interface Ev { readonly type?: unknown; readonly nodeId?: unknown; readonly sequence?: unknown; readonly payload?: unknown }

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const f = (ok: boolean, message: string): SkipFinding => ({ ok, message });
const TERMINAL = new Set(['run.completed', 'run.failed', 'run.cancelled']);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The run's terminal event, if the log has exactly the one the core requires. */
export function terminalOf(log: readonly Ev[]): Ev | null {
  const t = log.filter((e) => typeof e.type === 'string' && TERMINAL.has(e.type));
  return t.length === 1 ? (t[0] ?? null) : null;
}
const payloadOf = (e: Ev | null): Rec => (e !== null && isRec(e.payload) ? e.payload : {});
const shownType = (e: Ev | null): string => (e === null ? 'no single terminal event' : String(e.type));

/** No node failed and every terminal was skipped: `run.completed` naming exactly `expected`. */
export function judgeSkippedCompletes(log: readonly Ev[], expected: readonly string[]): SkipFinding[] {
  const t = terminalOf(log);
  const p = payloadOf(t);
  return [
    f(t?.type === 'run.completed', `a run with no failed node and every terminal skipped MUST end run.completed (got ${shownType(t)})`),
    f(!log.some((e) => e.type === 'run.failed'), 'the log MUST NOT carry run.failed for this state'),
    f(same(p['skippedTerminals'], expected), `run.completed MUST carry skippedTerminals ${JSON.stringify(expected)}: every terminal once, in nodes[] order (got ${JSON.stringify(p['skippedTerminals'])})`),
  ];
}

/** A terminal completed: `run.completed` with no `skippedTerminals`. */
export function judgeNoMarker(log: readonly Ev[]): SkipFinding[] {
  const t = terminalOf(log);
  return [
    f(t?.type === 'run.completed', `the positive control MUST end run.completed (got ${shownType(t)})`),
    f(t !== null && !('skippedTerminals' in payloadOf(t)), 'a run.completed in which a terminal completed MUST NOT carry skippedTerminals'),
  ];
}

/** A replay fork reproduces the source's terminal event type and marker. */
export function judgeReplaySame(source: readonly Ev[], fork: readonly Ev[]): SkipFinding[] {
  const s = terminalOf(source);
  const k = terminalOf(fork);
  return [
    f(k !== null && k.type === s?.type, `the replay fork MUST end with the source's terminal event (${shownType(s)}; got ${shownType(k)})`),
    f(k !== null && same(payloadOf(k)['skippedTerminals'], payloadOf(s)['skippedTerminals']), `the replay fork MUST carry the source's skippedTerminals ${JSON.stringify(payloadOf(s)['skippedTerminals'])} (got ${JSON.stringify(payloadOf(k)['skippedTerminals'])})`),
  ];
}

/** The parent's `core.subWorkflow` node completes with `childStatus` and `childSkippedTerminals`. */
export function judgeParent(log: readonly Ev[], subNodeId: string, expected: readonly string[]): SkipFinding[] {
  const t = terminalOf(log);
  const done = log.find((e) => e.type === 'node.completed' && (e.nodeId ?? payloadOf(e)['nodeId']) === subNodeId) ?? null;
  const out = isRec(payloadOf(done)['outputs']) ? (payloadOf(done)['outputs'] as Rec) : {};
  return [
    f(t?.type === 'run.completed', `a parent whose child completed with no terminal MUST NOT fail on it (got ${shownType(t)})`),
    f(done !== null, `the core.subWorkflow node ${subNodeId} MUST emit node.completed`),
    f(out['childStatus'] === 'completed', `outputs.childStatus MUST be "completed" (got ${JSON.stringify(out['childStatus'])})`),
    f(same(out['childSkippedTerminals'], expected), `outputs.childSkippedTerminals MUST equal the child's skippedTerminals ${JSON.stringify(expected)} (got ${JSON.stringify(out['childSkippedTerminals'])})`),
  ];
}
