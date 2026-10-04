/**
 * v2 — the `channelPresence` advertisement (`spec/v2/core/conversation.md` §`channelPresence`): the channel presence claim. The v1 twin is
 * `channel-presence-shape`;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *
 * Not here: presence delivery needs a channel conversation the suite can create, and the non-persistence rule lives only in a schema description (TODO §8).
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `channelPresence` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/conversation.md §`channelPresence`
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'conversation.md §channelPresence';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.channel-presence.advert-record-schema';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 channelPresence advertisement (conversation.md §channelPresence)', () => {
  it('the channelPresence record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('channelPresence'))) return softSkip('inapplicable', 'the host does not advertise channelPresence');
    const out = recordSchemaLeg(PROFILE, doc, 'channelPresence', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });
});
