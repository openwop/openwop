/**
 * RFC 0245 — an eval fixture entry marked `isError: true` is replayed as a
 * tool error, never as a success. A pure judge over one eval run of the
 * `conformance-eval-fixture-error` fixture, for
 * `v2-eval-trajectory-trials.test.ts`.
 *
 * The fixture's one task scripts the same call twice, and its fixtures serve
 * an `isError: true` entry and then a success (RFC 0244 §D: first unconsumed
 * match). So the expected log is known in advance: two `agent.tool-called`
 * from the scripted agent, and two `agent.tool-returned` paired to them by
 * `callId` — the first with `error` and no `outcome`, the second with no
 * `error` (`outcome` is optional on a success). A served error is not a miss,
 * so `fixtureMissCount` stays 0.
 *
 * That the agent saw a tool error, and that no live tool ran, are seam-gated
 * (RFC 0245 G1, RFC 0244 G2) and not judged here.
 *
 * @see RFCS/0245-eval-fixtures-replay-tool-errors.md
 */

export interface FixtureErrorFinding { readonly ok: boolean; readonly doc: string; readonly message: string }

type Rec = Record<string, unknown>;
interface Event { readonly type: string; readonly sequence: number; readonly payload: Rec }

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.length > 0;
const f = (ok: boolean, doc: string, message: string): FixtureErrorFinding => ({ ok, doc, message });

const B = 'RFC 0245 §B';
export const FIXTURE_ERROR_TOOL = 'conformance.eval:lookup';
export const FIXTURE_ERROR_TASK = 'recovers';

export interface FixtureErrorOptions {
  /** The scripted agent's id; tool events from any other agent are ignored. */
  readonly agentId: string;
  /** Discovery `toolHooks.prePostEvents === true`: the error return also carries `status: "error"`. */
  readonly prePostEvents: boolean;
}

export function judgeFixtureErrorReplayed(events: readonly Event[], summary: Rec, opts: FixtureErrorOptions): FixtureErrorFinding[] {
  const mine = (e: Event): boolean => e.payload['agentId'] === opts.agentId && e.payload['toolName'] === FIXTURE_ERROR_TOOL;
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const called = ordered.filter((e) => e.type === 'agent.tool-called' && mine(e));
  const returned = ordered.filter((e) => e.type === 'agent.tool-returned' && mine(e));
  const out: FixtureErrorFinding[] = [];

  out.push(f(called.length === 2, B, `the log MUST carry two agent.tool-called for ${FIXTURE_ERROR_TOOL} (got ${called.length})`));
  out.push(f(returned.length === 2, B, `the log MUST carry two agent.tool-returned for ${FIXTURE_ERROR_TOOL} (got ${returned.length})`));

  const byCall = (c: Event | undefined): Rec | undefined => {
    const id = c?.payload['callId'];
    if (!nonEmpty(id)) return undefined;
    return returned.find((r) => r.payload['callId'] === id)?.payload;
  };
  const first = byCall(called[0]);
  const second = byCall(called[1]);

  if (first === undefined) {
    out.push(f(false, B, 'the first scripted call MUST have an agent.tool-returned with the same callId'));
  } else {
    const err = first['error'];
    out.push(f(isRec(err) && nonEmpty(err['code']) && nonEmpty(err['message']), B, 'the call served by the isError entry MUST be recorded with error {code, message}, both non-empty'));
    out.push(f(!('outcome' in first) || first['outcome'] === undefined, B, 'the call served by the isError entry MUST NOT carry outcome — that replays a failure as a success'));
    if (opts.prePostEvents) out.push(f(first['status'] === 'error', B, `under toolHooks.prePostEvents the error return MUST carry status "error" (got ${JSON.stringify(first['status'])})`));
  }

  if (second === undefined) {
    out.push(f(false, B, 'the second scripted call MUST have an agent.tool-returned with the same callId'));
  } else {
    // A success is "not an error", not "carries outcome": `outcome` is optional
    // on agent.tool-returned and RFC 0064 §F lets a host omit it (2.46.18).
    out.push(f(second['error'] === undefined, B, 'the call served by the following success entry MUST NOT carry error'));
    if (opts.prePostEvents) out.push(f(second['status'] !== 'error', B, `under toolHooks.prePostEvents the success return MUST NOT carry status "error" (got ${JSON.stringify(second['status'])})`));
  }

  const tasks = Array.isArray(summary['tasks']) ? (summary['tasks'] as unknown[]).filter(isRec) : [];
  const task = tasks.find((t) => t['taskId'] === FIXTURE_ERROR_TASK);
  out.push(f(task !== undefined, B, `the summary MUST carry task ${FIXTURE_ERROR_TASK}`));
  if (task !== undefined) out.push(f((task['fixtureMissCount'] ?? 0) === 0, B, `a served error entry is not a miss: fixtureMissCount MUST be 0 (got ${JSON.stringify(task['fixtureMissCount'])})`));
  return out;
}
