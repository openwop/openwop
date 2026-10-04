/**
 * v2 — `core.dispatch` `inputMapping` (`spec/v2/facets/agents.schema.json`
 * `dispatchMapping`: a host advertising it honors `inputMapping`, "building
 * child inputs from parent variables before dispatch";
 * `schemas/v2/dispatch-config.schema.json` `inputMapping`: "Child receives
 * `inputs[childKey] = parentVariables[parentKey]`", mirroring
 * `core.subWorkflow`'s `inputMapping`). The v1 twin is `dispatch-input-mapping`
 * (HVMAP-1a, HVMAP-1a-null); the legs live in `lib/dispatch-witness.ts`.
 *
 *   projection  `conformance-dispatch-input-mapping`: the dispatched child's
 *               `inputs.childGreeting` is the parent's `parentName` ("Alice");
 *   unset       `conformance-dispatch-input-mapping-no-default`: `parentName`
 *               is unset, so the child's `inputs.childGreeting` is absent —
 *               never `null` or a placeholder.
 * The child is found by the parent's `node.dispatched` (`childWorkflowId`), or
 * else the dispatch node's `node.completed` `outputs.childRunId`.
 * NOT ported: the registration-refusal leg (it drives a capability-toggle seam).
 *
 * Dispositions: `agents.dispatchMapping` not `true`, or a fixture not in
 * `fixtures[]` ⇒ `inapplicable`; the child unlocatable on the parent's log ⇒
 * `blocked`; discovery unreadable ⇒ `blocked`.
 *
 * Proven against a double in `lib/dispatch-witness.test.ts`.
 *
 * @see spec/v2/facets/agents.schema.json §dispatchMapping
 * @see schemas/v2/dispatch-config.schema.json §inputMapping
 */

import { describe, it, expect } from 'vitest';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import type { Outcome, Skip } from '../lib/fixture-run-observer.js';
import { DISPATCH_NO_DEFAULT_FIXTURE, DISPATCH_PARENT_FIXTURE, driveDispatchMapping, judgeProjection, judgeUnsetProjection, type DispatchObservation } from '../lib/dispatch-witness.js';

const PROFILE = majorProfile(2);
const ID_PROJECTION = 'openwop.requirement.agents.dispatch-input-mapping-projection';
const ID_UNSET = 'openwop.requirement.agents.dispatch-input-mapping-unset-undefined';

const runs = new Map<string, Promise<Skip | DispatchObservation>>();
async function observation(fixture: string): Promise<DispatchObservation | (() => undefined)> {
  if (!process.env['OPENWOP_BASE_URL']) return () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return () => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
  if (!(await familyAdvertised('agents'))) return () => softSkip('inapplicable', 'the host does not advertise agents');
  if (!runs.has(fixture)) runs.set(fixture, driveDispatchMapping(PROFILE, doc, fixture));
  const o = await runs.get(fixture)!;
  return 'kind' in o ? () => softSkip(o.disposition, o.reason) : o;
}
function assert(id: string, out: Outcome): undefined {
  if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
  for (const x of out.findings) expect(x.ok, req(id, x.doc, x.message)).toBe(true);
  return undefined;
}

describe('v2 dispatch: inputMapping (agents.dispatchMapping)', () => {
  it('inputMapping projects the parent variable into the dispatched child inputs', async () => {
    const o = await observation(DISPATCH_PARENT_FIXTURE);
    if (typeof o === 'function') return o();
    return assert(ID_PROJECTION, judgeProjection(o));
  }, 90_000);

  it('an unset parent variable projects to undefined: the child input is absent, never null', async () => {
    const o = await observation(DISPATCH_NO_DEFAULT_FIXTURE);
    if (typeof o === 'function') return o();
    return assert(ID_UNSET, judgeUnsetProjection(o));
  }, 90_000);
});
