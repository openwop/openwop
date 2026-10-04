/**
 * v2 — the `scheduling` advertisement (`spec/v2/core/host-services.md`
 * §scheduling; RFC 0052). The v1 twin is the advertisement legs of
 * `scheduling-capability-shape`; the legs live in
 * `lib/family-advert-witness.ts`.
 *
 *   record         the record validates against its capabilities-schema seat;
 *   forms          each advertised form (`cron`, `delayed`, `calendar`) is one boolean.
 *
 * Not ported: the v1 leg that `maxFutureHorizon` is an ISO-8601 duration. The v2
 * schema seat is a plain string and no v2 prose states the format as binding
 * the host, so it is not a failing leg here.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `scheduling` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/host-services.md §scheduling
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { recordSchemaLeg, schedulingFormsLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'host-services.md §scheduling';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.scheduling.advert-record-schema';
const ID_FORMS_BOOLEAN = 'openwop.requirement.scheduling.forms-boolean';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 scheduling advertisement (host-services.md §scheduling)', () => {
  it('the scheduling record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('scheduling'))) return softSkip('inapplicable', 'the host does not advertise scheduling');
    const out = recordSchemaLeg(PROFILE, doc, 'scheduling', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('scheduling.cron, delayed and calendar are booleans', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('scheduling'))) return softSkip('inapplicable', 'the host does not advertise scheduling');
    const out = schedulingFormsLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_FORMS_BOOLEAN, x.doc, x.message)).toBe(true);
  });
});
