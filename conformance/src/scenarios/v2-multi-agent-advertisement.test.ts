/**
 * v2 — the `multiAgent.executionModel` advertisement (`spec/v2/core/execution.md`
 * §multiAgent; RFCs 0039, 0040, 0041, 0044). The legs live in
 * `lib/family-advert-witness.ts` (wave 4).
 *
 *   crossHostCausation   at `version` >= 3 the host advertises
 *                        `crossHostCausation` with a non-empty `hostId`;
 *   replayDeterminism    at `version` >= 4 the host advertises
 *                        `replayDeterminism` with `refusalDivergenceEmission: true`;
 *   escalationKind       `confidenceEscalationInterruptKind`, when present, is
 *                        `clarification` or `approval`.
 *
 * The schema admits all three violations: a conditional `required` and a
 * narrowed `x-host-…` pattern are major changes (COMPATIBILITY.md §2.4), so the
 * rules are carried here and the schema change waits for 3.0 (TODO.md).
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `multiAgent`, its
 * `executionModel`, or the level a leg needs absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/execution.md §multiAgent
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { multiAgentCrossHostCausationLeg, multiAgentEscalationKindLeg, multiAgentReplayDeterminismLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_CROSS_HOST = 'openwop.requirement.multiAgent.level3-cross-host-causation';
const ID_REPLAY = 'openwop.requirement.multiAgent.level4-replay-determinism';
const ID_KIND = 'openwop.requirement.multiAgent.escalation-kind-canonical';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 multiAgent advertisement (execution.md §multiAgent)', () => {
  it('executionModel.version >= 3 advertises crossHostCausation with a hostId', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('multiAgent'))) return softSkip('inapplicable', 'the host does not advertise multiAgent');
    const out = multiAgentCrossHostCausationLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_CROSS_HOST, x.doc, x.message)).toBe(true);
  });

  it('executionModel.version >= 4 advertises replayDeterminism with refusalDivergenceEmission', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('multiAgent'))) return softSkip('inapplicable', 'the host does not advertise multiAgent');
    const out = multiAgentReplayDeterminismLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_REPLAY, x.doc, x.message)).toBe(true);
  });

  it('confidenceEscalationInterruptKind is clarification or approval', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('multiAgent'))) return softSkip('inapplicable', 'the host does not advertise multiAgent');
    const out = multiAgentEscalationKindLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_KIND, x.doc, x.message)).toBe(true);
  });
});
