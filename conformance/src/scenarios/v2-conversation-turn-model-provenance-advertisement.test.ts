/**
 * v2 — the `conversationTurnModelProvenance` advertisement (`spec/v2/core/conversation.md` §`conversationTurnModelProvenance`): the claim that a host stamps `agent.model` on agent turns. The v1 twin is
 * `conversation-turn-model-provenance-shape`;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *
 * Not here: the stamp itself (only `provider` and `model`, read verbatim on fork) needs a conversation run; the record carries no facet a v2 rule gives meaning to.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `conversationTurnModelProvenance` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/conversation.md §`conversationTurnModelProvenance`
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'conversation.md §conversationTurnModelProvenance';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.conversation-turn-model-provenance.advert-record-schema';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 conversationTurnModelProvenance advertisement (conversation.md §conversationTurnModelProvenance)', () => {
  it('the conversationTurnModelProvenance record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('conversationTurnModelProvenance'))) return softSkip('inapplicable', 'the host does not advertise conversationTurnModelProvenance');
    const out = recordSchemaLeg(PROFILE, doc, 'conversationTurnModelProvenance', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });
});
