/**
 * v2 — the `credentials` advertisement (`spec/v2/core/oauth.md` §Credentials;
 * RFC 0046). The v1 twin is the advertisement legs of
 * `credentials-capability-shape`; the legs live in
 * `lib/family-advert-witness.ts`.
 *
 *   record         the record validates against its capabilities-schema seat;
 *   scopes         `scopes` is a subset of user, workspace, tenant (a scope
 *                  outside it is refused `credential_scope_unsupported`);
 *   rotation       `rotation` is `none` or `two-key-overlap`.
 *
 * Not here: resolution, scope refusal, rotation overlap and redaction need a
 * credential seam (`credential-payload-redaction` has no v2 seam).
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `credentials` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/oauth.md §Credentials
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { credentialsRotationLeg, credentialsScopesLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'oauth.md §Credentials';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.credentials.advert-record-schema';
const ID_SCOPES_SUBSET = 'openwop.requirement.credentials.scopes-subset';
const ID_ROTATION_VALUE = 'openwop.requirement.credentials.rotation-value';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 credentials advertisement (oauth.md §Credentials)', () => {
  it('the credentials record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('credentials'))) return softSkip('inapplicable', 'the host does not advertise credentials');
    const out = recordSchemaLeg(PROFILE, doc, 'credentials', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('credentials.scopes is a subset of user, workspace, tenant', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('credentials'))) return softSkip('inapplicable', 'the host does not advertise credentials');
    const out = credentialsScopesLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_SCOPES_SUBSET, x.doc, x.message)).toBe(true);
  });

  it('credentials.rotation is none or two-key-overlap', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('credentials'))) return softSkip('inapplicable', 'the host does not advertise credentials');
    const out = credentialsRotationLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_ROTATION_VALUE, x.doc, x.message)).toBe(true);
  });
});
