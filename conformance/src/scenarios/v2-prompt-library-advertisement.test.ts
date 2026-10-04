/**
 * v2 — the `promptLibrary` advertisement (`spec/v2/core/host-services.md` §`promptLibrary`): the prompt library claim. It had no v1 witness;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *
 * Not here: returning a pinned version verbatim needs a fixture pack.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `promptLibrary` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/host-services.md §`promptLibrary`
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'host-services.md §promptLibrary';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.prompt-library.advert-record-schema';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 promptLibrary advertisement (host-services.md §promptLibrary)', () => {
  it('the promptLibrary record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('promptLibrary'))) return softSkip('inapplicable', 'the host does not advertise promptLibrary');
    const out = recordSchemaLeg(PROFILE, doc, 'promptLibrary', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });
});
