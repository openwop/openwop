/**
 * v2 — the `aiEnvelope` advertisement (`spec/v2/core/host-services.md`
 * §aiEnvelope; RFC 0144). The v1 twin is the record shape `aiEnvelope` carried
 * at v1; the legs live in `lib/family-advert-witness.ts`.
 *
 *   record         the record (with its optional `await` boolean) validates against
 *                  its capabilities-schema seat.
 *
 * Not here: exposing `ctx.aiEnvelope.generate` / `await` to pack code is a
 * pack-runtime surface with no wire witness.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `aiEnvelope` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/host-services.md §aiEnvelope
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'host-services.md §aiEnvelope';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.ai-envelope.advert-record-schema';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 aiEnvelope advertisement (host-services.md §aiEnvelope)', () => {
  it('the aiEnvelope record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('aiEnvelope'))) return softSkip('inapplicable', 'the host does not advertise aiEnvelope');
    const out = recordSchemaLeg(PROFILE, doc, 'aiEnvelope', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });
});
