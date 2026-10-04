/**
 * v2 — the `deadLetter` advertisement (`spec/v2/core/runs.md` §Dead letters;
 * RFC 0053). The v1 twin is the advertisement legs of
 * `deadletter-capability-shape`; the legs live in
 * `lib/family-advert-witness.ts`.
 *
 *   record         the record validates against its capabilities-schema seat;
 *   retentionDays  an integer of at least 1.
 *
 * Not here: routing to the sink, `run.dead-lettered` and fork-eligibility for
 * `retentionDays` need a retry-exhaustion fixture run.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `deadLetter` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/runs.md §Dead letters
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { deadLetterRetentionDaysLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'runs.md §Dead letters';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.dead-letter.advert-record-schema';
const ID_RETENTION_DAYS = 'openwop.requirement.dead-letter.retention-days';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 deadLetter advertisement (runs.md §Dead letters)', () => {
  it('the deadLetter record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('deadLetter'))) return softSkip('inapplicable', 'the host does not advertise deadLetter');
    const out = recordSchemaLeg(PROFILE, doc, 'deadLetter', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('deadLetter.retentionDays is an integer of at least 1', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('deadLetter'))) return softSkip('inapplicable', 'the host does not advertise deadLetter');
    const out = deadLetterRetentionDaysLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RETENTION_DAYS, x.doc, x.message)).toBe(true);
  });
});
