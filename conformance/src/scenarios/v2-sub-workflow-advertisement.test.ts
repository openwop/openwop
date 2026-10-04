/**
 * v2 — the `subWorkflow` advertisement (`spec/v2/core/execution.md`
 * §subWorkflow; RFCs 0007, 0022). The v1 twin is the record shape `subWorkflow`
 * carried at v1; the legs live in `lib/family-advert-witness.ts`.
 *
 *   record         the record validates against its capabilities-schema seat;
 *   inputMapping   one boolean.
 *
 * Not here: the refusal of a non-empty `inputMapping` by a host not advertising
 * it, and the child-run legs, need workflow registration and a fixture run.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `subWorkflow` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/execution.md §subWorkflow
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { recordSchemaLeg, subWorkflowInputMappingLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'execution.md §subWorkflow';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.sub-workflow.advert-record-schema';
const ID_INPUT_MAPPING_BOOLEAN = 'openwop.requirement.sub-workflow.input-mapping-boolean';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 subWorkflow advertisement (execution.md §subWorkflow)', () => {
  it('the subWorkflow record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('subWorkflow'))) return softSkip('inapplicable', 'the host does not advertise subWorkflow');
    const out = recordSchemaLeg(PROFILE, doc, 'subWorkflow', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('subWorkflow.inputMapping is one boolean', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('subWorkflow'))) return softSkip('inapplicable', 'the host does not advertise subWorkflow');
    const out = subWorkflowInputMappingLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_INPUT_MAPPING_BOOLEAN, x.doc, x.message)).toBe(true);
  });
});
