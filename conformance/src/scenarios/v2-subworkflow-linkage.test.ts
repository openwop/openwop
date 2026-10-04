/**
 * v2 — `core.subWorkflow` output and parent link (`spec/v2/core/execution.md`
 * §`subWorkflow`). The v1 twin is `subworkflow`; the legs live in
 * `lib/subworkflow-witness.ts`.
 *
 * A run of `conformance-subworkflow-parent` (node `subwf-call` starts
 * `conformance-subworkflow-child`, `outputMapping: { childOutcome: childResult }`)
 * is created with `POST /runs` and its log read with `events/poll`:
 *   output         the parent's `node.completed` for `subwf-call` carries
 *                  `outputs.childRunId` and `outputs.childStatus`, and the
 *                  status is the child's terminal status;
 *   outputMapping  the parent's `childOutcome` is the child's `childResult`;
 *   ancestry       where `getRunAncestry` is served, the child's `parent` is
 *                  the parent run with `cause: "core.subWorkflow"`.
 * RETIRED, not ported: v1's child `parentRunId` / `parentNodeId` linkage
 * (`spec/v1/migrations.json` C4.18). At v2 `parentRunId` is fork lineage.
 *
 * Dispositions: either fixture not in `fixtures[]` ⇒ `inapplicable`;
 * `multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported` not
 * advertised ⇒ the ancestry leg `inapplicable`; discovery unreadable ⇒ `blocked`.
 *
 * Proven against a double in `lib/subworkflow-witness.test.ts`.
 *
 * @see spec/v2/core/execution.md §subWorkflow (Output, outputMapping, Parent link)
 * @see spec/v2/core/runs.md §Diff and ancestry
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import type { Outcome, Skip } from '../lib/fixture-run-observer.js';
import { driveLinkage, judgeAncestry, judgeOutput, judgeOutputMapping, type LinkageObservation } from '../lib/subworkflow-witness.js';

const PROFILE = majorProfile(2);
const ID_OUTPUT = 'openwop.requirement.sub-workflow.node-completed-child-outputs';
const ID_OUTPUT_MAPPING = 'openwop.requirement.sub-workflow.output-mapping-copied';
const ID_ANCESTRY = 'openwop.requirement.sub-workflow.ancestry-parent-link';
const validateAncestry = v2RefValidator('run-ancestry-response.schema.json');

let run: Promise<Skip | LinkageObservation> | undefined;
async function observation(): Promise<LinkageObservation | (() => undefined)> {
  if (!process.env['OPENWOP_BASE_URL']) return () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return () => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
  run ??= driveLinkage(PROFILE, doc);
  const o = await run;
  return 'kind' in o ? () => softSkip(o.disposition, o.reason) : o;
}
function assert(id: string, out: Outcome): undefined {
  if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
  for (const x of out.findings) expect(x.ok, req(id, x.doc, x.message)).toBe(true);
  return undefined;
}

describe('v2 subWorkflow: output and parent link (execution.md §subWorkflow)', () => {
  it('node.completed for the core.subWorkflow node carries outputs.childRunId and outputs.childStatus', async () => {
    const o = await observation();
    if (typeof o === 'function') return o();
    return assert(ID_OUTPUT, judgeOutput(o));
  }, 90_000);

  it('outputMapping copies the child variable into the parent after the child completes', async () => {
    const o = await observation();
    if (typeof o === 'function') return o();
    return assert(ID_OUTPUT_MAPPING, judgeOutputMapping(o));
  }, 90_000);

  it('getRunAncestry names the parent run with cause core.subWorkflow', async () => {
    const o = await observation();
    if (typeof o === 'function') return o();
    return assert(ID_ANCESTRY, judgeAncestry(o, validateAncestry));
  }, 90_000);
});
