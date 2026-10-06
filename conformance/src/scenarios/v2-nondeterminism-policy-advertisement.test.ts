/**
 * v2 — the `nondeterminismPolicy` advertisement (`spec/v2/core/replay.md` §Declared nondeterminism): the declared-nondeterminism claim. The v1 twin is
 * `agent-platform-profile`;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *
 *   no-false       `declared: false` is not a v2 state (RFC 0237 §C);
 *
 * Not here: the replay of each declared source is `v2-nondeterminism-sources`.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `nondeterminismPolicy` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/replay.md §Declared nondeterminism
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'replay.md §Declared nondeterminism';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.nondeterminism-policy.advert-record-schema';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 nondeterminismPolicy advertisement (replay.md §Declared nondeterminism)', () => {
  it('the nondeterminismPolicy record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('nondeterminismPolicy'))) return softSkip('inapplicable', 'the host does not advertise nondeterminismPolicy');
    const out = recordSchemaLeg(PROFILE, doc, 'nondeterminismPolicy', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('nondeterminismPolicy.declared is not false: a host that does not offer the family omits it', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const rec = await familyAdvertised('nondeterminismPolicy');
    if (!rec) return softSkip('inapplicable', 'the host does not advertise nondeterminismPolicy');
    expect(rec['declared'], req('openwop.requirement.0237.no-false-advertisement', 'RFC 0237 §C; capabilities.md §2', 'nondeterminismPolicy.declared: false is not a v2 state; a host that does not offer the family MUST omit it')).not.toBe(false);
  });
});
