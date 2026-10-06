/**
 * v2 — the `envelopeContracts` advertisement (`spec/v2/core/events.md` §Envelope contracts): the envelope contract claim. It had no v1 witness;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *
 * Not here: the refusal leg needs an error code in the prose and a fixture pack.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `envelopeContracts` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/events.md §Envelope contracts
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'events.md §Envelope contracts';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.envelope-contracts.advert-record-schema';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 envelopeContracts advertisement (events.md §Envelope contracts)', () => {
  it('the envelopeContracts record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('envelopeContracts'))) return softSkip('inapplicable', 'the host does not advertise envelopeContracts');
    const out = recordSchemaLeg(PROFILE, doc, 'envelopeContracts', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('envelopeContracts.advertised is not false: a host that does not offer the family omits it', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const rec = await familyAdvertised('envelopeContracts');
    if (!rec) return softSkip('inapplicable', 'the host does not advertise envelopeContracts');
    expect(rec['advertised'], req('openwop.requirement.0237.no-false-advertisement', 'RFC 0237 §C; capabilities.md §2', 'envelopeContracts.advertised: false is not a v2 state; a host that does not offer the family MUST omit it')).not.toBe(false);
  });
});
