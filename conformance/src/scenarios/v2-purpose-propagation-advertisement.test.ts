/**
 * v2 — the `purposePropagation` advertisement (`spec/v2/core/security-defaults.md` §Onward hops): the purpose-label propagation claim. The v1 twin is
 * `purpose-propagation`;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *   propagates-onward-boolean purposePropagation.propagatesOnward is a boolean;
 *
 * Not here: propagation itself needs a carrier the suite can receive with a label seat (TODO §8).
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `purposePropagation` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/security-defaults.md §Onward hops
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { purposePropagatesOnwardLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'security-defaults.md §Onward hops';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.purpose-propagation.advert-record-schema';
const ID_PROPAGATES_ONWARD_BOOLEAN = 'openwop.requirement.purpose-propagation.propagates-onward-boolean';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 purposePropagation advertisement (security-defaults.md §Onward hops)', () => {
  it('the purposePropagation record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('purposePropagation'))) return softSkip('inapplicable', 'the host does not advertise purposePropagation');
    const out = recordSchemaLeg(PROFILE, doc, 'purposePropagation', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('purposePropagation.propagatesOnward is a boolean', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('purposePropagation'))) return softSkip('inapplicable', 'the host does not advertise purposePropagation');
    const out = purposePropagatesOnwardLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_PROPAGATES_ONWARD_BOOLEAN, x.doc, x.message)).toBe(true);
  });
});
