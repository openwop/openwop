/**
 * v2 — the `agentRuntime` advertisement (`spec/v2/core/host-services.md` §`agentRuntime`): the agent runtime claim. It had no v1 witness;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *   implies-manifest-runtime advertising agentRuntime also advertises agents.manifestRuntime;
 *
 * Not here: the `ctx` surface (`spawn`, `delegate`, `consensus`, `messageSend`) cannot be observed from outside a node.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `agentRuntime` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/host-services.md §`agentRuntime`
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { agentRuntimeImpliesManifestRuntimeLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'host-services.md §agentRuntime';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.agent-runtime.advert-record-schema';
const ID_IMPLIES_MANIFEST_RUNTIME = 'openwop.requirement.agent-runtime.implies-manifest-runtime';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 agentRuntime advertisement (host-services.md §agentRuntime)', () => {
  it('the agentRuntime record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('agentRuntime'))) return softSkip('inapplicable', 'the host does not advertise agentRuntime');
    const out = recordSchemaLeg(PROFILE, doc, 'agentRuntime', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('advertising agentRuntime also advertises agents.manifestRuntime', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('agentRuntime'))) return softSkip('inapplicable', 'the host does not advertise agentRuntime');
    const out = agentRuntimeImpliesManifestRuntimeLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_IMPLIES_MANIFEST_RUNTIME, x.doc, x.message)).toBe(true);
  });
});
