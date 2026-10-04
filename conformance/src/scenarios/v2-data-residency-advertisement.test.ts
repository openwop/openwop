/**
 * v2 — the `dataResidency` advertisement (`spec/v2/core/runs.md` §`dataResidency`): the residency regions a host will honour. The v1 twin is
 * `data-residency-admission`;
 * the legs live in `lib/family-advert-witness.ts` (witness wave 3).
 *
 *   record         the record validates against its capabilities-schema seat;
 *   regions-shape  dataResidency.regions holds unique non-empty region codes;
 *
 * Not here: the admission rule (accept an advertised region, refuse any other with `422 residency_unavailable`, create no run) is in `v2-data-residency-admission.test.ts`.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `dataResidency` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/runs.md §`dataResidency`
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { dataResidencyRegionsLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'runs.md §dataResidency';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.data-residency.advert-record-schema';
const ID_REGIONS_SHAPE = 'openwop.requirement.data-residency.regions-shape';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 dataResidency advertisement (runs.md §dataResidency)', () => {
  it('the dataResidency record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('dataResidency'))) return softSkip('inapplicable', 'the host does not advertise dataResidency');
    const out = recordSchemaLeg(PROFILE, doc, 'dataResidency', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('dataResidency.regions holds unique non-empty region codes', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('dataResidency'))) return softSkip('inapplicable', 'the host does not advertise dataResidency');
    const out = dataResidencyRegionsLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_REGIONS_SHAPE, x.doc, x.message)).toBe(true);
  });
});
