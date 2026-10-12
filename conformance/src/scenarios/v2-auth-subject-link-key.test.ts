/**
 * v2 — `auth.subjectLinkKey` under the two linking lanes (`spec/v2/core/identity.md`
 * §3; RFC 0163 §A, RFC 0164 §A.3). The leg lives in
 * `lib/family-advert-witness.ts` (wave 4).
 *
 * Advertising both the `saml` and `scim` lanes implies the link contract, and
 * the host MUST name the key class it forms links under. The schema cannot
 * say so: a conditional `required` is a major change (COMPATIBILITY.md §2.4),
 * and would also re-judge committed bundles. The schema change waits for 3.0.
 * The behavioural link legs are `v2-subject-link-record`.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `auth` absent, or the two
 * lanes not both advertised ⇒ `inapplicable`.
 *
 * @see spec/v2/core/identity.md §3
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { authSubjectLinkKeyLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_KEY = 'openwop.requirement.auth.subject-link-key-advertised';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 auth.subjectLinkKey (identity.md §3)', () => {
  it('a host advertising both the saml and scim lanes advertises subjectLinkKey', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('auth'))) return softSkip('inapplicable', 'the host does not advertise auth');
    const out = authSubjectLinkKeyLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_KEY, x.doc, x.message)).toBe(true);
  });
});
