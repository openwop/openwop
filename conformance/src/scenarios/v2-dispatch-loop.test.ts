/**
 * v2 — the supervisor loop (`spec/v2/core/execution.md` §`multiAgent`, levels
 * 1 and 5). The v1 twin is `dispatchLoop`; the legs live in
 * `lib/dispatch-witness.ts`. Event names come from the codemap through the
 * profile: `runOrchestrator.decided` is `orchestrator.decided` at major 2.
 *
 * A run of `conformance-dispatch-loop` (`core.orchestrator.supervisor` ⇄
 * `core.dispatch`) is created with `POST /runs` and its log read with
 * `events/poll`:
 *   terminates  the run completes; each turn records its decision, the last
 *               is `terminate`, and none follows it ("`terminate` completes
 *               the run");
 *   decisions   every decision payload is well-formed (the decision checked
 *               against the `OrchestratorDecision` branches) and its `agentId`
 *               never changes;
 *   iteration   at `executionModel.version >= 5`, `iteration` is 1-based and
 *               +1 per turn.
 * NOT ported: v1's exact `['next-worker', 'terminate']` sequence. That is the
 * fixture catalog's prerequisite on the host's supervisor, not a rule the v2
 * text states.
 *
 * Dispositions: `multiAgent.executionModel` not advertised, or the fixture not
 * in `fixtures[]` ⇒ `inapplicable`; version below 5 ⇒ the iteration leg
 * `inapplicable`; discovery unreadable ⇒ `blocked`.
 *
 * Proven against a double in `lib/dispatch-witness.test.ts`.
 *
 * @see spec/v2/core/execution.md §multiAgent
 */

import { describe, it, expect } from 'vitest';
import { familyAdvertised, v2Discovery, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import type { Outcome, Skip } from '../lib/fixture-run-observer.js';
import { decisionBranchValidator, driveLoop, judgeDecisions, judgeIteration, judgeLoopTerminates, type LoopObservation } from '../lib/dispatch-witness.js';

const PROFILE = majorProfile(2);
const ID_TERMINATES = 'openwop.requirement.multi-agent.supervisor-loop-terminates';
const ID_DECISIONS = 'openwop.requirement.multi-agent.decision-recorded-well-formed';
const ID_ITERATION = 'openwop.requirement.multi-agent.decision-iteration-monotonic';
const validateDecision = decisionBranchValidator((i) => v2RefValidator(`orchestrator-decision.schema.json#/oneOf/${i}`));

let run: Promise<Skip | LoopObservation> | undefined;
async function observation(): Promise<LoopObservation | (() => undefined)> {
  if (!process.env['OPENWOP_BASE_URL']) return () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return () => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
  if (!(await familyAdvertised('multiAgent'))) return () => softSkip('inapplicable', 'the host does not advertise multiAgent');
  run ??= driveLoop(PROFILE, doc);
  const o = await run;
  return 'kind' in o ? () => softSkip(o.disposition, o.reason) : o;
}
function assert(id: string, out: Outcome): undefined {
  if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
  for (const x of out.findings) expect(x.ok, req(id, x.doc, x.message)).toBe(true);
  return undefined;
}

describe('v2 multiAgent: the supervisor loop (execution.md §multiAgent)', () => {
  it('each turn records its decision and terminate completes the run', async () => {
    const o = await observation();
    if (typeof o === 'function') return o();
    return assert(ID_TERMINATES, judgeLoopTerminates(o));
  }, 90_000);

  it('every recorded decision is well-formed and the deciding agent never changes', async () => {
    const o = await observation();
    if (typeof o === 'function') return o();
    return assert(ID_DECISIONS, judgeDecisions(o, validateDecision));
  }, 90_000);

  it('at executionModel.version >= 5, iteration is 1-based and increments by exactly 1 per turn', async () => {
    const o = await observation();
    if (typeof o === 'function') return o();
    return assert(ID_ITERATION, judgeIteration(o));
  }, 90_000);
});
