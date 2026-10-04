/**
 * v2 — the `multiPartyConversation` advertisement (`spec/v2/core/conversation.md` §`multiPartyConversation`): the multi-party conversation (council) claim. The v1 twin is
 * `multi-party-conversation-shape`;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *   max-participants multiPartyConversation.maxParticipants is an integer of at least 2;
 *
 * Not here: roster enforcement and the over-cap refusal: v2 has no client route that opens a conversation with a roster, and the refusals name no error code (TODO §8).
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `multiPartyConversation` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/conversation.md §`multiPartyConversation`
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { multiPartyMaxParticipantsLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'conversation.md §multiPartyConversation';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.multi-party-conversation.advert-record-schema';
const ID_MAX_PARTICIPANTS = 'openwop.requirement.multi-party-conversation.max-participants';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 multiPartyConversation advertisement (conversation.md §multiPartyConversation)', () => {
  it('the multiPartyConversation record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('multiPartyConversation'))) return softSkip('inapplicable', 'the host does not advertise multiPartyConversation');
    const out = recordSchemaLeg(PROFILE, doc, 'multiPartyConversation', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('multiPartyConversation.maxParticipants is an integer of at least 2', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('multiPartyConversation'))) return softSkip('inapplicable', 'the host does not advertise multiPartyConversation');
    const out = multiPartyMaxParticipantsLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_MAX_PARTICIPANTS, x.doc, x.message)).toBe(true);
  });
});
