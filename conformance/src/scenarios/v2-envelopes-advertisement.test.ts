/**
 * v2 — the `envelopes` advertisement (`spec/v2/core/events.md` §`envelopes`;
 * RFCs 0030, 0032, 0033). A claims-check family: what the host says about its
 * envelope posture is what is witnessed. The v1 twins are the advertisement
 * legs of `envelope-reasoning-shape`, `envelope-retry-attempted` /
 * `envelope-refusal-shape` and `envelope-completion-distinguishes-truncation`;
 * the legs live in `lib/family-advert-witness.ts`.
 *
 *   record       the record validates against its seat in
 *                `schemas/v2/capabilities.schema.json` (no v1 `supported` seat);
 *   reasoning    `reasoning.promptDirective` is mandatory | advisory | off;
 *   tier-one     `tierOneSubsetCompliance` is strict | warn | off;
 *   reliability  `reliability.events[]` names only reliability events and, with
 *                the four v1 dotted names folded to their v2 equivalents
 *                (aliases until 3.0, RFC 0228 §G), lists the two MUST-tier
 *                events `envelope.retry-exhausted` and `envelope.refusal`;
 *   completion   `reliability.completion.distinguishesTruncation` is a boolean
 *                and `truncationBudgetMultiplier` is in [1, 8].
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `envelopes` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/events.md §envelopes
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { envelopesCompletionLeg, envelopesReasoningLeg, envelopesReliabilityLeg, envelopesTierOneLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const ID_RECORD = 'openwop.requirement.envelopes.advert-record-schema';
const ID_REASONING = 'openwop.requirement.envelopes.reasoning-advert-shape';
const ID_TIER_ONE = 'openwop.requirement.envelopes.tier-one-subset-compliance-value';
const ID_RELIABILITY = 'openwop.requirement.envelopes.reliability-events-advert';
const ID_COMPLETION = 'openwop.requirement.envelopes.completion-advert-shape';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';

describe('v2 envelopes advertisement (events.md §envelopes)', () => {
  it('the envelopes record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = recordSchemaLeg(PROFILE, doc, 'envelopes', 'events.md §envelopes');
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('envelopes.reasoning.promptDirective is mandatory, advisory or off', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = envelopesReasoningLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_REASONING, x.doc, x.message)).toBe(true);
  });

  it('envelopes.tierOneSubsetCompliance is strict, warn or off', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = envelopesTierOneLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_TIER_ONE, x.doc, x.message)).toBe(true);
  });

  it('envelopes.reliability.events lists only reliability events and includes retry-exhausted and refusal', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = envelopesReliabilityLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RELIABILITY, x.doc, x.message)).toBe(true);
  });

  it('envelopes.reliability.completion.distinguishesTruncation is a boolean', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = envelopesCompletionLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_COMPLETION, x.doc, x.message)).toBe(true);
  });
});
