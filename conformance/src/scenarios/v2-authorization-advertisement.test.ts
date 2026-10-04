/**
 * v2 — the `authorization` advertisement (`spec/v2/core/identity.md` §2.1; RFC
 * 0049; invariant `authorization-fail-closed`). The v1 twin is the
 * advertisement legs of `authorization-roles-shape` and
 * `authorization-fail-closed`; the legs live in `lib/family-advert-witness.ts`.
 *
 *   record         the record validates against its capabilities-schema seat;
 *   failClosed     `failClosed` MUST be `true` when present;
 *   roles          each `roles[]` entry names a non-empty `role` and a unique
 *                  `scopes[]` of non-empty strings, and nothing else.
 *
 * Not here: the unseeded-role decision leg of `authorization-fail-closed` needs
 * a decision seam with no v2 counterpart.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `authorization` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/identity.md §2.1
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { authorizationFailClosedLeg, authorizationRolesLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'identity.md §2.1';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.authorization.advert-record-schema';
const ID_FAIL_CLOSED_TRUE = 'openwop.requirement.authorization.fail-closed-true';
const ID_ROLES_SHAPE = 'openwop.requirement.authorization.roles-shape';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 authorization advertisement (identity.md §2.1)', () => {
  it('the authorization record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('authorization'))) return softSkip('inapplicable', 'the host does not advertise authorization');
    const out = recordSchemaLeg(PROFILE, doc, 'authorization', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('authorization.failClosed is true when present', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('authorization'))) return softSkip('inapplicable', 'the host does not advertise authorization');
    const out = authorizationFailClosedLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_FAIL_CLOSED_TRUE, x.doc, x.message)).toBe(true);
  });

  it('every authorization.roles entry has a non-empty role and a scopes list', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('authorization'))) return softSkip('inapplicable', 'the host does not advertise authorization');
    const out = authorizationRolesLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_ROLES_SHAPE, x.doc, x.message)).toBe(true);
  });
});
