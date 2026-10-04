/**
 * v2 — `core.subWorkflow` `inputMapping` (`spec/v2/core/execution.md`
 * §`subWorkflow`: "`inputMapping` (`childVar → parentVar`) seeds the child
 * once, at creation, after and over its `variables[].defaultValue`, which MUST
 * seed first. An unset parent variable MUST arrive undefined, never an error
 * or `null`."). The v1 twin is `subworkflow-input-mapping`; the legs live in
 * `lib/subworkflow-witness.ts`.
 *
 *   seed      `conformance-subworkflow-input-mapping`: the child's
 *             `receivedPrdId` is seeded at creation;
 *   override  it is the parent's `currentPrdId` ("prd-1"), not the child's
 *             default ("baked-in");
 *   unset     `conformance-subworkflow-input-mapping-no-default`: the parent's
 *             `currentPrdId` is unset — both runs complete, and the child's
 *             value is absent or its own default, never `null`.
 * NOT ported: the mid-run mutation leg (it drives a variables seam) and the
 * registration-refusal leg (it drives a capability-toggle seam).
 *
 * Dispositions: the parent fixture or `conformance-subworkflow-input-mapping-child`
 * not in `fixtures[]` ⇒ `inapplicable`; discovery unreadable ⇒ `blocked`.
 *
 * Proven against a double in `lib/subworkflow-witness.test.ts`.
 *
 * @see spec/v2/core/execution.md §subWorkflow (inputMapping)
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import type { Outcome, Skip } from '../lib/fixture-run-observer.js';
import { IM_NO_DEFAULT_FIXTURE, IM_PARENT_FIXTURE, driveInputMapping, judgeOverride, judgeSeed, judgeUnset, type MappingObservation } from '../lib/subworkflow-witness.js';

const PROFILE = majorProfile(2);
const ID_SEED = 'openwop.requirement.sub-workflow.input-mapping-seeds-child';
const ID_OVERRIDE = 'openwop.requirement.sub-workflow.input-mapping-overrides-default';
const ID_UNSET = 'openwop.requirement.sub-workflow.input-mapping-unset-undefined';

const runs = new Map<string, Promise<Skip | MappingObservation>>();
async function observation(fixture: string): Promise<MappingObservation | (() => undefined)> {
  if (!process.env['OPENWOP_BASE_URL']) return () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return () => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
  if (!runs.has(fixture)) runs.set(fixture, driveInputMapping(PROFILE, fixture));
  const o = await runs.get(fixture)!;
  return 'kind' in o ? () => softSkip(o.disposition, o.reason) : o;
}
function assert(id: string, out: Outcome): undefined {
  if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
  for (const x of out.findings) expect(x.ok, req(id, x.doc, x.message)).toBe(true);
  return undefined;
}

describe('v2 subWorkflow: inputMapping (execution.md §subWorkflow)', () => {
  it('inputMapping seeds the child variable bag at creation', async () => {
    const o = await observation(IM_PARENT_FIXTURE);
    if (typeof o === 'function') return o();
    return assert(ID_SEED, judgeSeed(o));
  }, 90_000);

  it('the mapped parent value lands after and over the child defaultValue', async () => {
    const o = await observation(IM_PARENT_FIXTURE);
    if (typeof o === 'function') return o();
    return assert(ID_OVERRIDE, judgeOverride(o));
  }, 90_000);

  it('an unset parent variable arrives undefined, never an error or null', async () => {
    const o = await observation(IM_NO_DEFAULT_FIXTURE);
    if (typeof o === 'function') return o();
    return assert(ID_UNSET, judgeUnset(o));
  }, 90_000);
});
