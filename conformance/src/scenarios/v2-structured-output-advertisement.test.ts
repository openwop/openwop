/**
 * v2 — the structured-output facets of `aiProviders`
 * (`spec/v2/core/host-services.md` §Structured output; RFCs 0030, 0032, 0033).
 * RFC 0255 §A moved them here from the deleted `envelopes` family, unchanged
 * except that `reliability.events[]` takes the v2 names only. A claims-check
 * reading: what the host says about its posture is what is witnessed. The legs
 * live in `lib/family-advert-witness.ts`.
 *
 *   record       the `aiProviders` record validates against its capabilities-schema seat;
 *   reasoning    `reasoning.promptDirective` is mandatory | advisory | off;
 *   tier-one     `tierOneSubsetCompliance` is strict | warn | off;
 *   reliability  `reliability.events[]` names only reliability events and lists
 *                the two MUST-tier events `envelope.retry-exhausted` and `envelope.refusal`;
 *   completion   `reliability.completion.distinguishesTruncation` is a boolean
 *                and `truncationBudgetMultiplier` is in [1, 8].
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `aiProviders` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/host-services.md §Structured output
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { structuredOutputCompletionLeg, structuredOutputReasoningLeg, structuredOutputReliabilityLeg, structuredOutputTierOneLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const ID_RECORD = 'openwop.requirement.aiProviders.structured-output-record';
const ID_REASONING = 'openwop.requirement.aiProviders.reasoning-advert-shape';
const ID_TIER_ONE = 'openwop.requirement.aiProviders.tier-one-subset-compliance-value';
const ID_RELIABILITY = 'openwop.requirement.aiProviders.reliability-events-advert';
const ID_COMPLETION = 'openwop.requirement.aiProviders.completion-advert-shape';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';

describe('v2 structured-output advertisement (host-services.md §Structured output)', () => {
  it('the aiProviders record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = recordSchemaLeg(PROFILE, doc, 'aiProviders', 'host-services.md §Structured output');
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('aiProviders.reasoning.promptDirective is mandatory, advisory or off', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = structuredOutputReasoningLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_REASONING, x.doc, x.message)).toBe(true);
  });

  it('aiProviders.tierOneSubsetCompliance is strict, warn or off', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = structuredOutputTierOneLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_TIER_ONE, x.doc, x.message)).toBe(true);
  });

  it('aiProviders.reliability.events lists only reliability events and includes retry-exhausted and refusal', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = structuredOutputReliabilityLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RELIABILITY, x.doc, x.message)).toBe(true);
  });

  it('aiProviders.reliability.completion.distinguishesTruncation is a boolean', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = structuredOutputCompletionLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_COMPLETION, x.doc, x.message)).toBe(true);
  });
});
